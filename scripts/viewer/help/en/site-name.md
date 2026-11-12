# A name for the local site

By default the library is at `http://localhost:4321/`. If you want a name of your own (for example `biblioteka.test`), the program writes it into the system's **hosts** file. The name works only on this computer, in all browsers.

## How to do it

**Settings → Site address**:

1. Type a name. Ideas: `biblioteka.test`, `my-library.test`, `wiki.localhost`.
2. Press **Save the name**. The system shows its own window asking for administrator permission (UAC on Windows, a password on macOS, a polkit window on Linux). The program never sees your password.
3. The server restarts and the page opens at the new address. The port stays in the address (`http://biblioteka.test:4321/`).

The name is removed with **Remove the name**.

## Rules for the name

- Letters, digits and hyphens; parts separated by dots; up to 4 parts.
- It cannot be `localhost` or only digits.
- **Prefer `.test`, `.localhost`, `.local`, `.lan`, `.internal`.** These endings do not lead to real websites. If you use a name such as `google.com`, that site will not open on your computer; the program asks for an explicit tick for such names.
- A name without a dot works, but in a browser's address bar it becomes a web search.

## What happens in the file

Only a block is added:

```
# llm-wiki begin
127.0.0.1 biblioteka.test
::1 biblioteka.test
# llm-wiki end
```

A backup copy `hosts.llm-wiki.bak` stays next to the file. The files:

| System | Path |
|---|---|
| Windows | `C:\Windows\System32\drivers\etc\hosts` |
| macOS, Linux | `/etc/hosts` |
| WSL | the Windows one (the browser is there), the same path through `/mnt/c/...` |

## Why the server accepts only this name

The server answers only for `localhost` and the saved name. This way another website that points to `127.0.0.1` (a "DNS rebinding" attack) cannot read your library.

## From a terminal

```
sudo node scripts/hosts.js set biblioteka.test   # Linux, macOS
node scripts/hosts.js set biblioteka.test        # Windows, terminal as administrator
node scripts/hosts.js show
node scripts/hosts.js remove
```

After a manual change restart the library with `WIKI_HOST=biblioteka.test` or through `npm run app` (the launcher reads `.launch.json`).

## If it does not work

Clear the DNS cache (`ipconfig /flushdns` on Windows), turn off "Secure DNS" in the browser for local names, and see [When something does not work](#/docs/troubleshooting).
