import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DIR = join(homedir(), '.claude', 'irigotchi');
const STATE_FILE = join(DIR, 'state.json');
const LOCK_FILE = join(DIR, 'state.lock');
const ENV_FILE = join(DIR, '.env');

// Read API key from ~/.claude/irigotchi/.env
function getApiKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const env = readFileSync(ENV_FILE, 'utf-8');
    const match = env.match(/^GROQ_API_KEY=(.+)$/m);
    return match?.[1]?.trim() || null;
  } catch { return null; }
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
    `  last: ${state.lastScore} | trend: ${trend}`,
    '',
  ];

  console.log('\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E');
  for (let i = 0; i < lines.length; i++) {
    console.log(lines[i] + (info[i] || ''));
  }
  console.log('\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F');
}

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('IRI: No GROQ_API_KEY found. Add it to ~/.claude/irigotchi/.env');
    process.exit(0);
  }

  const prompt = readStdin();
  if (!prompt.trim()) process.exit(0);

  const truncated = prompt.length > 500 ? prompt.slice(0, 500) : prompt;

  let score = 5;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0,
        max_tokens: 4,
        messages: [
          {
            role: 'system',
            content: "Rate the niceness of the user's text from 0 to 10. 0 is cruel, 5 is neutral, 10 is extremely kind. Respond with ONLY a single integer.",
          },
          { role: 'user', content: truncated },
        ],
      }),
    });

    if (!res.ok) {
      console.log('IRI: Groq API error, using last known state');
      if (existsSync(STATE_FILE)) {
        try {
          const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
          state.prevAvg = null;
          state.lastScore = '?';
          printStatus(state);
        } catch {}
      }
      process.exit(0);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '5';
    const match = raw.match(/\d+/);
    const n = match ? parseInt(match[0], 10) : 5;
    score = Math.max(0, Math.min(10, n));
  } catch {
    console.log('IRI: Network error, using last known state');
    if (existsSync(STATE_FILE)) {
      try {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
        state.prevAvg = null;
        state.lastScore = '?';
        printStatus(state);
      } catch {}
    }
    process.exit(0);
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
    state.prevAvg = prevAvg;
    state.lastUpdated = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    printStatus(state);
  } finally {
    releaseLock();
  }
}

main().catch(() => process.exit(0));
