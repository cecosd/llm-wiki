#!/usr/bin/env bash
# One-step setup for macOS, Linux and WSL: checks what the library needs, offers to install what is missing,
# then starts it. Nothing is installed without asking (use --yes to answer yes to everything).
#   ./install.sh              check, install what is missing, start the server
#   ./install.sh --no-start   only prepare, do not start
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
YES=0; START=1
for a in "$@"; do case "$a" in --yes|-y) YES=1;; --no-start) START=0;; esac; done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
ask()  { [ "$YES" = 1 ] && return 0; read -r -p "  $1 [Y/n] " a || a=n; case "${a:-y}" in [Yy]*) return 0;; *) return 1;; esac; }
have() { command -v "$1" >/dev/null 2>&1; }
load_nvm() { export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"; }
node_major() { have node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

load_nvm
say "1/4  Node.js 20 or newer"
if [ "$(node_major)" -ge 20 ]; then ok "Node.js $(node -v)"; else
  warn "Node.js 20+ was not found."
  if ask "Install Node.js with nvm (no administrator rights needed)?"; then
    have curl || { echo "  curl is required. Install it (for example: sudo apt install curl) and run this again."; exit 1; }
    curl -fsSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && load_nvm && nvm install 24 >/dev/null && nvm use 24 >/dev/null
    [ "$(node_major)" -ge 20 ] && ok "Node.js $(node -v)" || { echo "  Installation failed. Install Node.js from https://nodejs.org and run this again."; exit 1; }
  else echo "  Install Node.js 20+ from https://nodejs.org (macOS: brew install node; Ubuntu: see nodejs.org) and run this again."; exit 1; fi
fi

say "2/4  Libraries (npm install)"
if [ -d node_modules/express ]; then ok "already installed"; else npm install || { echo "  npm install failed."; exit 1; }; ok "installed"; fi

say "3/4  Claude Code"
if have claude; then ok "$(claude --version 2>/dev/null | head -1)"; else
  warn "Claude Code was not found. It reads and writes the pages for you."
  if ask "Install it now with the official installer (https://claude.ai/install.sh)?"; then
    curl -fsSL https://claude.ai/install.sh | bash; load_nvm
  fi
  have claude && ok "$(claude --version 2>/dev/null | head -1)" || warn "Not installed. You can still browse the library; install it later from the Setup page."
fi
if have claude; then
  if claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then ok "signed in to your Claude account"; else
    warn "You are not signed in."
    echo "  A browser window opens to sign in with a Claude subscription (Pro or Max) or an Anthropic API key."
    if ask "Sign in now?"; then claude auth login || claude; fi
  fi
fi

say "4/4  Optional"
have git && ok "git $(git --version | cut -d' ' -f3) (gives the Undo button)" || warn "git not found: the Undo button will be unavailable (macOS: brew install git; Ubuntu: sudo apt install git)."
SERVE=serve
if [ "$(uname -s)" = "Linux" ]; then
  if ! have bwrap; then
    warn "bubblewrap not found: without it the libraries the program uses can see all your files (see SECURITY.md)."
    if have apt-get && ask "Install bubblewrap now (sudo apt install bubblewrap)?"; then sudo apt-get install -y bubblewrap; fi
  fi
  if have bwrap; then ok "isolation (bubblewrap): the program sees only this folder"; SERVE=serve:safe; fi
fi

[ "$START" = 1 ] || { say "Ready. Start with: npm run $SERVE"; exit 0; }
say "Starting the library at http://localhost:4321  (Ctrl+C stops it)"
( sleep 2; { have xdg-open && xdg-open http://localhost:4321; } >/dev/null 2>&1 || { have open && open http://localhost:4321; } >/dev/null 2>&1 || { have cmd.exe && cmd.exe /c start "" http://localhost:4321; } >/dev/null 2>&1 ) &
exec npm run "$SERVE"
