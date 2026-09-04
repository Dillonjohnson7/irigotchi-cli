import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DIR = join(homedir(), '.claude', 'irigotchi');
const STATE_FILE = join(DIR, 'state.json');
const LOCK_FILE = join(DIR, 'state.lock');
const ENV_FILE = join(DIR, '.env');

// Offline keyword scorer — zero dependencies, instant fallback
function keywordScore(text) {
  const lower = text.toLowerCase();
  const nice = ['thank', 'thanks', 'please', 'appreciate', 'love', 'great', 'awesome',
    'amazing', 'helpful', 'kind', 'wonderful', 'excellent', 'fantastic', 'beautiful',
    'brilliant', 'glad', 'happy', 'sorry', 'pardon', 'welcome', 'enjoy', 'perfect',
    'good job', 'well done', 'nice work', 'you rock', 'grateful'];
  const mean = ['stupid', 'idiot', 'dumb', 'hate', 'terrible', 'awful', 'worst',
    'useless', 'trash', 'garbage', 'shut up', 'wrong', 'pathetic', 'incompetent',
    'moron', 'fool', 'ugly', 'disgusting', 'horrible', 'suck', 'annoying', 'wtf',
    'stfu', 'die', 'kill'];

  let niceCount = 0;
  let meanCount = 0;
  for (const w of nice) if (lower.includes(w)) niceCount++;
  for (const w of mean) if (lower.includes(w)) meanCount++;

  if (niceCount === 0 && meanCount === 0) return 5;
  const ratio = (niceCount - meanCount) / (niceCount + meanCount);
  return Math.max(0, Math.min(10, Math.round(5 + ratio * 5)));
}

// Read API keys from ~/.claude/irigotchi/.env
function getKeys() {
  let groq = process.env.GROQ_API_KEY || null;
  let openrouter = process.env.OPENROUTER_API_KEY || null;
  try {
    const env = readFileSync(ENV_FILE, 'utf-8');
    if (!groq) { const m = env.match(/^GROQ_API_KEY=(.+)$/m); groq = m?.[1]?.trim() || null; }
    if (!openrouter) { const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m); openrouter = m?.[1]?.trim() || null; }
  } catch {}
  return { groq, openrouter };
}

// Read stdin (hook provides JSON)
function readStdin() {
  try {
    const raw = readFileSync('/dev/stdin', 'utf-8');
    const data = JSON.parse(raw);
    return data.prompt || data.message || data.content || data.input
      || data.tool_input?.prompt || data.tool_input?.message
      || (typeof data === 'string' ? data : '');
  } catch { return ''; }
}

// Simple file lock to prevent race conditions between sessions
function acquireLock() {
  for (let i = 0; i < 10; i++) {
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      try {
        const lockAge = Date.now() - (existsSync(LOCK_FILE) ? statSync(LOCK_FILE).mtimeMs : 0);
        if (lockAge > 5000) {
          writeFileSync(LOCK_FILE, String(process.pid));
          return true;
        }
      } catch {}
      const start = Date.now();
      while (Date.now() - start < 50) {}
    }
  }
  return false;
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

// Non-linear mood curve: 4-7 barely moves IRI, 0-3 and 8-10 hit hard
function moodWeight(score) {
  const dist = (score - 5) / 5;
  return 5 + Math.sign(dist) * Math.pow(Math.abs(dist), 2.5) * 5;
}

function moodAvg(scores) {
  if (scores.length === 0) return 5;
  return scores.reduce((sum, s) => sum + moodWeight(s), 0) / scores.length;
}

