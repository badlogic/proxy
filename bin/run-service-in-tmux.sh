#!/bin/zsh
set -euo pipefail
SESSION="$1"
shift
TMUX="$HOME/.local/tmux-env/bin/tmux"
export PATH="$HOME/.local/tmux-env/bin:$HOME/.nvm/versions/node/v20.19.6/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if ! "$TMUX" has-session -t "$SESSION" 2>/dev/null; then
  "$TMUX" new-session -d -s "$SESSION" "$*"
fi
while "$TMUX" has-session -t "$SESSION" 2>/dev/null; do
  sleep 30
done
exit 1
