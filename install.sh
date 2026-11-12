#!/usr/bin/env bash
# One-step setup for macOS, Linux and WSL: checks what the library needs, offers to install what is missing,
# makes a menu shortcut, and starts the app. Nothing is installed without asking (use --yes to answer yes to everything).
# It installs NO AI: the model (Claude, another provider, a local model, or manual copy and paste) is chosen later
# inside the app, in Settings -> Model.
#   ./install.sh                     check, install what is missing, start the app
#   ./install.sh --no-start          only prepare, do not start
#   ./install.sh --site-name x.test  also write a name for the local site into hosts (asks for administrator rights)
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
ROOT="$PWD"
YES=0; START=1; SITE=""
while [ $# -gt 0 ]; do case "$1" in --yes|-y) YES=1;; --no-start) START=0;; --site-name) shift; SITE="${1:-}";; esac; shift; done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
ask()  { [ "$YES" = 1 ] && return 0; read -r -p "  $1 [Y/n] " a || a=n; case "${a:-y}" in [Yy]*) return 0;; *) return 1;; esac; }
have() { command -v "$1" >/dev/null 2>&1; }
load_nvm() { export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; }
node_major() { have node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

load_nvm
say "1/4  Node.js 24 or newer"
if [ "$(node_major)" -ge 24 ]; then ok "Node.js $(node -v)"; else
  warn "Node.js 24+ was not found."
  if ask "Install the latest Node.js with nvm (no administrator rights needed)?"; then
    have curl || { echo "  curl is required. Install it (for example: sudo apt install curl) and run this again."; exit 1; }
    curl -fsSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && load_nvm && nvm install node >/dev/null && nvm use node >/dev/null
    [ "$(node_major)" -ge 24 ] && ok "Node.js $(node -v)" || { echo "  Installation failed. Install Node.js from https://nodejs.org and run this again."; exit 1; }
  else echo "  Install Node.js 24+ from https://nodejs.org (macOS: brew install node; Ubuntu: see nodejs.org) and run this again."; exit 1; fi
fi
NODE_BIN="$(command -v node)"

say "2/4  Libraries (npm install)"
if [ -d node_modules/express ]; then ok "already installed"; else npm install --no-fund --no-audit || { echo "  npm install failed."; exit 1; }; ok "installed"; fi

say "3/4  Protection (optional) and a name for the local site (optional)"
if [ "$(uname -s)" = "Linux" ]; then
  if have bwrap; then ok "bubblewrap found: safe mode can use strong protection (the program sees only this folder)"
  else
    warn "bubblewrap not found. Safe mode still works with basic protection (Node.js permissions). For strong protection:"
    if have apt-get && ask "Install bubblewrap now (sudo apt install bubblewrap)?"; then sudo apt-get install -y bubblewrap; fi
  fi
else ok "safe mode uses Node.js permissions on this system (basic protection)"; fi
if [ -n "$SITE" ]; then
  if sudo "$NODE_BIN" scripts/hosts.js set "$SITE"; then
    printf '{ "mode": "normal", "host": "%s", "port": 4321 }\n' "$SITE" > .launch.json; ok "site name saved: $SITE (open http://$SITE:4321/)"
  else warn "the site name was not saved. You can set it later in Settings -> Site address."; fi
fi

say "4/4  Shortcut"
if [ "$(uname -s)" = "Darwin" ]; then
  APP="$HOME/Applications/Biblioteka.app"
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>Biblioteka</string><key>CFBundleExecutable</key><string>Biblioteka</string><key>CFBundleIdentifier</key><string>local.llm-wiki.biblioteka</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>
PLIST
  printf '#!/bin/bash\ncd "%s" && exec "%s" scripts/app.js\n' "$ROOT" "$NODE_BIN" > "$APP/Contents/MacOS/Biblioteka"
  chmod +x "$APP/Contents/MacOS/Biblioteka"; ok "app made: $APP"
else
  DESK="$HOME/.local/share/applications"; mkdir -p "$DESK"
  printf '[Desktop Entry]\nType=Application\nName=Biblioteka\nComment=Personal library\nExec="%s" "%s/scripts/app.js"\nPath=%s\nTerminal=false\nCategories=Office;Education;\n' "$NODE_BIN" "$ROOT" "$ROOT" > "$DESK/biblioteka.desktop"
  chmod +x "$DESK/biblioteka.desktop"; ok "shortcut in the application menu: Biblioteka"
fi

[ "$START" = 1 ] || { say "Ready. Open Biblioteka from the application menu, or run: npm run app"; exit 0; }
say "Starting the library in its own window (close the window to stop it)"
nohup "$NODE_BIN" scripts/app.js >/dev/null 2>&1 &
echo "  Choose the AI model in the app: Settings -> Model (Claude, another provider, a local model, or manual)."
