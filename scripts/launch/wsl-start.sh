#!/usr/bin/env bash
# Starts the Library from WSL (Ubuntu): the server, which runs `claude -p` when needed, and the Windows browser.
# The window stays open while you work: closing it stops the library.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
ROOT="$PWD"
PORT="${PORT:-4321}"
WIKI_URL="http://${WIKI_HOST:-localhost}:$PORT"
# The installer writes WIKI_URL (my.wiki, with or without a port) after it has added the name to hosts. The file is read,
# not executed: this way a line in it cannot run a command.
if [ -f "$ROOT/.wiki-launch" ]; then
  saved="$(sed -n 's/^WIKI_URL=\(http:\/\/[A-Za-z0-9.:-]*\)\r\{0,1\}$/\1/p' "$ROOT/.wiki-launch" | head -1)"
  [ -n "$saved" ] && WIKI_URL="$saved"
fi

pause() { echo; read -r -p "Натисни Enter за затваряне…" _; }

# Paths for node and claude (nvm and the official Claude Code installer are not always in PATH in a non-interactive shell)
export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

open_url() { ( cd /mnt/c 2>/dev/null; cmd.exe /c start "" "$1" >/dev/null 2>&1 ) || wslview "$1" >/dev/null 2>&1 || echo "Отвори ръчно: $1"; }
# The server is running as soon as it answers with any HTTP code. With a password /api/stats returns 401 without a sign-in;
# if we wait only for 200, the browser opens only after 80 attempts (about 40 seconds).
alive() { local code; code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' -H 'x-library: 1' "http://localhost:$PORT/api/stats" 2>/dev/null)"; [ -n "$code" ] && [ "$code" != "000" ]; }

echo "📚 Библиотека"
if alive; then
  echo "Вече работи. Отварям $WIKI_URL"
  open_url "$WIKI_URL"; exit 0
fi

command -v node >/dev/null || { echo "❌ Не намирам Node.js. Инсталирай го в Ubuntu (например през nvm) и опитай пак."; pause; exit 1; }
[ -d node_modules ] || { echo "Първо стартиране: инсталирам зависимостите (npm install)…"; npm install || { pause; exit 1; }; }

if command -v claude >/dev/null; then
  echo "✔ Claude Code: $(claude --version 2>/dev/null | head -1)"
else
  echo "⚠ Не намирам Claude Code в Ubuntu. Библиотеката ще се отваря, но бутоните за обработка няма да работят."
  echo "  Инсталирай го и влез веднъж с \`claude\` в терминала на Ubuntu."
fi

# The browser opens when the server starts to answer
( for _ in $(seq 1 80); do alive && break; sleep 0.5; done; open_url "$WIKI_URL" ) &

# Isolation: with bubblewrap the server and its packages see only the project folder (scripts/sandbox.js).
# LIB_SANDBOX=off turns it off.
START=(node scripts/server.js)
if [ "${LIB_SANDBOX:-}" = "off" ]; then
  echo "⚠ Изолацията е изключена (LIB_SANDBOX=off)."
elif command -v bwrap >/dev/null; then
  START=(node scripts/sandbox.js)
  echo "🔒 Изолация: включена (програмата вижда само папката на проекта)"
else
  echo "⚠ Без изолация: пакетите на програмата виждат всичките ти файлове."
  echo "  Включва се еднократно с:  sudo apt install bubblewrap"
fi

echo "▶ Сървър на порт $PORT, адрес $WIKI_URL (Ctrl+C или затваряне на прозореца спира библиотеката)"
# Code 75: the server asks to be started again (after packages were updated from "Settings -> Updates").
# In the isolation scripts/sandbox.js does this itself; the loop here is for running without it.
export LIB_SUPERVISED=1
while :; do
  PORT="$PORT" "${START[@]}"
  code=$?
  [ "$code" -eq 75 ] || break
  echo "↻ Пускам библиотеката отново с обновените пакети…"
done
echo "Сървърът спря."
pause
