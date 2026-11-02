#!/usr/bin/env bash
# Стартира Библиотеката от WSL (Ubuntu): сървърът, който при нужда пуска `claude -p`, и браузъра на Windows.
# Прозорецът остава отворен, докато работиш: затварянето му спира библиотеката.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
ROOT="$PWD"
PORT="${PORT:-4321}"
WIKI_HOST="${WIKI_HOST:-my.wiki}"
WIKI_URL="http://$WIKI_HOST:$PORT"
[ -f "$ROOT/.wiki-launch" ] && . "$ROOT/.wiki-launch"   # инсталаторът записва WIKI_URL (с или без порт)

pause() { echo; read -r -p "Натисни Enter за затваряне…" _; }

# Пътища за node и claude (nvm и официалният инсталатор на Claude Code не винаги са в PATH при неинтерактивна обвивка)
export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

open_url() { ( cd /mnt/c 2>/dev/null; cmd.exe /c start "" "$1" >/dev/null 2>&1 ) || wslview "$1" >/dev/null 2>&1 || echo "Отвори ръчно: $1"; }
alive() { curl -fs -m 2 -o /dev/null -H 'x-library: 1' "http://localhost:$PORT/api/stats"; }

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

# Браузърът се отваря, когато сървърът започне да отговаря
( for _ in $(seq 1 80); do alive && break; sleep 0.5; done; open_url "$WIKI_URL" ) &

echo "▶ Сървър на порт $PORT, адрес $WIKI_URL (Ctrl+C или затваряне на прозореца спира библиотеката)"
PORT="$PORT" WIKI_HOST="$WIKI_HOST" node scripts/server.js
echo "Сървърът спря."
pause
