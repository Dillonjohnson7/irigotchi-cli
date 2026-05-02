#!/bin/bash

INSTALL_DIR="$HOME/.claude/irigotchi"
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

echo ""
echo "  ╭───────────╮"
echo "  │  ///////  │"
echo "  │   x   x   │  Uninstalling IRIgotchi..."
echo "  │    ___    │"
echo "  │   ///     │"
echo "  ╰───────────╯"
echo ""

# Remove hook from settings.json
if [ -f "$SETTINGS_FILE" ] && grep -q "irigotchi" "$SETTINGS_FILE"; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
    if (settings.hooks?.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        h => !JSON.stringify(h).includes('irigotchi')
      );
      if (settings.hooks.UserPromptSubmit.length === 0) {
        delete settings.hooks.UserPromptSubmit;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
  "
  echo "Removed hook from settings.json"
fi

# Remove IRI section from CLAUDE.md
if [ -f "$CLAUDE_MD" ] && grep -q "IRI Status Display" "$CLAUDE_MD"; then
  node -e "
    const fs = require('fs');
    let content = fs.readFileSync('$CLAUDE_MD', 'utf-8');
    content = content.replace(/\n## IRI Status Display[\s\S]*?(?=\n## |\n# |$)/, '');
    content = content.trim();
    if (content === '# Global Instructions') {
      fs.unlinkSync('$CLAUDE_MD');
    } else {
      fs.writeFileSync('$CLAUDE_MD', content + '\n');
    }
  "
  echo "Removed IRI instruction from CLAUDE.md"
fi

# Remove install directory
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "Removed $INSTALL_DIR"
fi

echo ""
echo "IRIgotchi has been uninstalled. Goodbye."
echo ""
