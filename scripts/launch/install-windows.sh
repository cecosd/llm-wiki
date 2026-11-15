#!/usr/bin/env bash
# One-time Windows setup (needs administrator rights through UAC):
#  1) writes  127.0.0.1 my.wiki  into the hosts file
#  2) redirects port 80 to the port of the library, if port 80 is free (then the address is http://my.wiki)
#  3) creates a "Library" shortcut on the desktop
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
ROOT="$PWD"
PORT="${PORT:-4321}"
WIKI_HOST="${WIKI_HOST:-my.wiki}"
[ -n "${WSL_DISTRO_NAME:-}" ] || { echo "Това се пуска от WSL (Ubuntu)."; exit 1; }

WIN_TMP="$(cd /mnt/c && cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
LIN_TMP="$(wslpath "$WIN_TMP")"
cp scripts/launch/install-windows.ps1 "$LIN_TMP/wiki-install.ps1"
rm -f "$LIN_TMP/wiki-install.txt"

echo "Ще се появи прозорец на Windows за разрешение (UAC). Потвърди го."
powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"$WIN_TMP\\wiki-install.ps1\" -Distro \"$WSL_DISTRO_NAME\" -Dir \"$ROOT\" -WikiHost \"$WIKI_HOST\" -Port $PORT -Result \"$WIN_TMP\\wiki-install.txt\"'" >/dev/null 2>&1

for _ in $(seq 1 120); do [ -s "$LIN_TMP/wiki-install.txt" ] && break; sleep 1; done
[ -s "$LIN_TMP/wiki-install.txt" ] || { echo "❌ Не получих резултат (разрешението е отказано или е изтекло времето)."; exit 1; }
RES="$(tr -d '\r' < "$LIN_TMP/wiki-install.txt")"
echo "$RES"
if echo "$RES" | grep -q '^STATUS=ok'; then
  if echo "$RES" | grep -q '^PORT80=yes'; then echo "WIKI_URL=http://$WIKI_HOST" > "$ROOT/.wiki-launch"; else echo "WIKI_URL=http://$WIKI_HOST:$PORT" > "$ROOT/.wiki-launch"; fi
  echo; echo "✔ Готово. На работния плот има пряк път „Библиотека“. Адрес: $(. "$ROOT/.wiki-launch"; echo "$WIKI_URL")"
else
  echo "❌ Настройката не завърши."; exit 1
fi
