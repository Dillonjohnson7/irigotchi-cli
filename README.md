# IRIgotchi

A Tamagotchi for your vibe with Claude Code. IRI monitors how nicely you talk to Claude and reflects your mood back as a little ASCII face.

Be kind, IRI thrives. Be mean, IRI withers.

```
╭───────────╮
│           │
│   ^   ^   │  IRI [██████████] 9.2/10 (happy)
│  o  v  o  │  last: 10 | trend: ↑
│           │
╰───────────╯
```

## How it works

Every time you send a message in Claude Code:

1. A hook sends your prompt to [Groq](https://groq.com) (llama-3.1-8b-instant) which rates how nice it was from 0-10
2. The score gets added to a rolling window of your last 10 messages
3. IRI's mood updates based on your rolling average
4. Claude displays IRI's face and stats at the top of every response

There is only one IRI — mood persists across all your Claude Code sessions.

## The 5 moods

```
HAPPY (8-10)      GOOD (6-7)       NEUTRAL (4-5)    SICK (2-3)       DYING (0-1)
╭───────────╮    ╭───────────╮    ╭───────────╮    ╭───────────╮    ╭───────────╮
│           │    │           │    │           │    │           │    │  ///////  │
│   ^   ^   │    │   o   o   │    │   .   .   │    │   ;   ;   │    │   x   x   │
│  o  v  o  │    │     v     │    │     -     │    │     n     │    │    ___    │
│           │    │           │    │           │    │     .     │    │   ///     │
╰───────────╯    ╰───────────╯    ╰───────────╯    ╰───────────╯    ╰───────────╯
```

## Requirements

- [Claude Code](https://claude.com/claude-code) installed
- Node.js v18+
- A free [Groq API key](https://console.groq.com/keys)

## Install

```bash
git clone https://github.com/Dillonjohnson7/irigotchi-cli.git
cd irigotchi-cli
./install.sh
```

The installer will:
- Copy the scoring script to `~/.claude/irigotchi/`
- Prompt you for your Groq API key
- Add the hook to `~/.claude/settings.json`
- Add the display instruction to `~/.claude/CLAUDE.md`

Start a new Claude Code session and IRI will appear.

## Uninstall

```bash
./uninstall.sh
```

Cleanly removes everything — the hook, the display instruction, and the state files.

## How the display works

Claude Code hooks output goes into Claude's context (not your terminal). The `CLAUDE.md` instruction tells Claude to reproduce IRI's status at the top of every response. This is the only way to make hook output visible to you.

## Rate limits

IRI uses Groq's free tier (`llama-3.1-8b-instant`):
- 30 requests/minute
- 14,400 requests/day
- Each scoring call uses ~50 tokens

Normal usage will never hit these limits.

## Files

| File | Location | Purpose |
|------|----------|---------|
| `score.mjs` | `~/.claude/irigotchi/` | Scores prompts, manages state, renders face |
| `.env` | `~/.claude/irigotchi/` | Your Groq API key |
| `state.json` | `~/.claude/irigotchi/` | Rolling scores and mood data |
| `settings.json` | `~/.claude/` | Hook registration |
| `CLAUDE.md` | `~/.claude/` | Display instruction |

## Privacy

When using Groq mode (default), your prompt text is sent to the [Groq API](https://groq.com) for niceness scoring. Groq's API does not store your data per their [privacy policy](https://groq.com/privacy-policy/). If you prefer fully offline scoring, simply don't add a Groq API key — IRI will use the built-in keyword scorer instead.

The install script modifies `~/.claude/settings.json` (adds a hook) and `~/.claude/CLAUDE.md` (adds a display instruction). Run `./uninstall.sh` to cleanly revert both.

## License

MIT
