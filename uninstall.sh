#!/usr/bin/env bash
# Uninstall for macOS, Linux and WSL. By default your library (raw/, wiki/, drafts/, outputs/, settings) is KEPT.
# Node.js, nvm and bubblewrap are never removed, because other programs may use them.
#   ./uninstall.sh                  stop the app, remove the shortcut, the site name and the libraries (node_modules)
#   ./uninstall.sh --keep-modules   leave node_modules in place
#   ./uninstall.sh --everything     ALSO delete this whole folder, including your library (asks you to type the folder name)
#   ./uninstall.sh --yes            do not ask (with --everything it still asks for the folder name)
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
ROOT="$PWD"
YES=0; MODULES=1; ALL=0
while [ $# -gt 0 ]; do case "$1" in --yes|-y) YES=1;; --keep-modules) MODULES=0;; --everything) ALL=1;; esac; shift; done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
load_nvm() { export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; }
load_nvm
NODE_BIN="$(command -v node || true)"

echo "This removes the library program from this computer. Folder: $ROOT"
[ "$ALL" = 1 ] && warn "--everything: this folder will be DELETED with your sources, wiki pages and drafts."
if [ "$YES" = 0 ]; then read -r -p "Continue? [y/N] " a || a=n; case "${a:-n}" in [Yy]*) ;; *) echo "Cancelled."; exit 0;; esac; fi
if [ "$ALL" = 1 ]; then
  read -r -p "Type the folder name ($(basename "$ROOT")) to confirm deleting everything: " n || n=""
  [ "$n" = "$(basename "$ROOT")" ] || { echo "Not confirmed. Nothing was deleted."; exit 1; }
fi

say "1/4  Stop the app"
# Same state folder as scripts/app.js: <state root>/llm-wiki/<first 12 hex of sha256 of the folder path>
case "$(uname -s)" in
  Darwin) STATE_ROOT="$HOME/Library/Application Support/llm-wiki";;
  *) STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/llm-wiki";;
esac
if [ -n "$NODE_BIN" ]; then HASH="$(printf '%s' "$ROOT" | "$NODE_BIN" -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(0,'utf8')).digest('hex').slice(0,12))")"; else HASH=""; fi
STATE="$STATE_ROOT/$HASH"
if [ -n "$HASH" ] && [ -f "$STATE/launcher.json" ] && [ -n "$NODE_BIN" ]; then
  PID="$("$NODE_BIN" -e "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).pid))}catch{}" "$STATE/launcher.json")"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null; sleep 1; ok "stopped the running library"; else ok "not running"; fi
else ok "not running"; fi

say "2/4  Shortcut and launcher state"
if [ "$(uname -s)" = "Darwin" ]; then rm -rf "$HOME/Applications/Biblioteka.app" && ok "removed ~/Applications/Biblioteka.app"
else rm -f "$HOME/.local/share/applications/biblioteka.desktop" && ok "removed the application menu entry"; fi
[ -n "$HASH" ] && rm -rf "$STATE" && ok "removed the launcher state"
rmdir "$STATE_ROOT" 2>/dev/null || true
rm -f .launch.json

say "3/4  Site name in hosts"
if [ -n "$NODE_BIN" ] && [ -n "$("$NODE_BIN" scripts/hosts.js show 2>/dev/null)" ]; then
  if sudo "$NODE_BIN" scripts/hosts.js remove; then ok "site name removed from hosts"; else warn "not removed. Delete the block between '# llm-wiki begin' and '# llm-wiki end' in /etc/hosts."; fi
else ok "none set"; fi

say "4/4  Libraries"
if [ "$MODULES" = 1 ] || [ "$ALL" = 1 ]; then rm -rf node_modules && ok "removed node_modules"; else ok "kept node_modules"; fi

if [ "$ALL" = 1 ]; then
  say "Deleting the whole folder"
  cd / && rm -rf "$ROOT" && ok "deleted $ROOT"
else
  say "Done. Your library in $ROOT is kept. To delete it too: ./uninstall.sh --everything"
fi
