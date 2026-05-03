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

function printStatus(state) {
  const avg = state.scores.length > 0
    ? state.scores.reduce((a, b) => a + b, 0) / state.scores.length
    : 5;
  const trend = state.prevAvg === null ? '\u2192' : avg > state.prevAvg + 0.3 ? '\u2191' : avg < state.prevAvg - 0.3 ? '\u2193' : '\u2192';
  const moods = [
    [8, 'happy'],
    [6, 'good'],
    [4, 'neutral'],
    [2, 'sick'],
    [0, 'dying'],
  ];
  const [, mood] = moods.find(([threshold]) => avg >= threshold) || moods[moods.length - 1];
  const bar = '\u2588'.repeat(Math.round(avg)) + '\u2591'.repeat(10 - Math.round(avg));

  const L = '\u2502';
  const faceArt = {
    happy:   [`${L}           ${L}`, `${L}   ^   ^   ${L}`, `${L}  o  v  o  ${L}`, `${L}           ${L}`],
    good:    [`${L}           ${L}`, `${L}   o   o   ${L}`, `${L}     v     ${L}`, `${L}           ${L}`],
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
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '5';
    const match = raw.match(/\d+/);
    const n = match ? parseInt(match[0], 10) : 5;
    return Math.max(0, Math.min(10, n));
  }

  let score = null;
  let method = 'keyword';
  const keys = getKeys();

  // Try Groq first
  if (keys.groq && score === null) {
    try {
      const result = await tryLLM('https://api.groq.com/openai/v1/chat/completions', keys.groq, 'llama-3.1-8b-instant');
      if (result !== null) { score = result; method = 'groq'; }
    } catch {}
  }

  // Fall back to OpenRouter
  if (keys.openrouter && score === null) {
    try {
      const result = await tryLLM('https://openrouter.ai/api/v1/chat/completions', keys.openrouter, 'openai/gpt-oss-20b:free', 64);
      if (result !== null) { score = result; method = 'openrouter'; }
    } catch {}
  }

  // Fall back to keyword
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

    const prevAvg = state.scores.length > 0
      ? state.scores.reduce((a, b) => a + b, 0) / state.scores.length
      : null;
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
