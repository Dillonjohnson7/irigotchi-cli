#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const REPO = 'https://raw.githubusercontent.com/Dillonjohnson7/irigotchi-cli/main';
const HOME = homedir();
const INSTALL_DIR = join(HOME, '.claude', 'irigotchi');
const SETTINGS_FILE = join(HOME, '.claude', 'settings.json');
const CLAUDE_MD = join(HOME, '.claude', 'CLAUDE.md');

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function log(msg) { console.log(msg); }

log('');
log('  ╭───────────╮');
log('  │           │');
log('  │   ^   ^   │  Installing IRIgotchi...');
log('  │  o  v  o  │');
log('  │           │');
log('  ╰───────────╯');
log('');

// Check Node version
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  log(`Error: Node.js v18+ required (you have v${process.versions.node})`);
  process.exit(1);
}

// Check ~/.claude
if (!existsSync(join(HOME, '.claude'))) {
  log('Error: ~/.claude directory not found. Is Claude Code installed?');
  process.exit(1);
}

// Create install dir
mkdirSync(INSTALL_DIR, { recursive: true });

// Download score.mjs
try {
  const res = await fetch(`${REPO}/score.mjs`);
  if (!res.ok) throw new Error(res.statusText);
  writeFileSync(join(INSTALL_DIR, 'score.mjs'), await res.text());
  log('Downloaded score.mjs');
} catch (e) {
  log(`Error downloading score.mjs: ${e.message}`);
  process.exit(1);
}

// API key setup
const envFile = join(INSTALL_DIR, '.env');
if (existsSync(envFile) && readFileSync(envFile, 'utf-8').includes('GROQ_API_KEY')) {
  log('Groq API key already configured');
} else {
  log('');
  log('IRI needs a free API key to score prompts with AI.');
  log('Get one at: https://console.groq.com/keys');
  log('');
  const key = await ask('Paste your Groq API key (or Enter to skip): ');
  if (key.trim()) {
    writeFileSync(envFile, `GROQ_API_KEY=${key.trim()}\n`);
    log('API key saved');
  } else {
    log('Skipped — IRI will use keyword scoring.');
    log(`Add a key later: echo GROQ_API_KEY=your_key >> ${envFile}`);
  }
}

// Add hook to settings.json
if (existsSync(SETTINGS_FILE)) {
  const raw = readFileSync(SETTINGS_FILE, 'utf-8');
  if (raw.includes('irigotchi')) {
    log('Hook already registered');
  } else {
    const settings = JSON.parse(raw);
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
    settings.hooks.UserPromptSubmit.push({
      hooks: [{
        type: 'command',
        command: `node ${INSTALL_DIR}/score.mjs`,
        timeout: 10,
        async: false,
      }],
    });
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    log('Hook added to settings.json');
  }
} else {
  const settings = {
    hooks: {
      UserPromptSubmit: [{
        hooks: [{
          type: 'command',
          command: 'node ~/.claude/irigotchi/score.mjs',
          timeout: 10,
          async: false,
        }],
      }],
    },
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  log('Created settings.json with hook');
}

// Add display instruction to CLAUDE.md
const marker = '## IRI Status Display';
const instruction = `
${marker}
Every response MUST start with the IRI status from the UserPromptSubmit hook. The hook output appears in system reminders as "UserPromptSubmit hook success: ...". Display the FULL multi-line face art and stats exactly as the hook outputs them. Reproduce the output verbatim in a code block at the top of every response.`;

if (existsSync(CLAUDE_MD) && readFileSync(CLAUDE_MD, 'utf-8').includes(marker)) {
  log('CLAUDE.md already has IRI display instruction');
} else if (existsSync(CLAUDE_MD)) {
  writeFileSync(CLAUDE_MD, readFileSync(CLAUDE_MD, 'utf-8') + instruction);
  log('Appended IRI instruction to CLAUDE.md');
} else {
  writeFileSync(CLAUDE_MD, '# Global Instructions\n' + instruction);
  log('Created CLAUDE.md with IRI instruction');
}

log('');
log('  ╭───────────╮');
log('  │           │');
log('  │   ^   ^   │  IRI is alive!');
log('  │  o  v  o  │');
log('  │           │');
log('  ╰───────────╯');
log('');
log('Start a new Claude Code session and IRI will appear.');
log('Be nice to Claude — IRI is watching.');
log('');
