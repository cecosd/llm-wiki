#!/usr/bin/env bash
# Стартира Библиотеката от WSL (Ubuntu): сървърът, който при нужда пуска `claude -p`, и браузъра на Windows.
# Прозорецът остава отворен, докато работиш: затварянето му спира библиотеката.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
ROOT="$PWD"
PORT="${PORT:-4321}"
WIKI_URL="http://${WIKI_HOST:-localhost}:$PORT"
# Инсталаторът записва WIKI_URL (my.wiki, с или без порт), след като е добавил името в hosts. Файлът се чете,
# не се изпълнява: така ред в него не може да пусне команда.
if [ -f "$ROOT/.wiki-launch" ]; then
  saved="$(sed -n 's/^WIKI_URL=\(http:\/\/[A-Za-z0-9.:-]*\)\r\{0,1\}$/\1/p' "$ROOT/.wiki-launch" | head -1)"
  [ -n "$saved" ] && WIKI_URL="$saved"
fi

pause() { echo; read -r -p "Натисни Enter за затваряне…" _; }

# Пътища за node и claude (nvm и официалният инсталатор на Claude Code не винаги са в PATH при неинтерактивна обвивка)
export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

open_url() { ( cd /mnt/c 2>/dev/null; cmd.exe /c start "" "$1" >/dev/null 2>&1 ) || wslview "$1" >/dev/null 2>&1 || echo "Отвори ръчно: $1"; }
# Сървърът работи, щом отговори с какъвто и да е HTTP код. С парола /api/stats връща 401 без вход;
# ако чакаме само 200, браузърът се отваря чак след 80 опита (около 40 секунди).
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

# Браузърът се отваря, когато сървърът започне да отговаря
( for _ in $(seq 1 80); do alive && break; sleep 0.5; done; open_url "$WIKI_URL" ) &

# Изолация: с bubblewrap сървърът и пакетите му виждат само папката на проекта (scripts/sandbox.js).
# LIB_SANDBOX=off я изключва.
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
# Код 75: сървърът иска да бъде пуснат отново (след обновени пакети от „Настройки → Обновления“).
# В изолацията това го прави самият scripts/sandbox.js; цикълът тук е за пускането без нея.
export LIB_SUPERVISED=1
while :; do
  PORT="$PORT" "${START[@]}"
  code=$?
  [ "$code" -eq 75 ] || break
  echo "↻ Пускам библиотеката отново с обновените пакети…"
done
echo "Сървърът спря."
pause
