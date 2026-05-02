#!/bin/bash
set -e

INSTALL_DIR="$HOME/.claude/irigotchi"
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ╭───────────╮"
echo "  │           │"
echo "  │   ^   ^   │  Installing IRIgotchi..."
echo "  │  o  v  o  │"
echo "  │           │"
echo "  ╰───────────╯"
echo ""

# Check Node.js version (need 18+ for native fetch)
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is required but not installed."
  echo "Install it from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js v18+ required (you have $(node -v))"
  exit 1
fi

# Check for ~/.claude directory
if [ ! -d "$HOME/.claude" ]; then
  echo "Error: ~/.claude directory not found. Is Claude Code installed?"
  exit 1
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Copy score script
cp "$SCRIPT_DIR/score.mjs" "$INSTALL_DIR/score.mjs"
echo "Copied score.mjs to $INSTALL_DIR"

# Set up API key
if [ -f "$INSTALL_DIR/.env" ] && grep -q "GROQ_API_KEY" "$INSTALL_DIR/.env"; then
  echo "Groq API key already configured"
else
  echo ""
  echo "You need a free Groq API key for IRI to work."
  echo "Get one at: https://console.groq.com/keys"
  echo ""
  read -p "Paste your Groq API key (or press Enter to skip): " API_KEY
  if [ -n "$API_KEY" ]; then
    echo "GROQ_API_KEY=$API_KEY" > "$INSTALL_DIR/.env"
    echo "API key saved"
  else
    echo "Skipped. Add your key later to $INSTALL_DIR/.env"
    echo "Format: GROQ_API_KEY=your_key_here"
  fi
fi

# Add hook to settings.json
if [ -f "$SETTINGS_FILE" ]; then
  # Check if hook already exists
  if grep -q "irigotchi" "$SETTINGS_FILE"; then
    echo "Hook already registered in settings.json"
  else
    # Merge hook into existing settings
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
      settings.hooks.UserPromptSubmit.push({
        hooks: [{
          type: 'command',
          command: 'node $INSTALL_DIR/score.mjs',
          timeout: 10,
          async: false
        }]
      });
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
    "
    echo "Hook added to settings.json"
  fi
else
  # Create new settings file
  cat > "$SETTINGS_FILE" << 'SETTINGS'
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/irigotchi/score.mjs",
            "timeout": 10,
            "async": false
          }
        ]
      }
    ]
  }
}
SETTINGS
  echo "Created settings.json with hook"
fi

# Add display instruction to CLAUDE.md
IRI_MARKER="## IRI Status Display"
if [ -f "$CLAUDE_MD" ] && grep -q "$IRI_MARKER" "$CLAUDE_MD"; then
  echo "CLAUDE.md already has IRI display instruction"
else
  IRI_INSTRUCTION="
$IRI_MARKER
Every response MUST start with the IRI status from the UserPromptSubmit hook. The hook output appears in system reminders as \"UserPromptSubmit hook success: ...\". Display the FULL multi-line face art and stats exactly as the hook outputs them. Reproduce the output verbatim in a code block at the top of every response."

  if [ -f "$CLAUDE_MD" ]; then
    echo "$IRI_INSTRUCTION" >> "$CLAUDE_MD"
    echo "Appended IRI instruction to existing CLAUDE.md"
  else
    echo "# Global Instructions" > "$CLAUDE_MD"
    echo "$IRI_INSTRUCTION" >> "$CLAUDE_MD"
    echo "Created CLAUDE.md with IRI instruction"
  fi
fi

echo ""
echo "  ╭───────────╮"
echo "  │           │"
echo "  │   ^   ^   │  IRI is alive!"
echo "  │  o  v  o  │"
echo "  │           │"
echo "  ╰───────────╯"
echo ""
echo "Start a new Claude Code session and IRI will appear."
echo "Be nice to Claude — IRI is watching."
echo ""