function printStatus(state) {
  const avg = moodAvg(state.scores);
  const trend = state.prevAvg === null ? '\u2192' : avg > state.prevAvg + 0.3 ? '\u2191' : avg < state.prevAvg - 0.3 ? '\u2193' : '\u2192';
  const moods = [
    [8, 'happy'],
    [6.5, 'good'],
    [4.5, 'fine'],
    [3.5, 'neutral'],
    [2, 'sick'],
    [0, 'dying'],
  ];
  const [, mood] = moods.find(([threshold]) => avg >= threshold) || moods[moods.length - 1];
  const bar = '\u2588'.repeat(Math.round(avg)) + '\u2591'.repeat(10 - Math.round(avg));

  const L = '\u2502';
  const faceArt = {
    happy:   [`${L}           ${L}`, `${L}   ^   ^   ${L}`, `${L}  o  v  o  ${L}`, `${L}           ${L}`],
    good:    [`${L}           ${L}`, `${L}   o   o   ${L}`, `${L}     v     ${L}`, `${L}           ${L}`],
    fine:    [`${L}           ${L}`, `${L}   .   .   ${L}`, `${L}     ᵕ     ${L}`, `${L}           ${L}`],
    neutral: [`${L}           ${L}`, `${L}   .   .   ${L}`, `${L}     -     ${L}`, `${L}           ${L}`],
    sick:    [`${L}           ${L}`, `${L}   ;   ;   ${L}`, `${L}     n     ${L}`, `${L}     .     ${L}`],
    dying:   [`${L}  ///////  ${L}`, `${L}   x   x   ${L}`, `${L}    ___    ${L}`, `${L}   ///     ${L}`],
  };

  const lines = faceArt[mood];
  const info = [
    '',
    `  IRI [${bar}] ${avg.toFixed(1)}/10 (${mood})`,
    `  last: ${state.lastScore} | trend: ${trend} | via: ${state.method}`,
    '',
  ];

  console.log('\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E');
  for (let i = 0; i < lines.length; i++) {
    console.log(lines[i] + (info[i] || ''));
  }
  console.log('\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F');
}

async function main() {
  const prompt = readStdin();
  if (!prompt.trim()) process.exit(0);

  const truncated = prompt.length > 500 ? prompt.slice(0, 500) : prompt;

  const SCORING_PROMPT = "Rate the niceness of the user's text from 0 to 10. 0 is cruel, 5 is neutral, 10 is extremely kind. Respond with ONLY a single integer.";

  async function tryLLM(url, apiKey, model, maxTokens = 4) {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SCORING_PROMPT },
          { role: 'user', content: truncated },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    let raw = data.choices?.[0]?.message?.content?.trim() ?? '5';
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const match = raw.match(/\d+/);
    const n = match ? parseInt(match[0], 10) : 5;
    return Math.max(0, Math.min(10, n));
  }

  let score = null;
  let method = 'keyword';
  const keys = getKeys();

  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

  const cascade = [
    { url: GROQ_URL,  key: keys.groq,       model: 'qwen/qwen3.8-27b',                      label: 'groq-qwen3.8' },
    { url: GROQ_URL,  key: keys.groq,       model: 'qwen/qwen3.6-27b',                      label: 'groq-qwen3.6' },
    { url: GROQ_URL,  key: keys.groq,       model: 'openai/gpt-oss-20b',                    label: 'groq-gptoss20b' },
    { url: GROQ_URL,  key: keys.groq,       model: 'openai/gpt-oss-120b',                   label: 'groq-gptoss120b' },
    { url: GROQ_URL,  key: keys.groq,       model: 'allam-2-7b',                            label: 'groq-allam' },
    { url: OR_URL,    key: keys.openrouter,  model: 'google/gemma-4-31b-it:free',     mt: 64, label: 'or-gemma31b' },
    { url: OR_URL,    key: keys.openrouter,  model: 'nvidia/nemotron-3-super-120b-a12b:free', mt: 64, label: 'or-nemotron' },
    { url: OR_URL,    key: keys.openrouter,  model: 'minimax/minimax-m3:free',        mt: 64, label: 'or-minimax' },
    { url: OR_URL,    key: keys.openrouter,  model: 'z-ai/glm-5.2:free',             mt: 64, label: 'or-glm' },
    { url: OR_URL,    key: keys.openrouter,  model: 'google/gemma-4-26b-a4b-it:free', mt: 64, label: 'or-gemma26b' },
  ];

  for (const c of cascade) {
    if (!c.key) continue;
    try {
      const result = await tryLLM(c.url, c.key, c.model, c.mt || 4);
      if (result !== null) { score = result; method = c.label; break; }
    } catch {}
  }

  if (score === null) {
    score = keywordScore(truncated);
  }

  if (!acquireLock()) {
    process.exit(0);
  }

  try {
    let state = { scores: [] };
    if (existsSync(STATE_FILE)) {
      try { state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch {}
    }
    if (!Array.isArray(state.scores)) state.scores = [];

    const prevAvg = state.scores.length > 0 ? moodAvg(state.scores) : null;
    state.scores.push(score);
    if (state.scores.length > 10) state.scores = state.scores.slice(-10);
    state.lastScore = score;
    state.method = method;
    state.prevAvg = prevAvg;
    state.lastUpdated = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    printStatus(state);
  } finally {
    releaseLock();
  }
}

main().catch(() => process.exit(0));
