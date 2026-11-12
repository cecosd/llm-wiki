# Starting from a terminal

There are two ways: with the **launcher** (like the shortcut) or straight with the **server**.

## The launcher (`scripts/app.js`)

```
npm run app                    # hidden server + app window; closing the window stops it
npm run app -- --safe          # safe mode (remembered in .launch.json)
npm run app -- --normal        # normal mode
npm run app -- --no-window     # only the server, no window; Ctrl+C stops it
npm run app -- --check         # prints JSON: Node version, mode, protection, browser, port; starts nothing
```

What it does: picks a free port (from 4321 up), starts the server hidden with a log in `outputs/server.log`, opens a window with its own Edge/Chrome/Chromium/Brave profile and waits for it to close. If the server exits with code 75 (after packages were updated from the interface), it starts it again.

The launcher listens for requests from the interface (change mode, site name, quit) in the file `outputs/.launcher/request.json`. This works in a cage and under `node --permission`, where there is no other channel.

## `.launch.json`

A file in the project root (outside Git):

```json
{ "mode": "normal", "host": "", "port": 4321 }
```

`mode` is `normal` or `safe`, `host` is the site name, `port` is the preferred port.

## Only the server

```
npm run serve              # http://localhost:4321, no protection
npm run serve:safe         # in a cage (bubblewrap): Linux and WSL
PORT=4557 npm run serve    # another port (PowerShell: $env:PORT=4557)
```

The server runs in the foreground and shows its logs; Ctrl+C stops it. Without the launcher the interface cannot change the mode and the name (it shows commands to run by hand).

## Windows without a black screen

The shortcuts point to `scripts\launch\Biblioteka.vbs`, which starts `node scripts\app.js` hidden. From a terminal: `wscript //B scripts\launch\Biblioteka.vbs`.

## Linux and macOS

`install.sh` creates `Biblioteka.desktop` (Linux) in the application menu. By hand: `nohup npm run app >/dev/null 2>&1 &`.

## WSL

From Windows through `wsl.exe -d Ubuntu --cd <folder> -e bash scripts/launch/wsl-start.sh` (the old way, with a terminal window). For the new way without WSL, install Node.js on Windows and use the installer there.
