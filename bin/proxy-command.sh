#!/bin/zsh
set -e
cd "$HOME/workspaces/proxy"
export PORT=9000
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null
exec node --require ./node_modules/tsx/dist/preflight.cjs --import "file://$PWD/node_modules/tsx/dist/loader.mjs" src/backend/server.ts
