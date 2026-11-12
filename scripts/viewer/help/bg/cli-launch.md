# Пускане от терминала

Има два начина: със **стартера** (като прекия път) или направо със **сървъра**.

## Стартерът (`scripts/app.js`)

```
npm run app                    # скрит сървър + прозорец на приложението; затварянето на прозореца го спира
npm run app -- --safe          # защитен режим (запомня се в .launch.json)
npm run app -- --normal        # обикновен режим
npm run app -- --no-window     # само сървърът, без прозорец; Ctrl+C го спира
npm run app -- --check         # печата JSON: версия на Node, режим, защита, браузър, порт; нищо не пуска
```

Какво прави: избира свободен порт (от 4321 нагоре), пуска сървъра със скрит прозорец и дневник в `outputs/server.log`, отваря прозорец със собствен профил на Edge/Chrome/Chromium/Brave и чака затварянето му. Ако сървърът излезе с код 75 (след обновяване на пакети от интерфейса), го пуска отново.

Стартерът слуша за заявки от интерфейса (смяна на режим, име на сайта, спиране) във файла `outputs/.launcher/request.json`. Работи и в клетка, и под `node --permission`, където няма друг канал.

## `.launch.json`

Файл в корена на проекта (извън Git):

```json
{ "mode": "normal", "host": "", "port": 4321 }
```

`mode` е `normal` или `safe`, `host` е името на сайта, `port` е желаният порт.

## Само сървърът

```
npm run serve              # http://localhost:4321, без защита
npm run serve:safe         # в клетка (bubblewrap): Linux и WSL
PORT=4557 npm run serve    # друг порт (PowerShell: $env:PORT=4557)
```

Сървърът върви на преден план и показва логовете си; Ctrl+C го спира. Без стартер интерфейсът не може да сменя режима и името (показва команди за ръчно изпълнение).

## Windows без черен екран

Преките пътища сочат към `scripts\launch\Biblioteka.vbs`, който пуска `node scripts\app.js` скрито. От терминала: `wscript //B scripts\launch\Biblioteka.vbs`.

## Linux и macOS

`install.sh` създава `Biblioteka.desktop` (Linux) в менюто на приложенията. Ръчно: `nohup npm run app >/dev/null 2>&1 &`.

## WSL

От Windows през `wsl.exe -d Ubuntu --cd <папка> -e bash scripts/launch/wsl-start.sh` (старият начин, с прозорец на терминала). За нов начин без WSL инсталирай Node.js в Windows и ползвай инсталатора там.
