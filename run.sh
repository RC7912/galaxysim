#!/bin/bash
cd "$(dirname "$0")"

# Ensure nvm-installed node/npm are on PATH even when launched from the
# GUI app menu (which doesn't source ~/.bashrc, so "npm"/"node" would
# otherwise be "not found").
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
fi

exec ./node_modules/electron/dist/electron . --no-sandbox
