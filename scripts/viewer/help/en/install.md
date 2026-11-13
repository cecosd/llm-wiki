# Installing

The installer does everything needed to run and **does not require any AI**. You choose the model afterwards, inside the app.

## Windows

1. Unzip the library folder somewhere it can stay (for example `Documents\Biblioteka`).
2. Double-click `install.cmd`. A setup wizard window opens, not a black screen.
3. The wizard checks and, if needed, installs:
   - **Node.js** (the latest version). If you have none or one older than 24, it is downloaded from nodejs.org (through `winget`, or as an installer if `winget` is missing). Windows may show a window asking for permission.
   - **The program's libraries** (`npm install`). It needs the internet and takes a minute or two.
4. Optionally it asks for a **site name** (for example `biblioteka.test`) and whether to create shortcuts on the desktop and in the Start menu. The name is written to `hosts` with a separate Windows permission window. You can skip it and set it later: [A name for the local site](#/docs/site-name).
5. At the end press "Open the library".

From then on you open the library with the shortcut. There is no server window: the app opens in its own window, and when you close it the server stops.

## macOS and Linux

In a terminal, in the library folder:

```
./install.sh
```

The script asks before each installation (`--yes` answers yes to everything). On Linux it also offers `bubblewrap` for strong safe mode ([see Safe mode](#/docs/safe-mode)). It creates a shortcut in the application menu.

## What the computer needs

- Windows 10/11, macOS or Linux; WSL is not needed.
- An internet connection during installation (and when using an online model).
- Edge, Chrome, Chromium or Brave for the app window. If none exists, the default browser is used and the library stops by itself about half a minute after it is closed.

## Removing

**Windows:** double-click `uninstall.cmd`. A window opens. It stops the library, removes the shortcuts, the site name from `hosts` (Windows asks for permission) and the launcher state, and optionally the installed libraries (`node_modules`). **Your library is kept** (sources, wiki pages, drafts, settings) unless you tick "also delete this whole folder", which asks for a second confirmation. Make a backup first ([Backups](#/docs/backup)).

**macOS, Linux, WSL:** `./uninstall.sh` (`--keep-modules` keeps `node_modules`; `--everything` also deletes the whole folder, including your library, after you type the folder name).

Node.js (and nvm, bubblewrap) are never removed, because other programs may use them. Remove Node.js like any other program (Windows: Settings → Apps).

Next: [First start](#/docs/first-run).
