# When something does not work

First look at `outputs/server.log` in the library folder: the launcher writes there what it did and why it stopped.

## The library does not open

| Sign | Cause and fix |
|---|---|
| Dialog "Node.js 24 or newer is required" | Run the installer again: it puts in the latest Node.js. |
| "The libraries are not installed" | Run the installer (`install.cmd` or `./install.sh`) or `npm install`. |
| "No free port" | Close the program that holds ports 4321 to 4340, or change `port` in `.launch.json`. |
| The window opens and closes at once | The browser handed the job to another process. Try `LIB_BROWSER` with another browser, or `npm run app -- --no-window` and open the address by hand. |
| White screen | Reload (Ctrl R). If it stays, see `server.log` and the browser console. |

## It does not stop when I close the window

If there is no Edge, Chrome, Chromium or Brave, the default browser is used and the server stops about 30 seconds after the last tab closes. Stop it at once with **Quit the library** in the menu.

## The site name does not open

1. Check that it is saved: `node scripts/hosts.js show`.
2. Clear the cache: `ipconfig /flushdns` (Windows).
3. Turn off "Secure DNS" or "DNS over HTTPS" in the browser for local names.
4. Do not forget the port: `http://biblioteka.test:4321/`.
5. A VPN or a corporate policy may ignore `hosts`.

## Safe mode

- "Safe mode is not available": Node.js 23+ is needed. Update it.
- A scanned PDF is not recognised: the built-in OCR is off in basic protection. Go back to normal mode for this file or install `ocrmypdf`.
- A backup to another folder fails: in safe mode copies are off.

## The model

- "The model is not set up": **Settings → Model**.
- A key or credit error: **Test the connection** shows what the provider says.
- "Limit reached": free tiers have limits; the queue waits and continues by itself.
- Claude Code is not installed: it is needed only if you chose Claude; otherwise pick another profile.

## Undoing and repairing

- A bad result of processing: **Undo** (needs `git`).
- Broken links: `npm run lint:quick`.
- Lost `index.md` or `log.md`: `npm run index`.

## Removing everything

Delete the folder and the shortcuts. Remove the block between `# llm-wiki begin` and `# llm-wiki end` in `hosts` first from [Settings → Site address](#/settings/address).
