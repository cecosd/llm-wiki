# Security

LLM Wiki is developed by SDevelopers LTD (ЕсДевелопърс ЕООД) together with Claude. It is designed for one person on their own computer. It is not designed for a server or for shared access, and it has not had an independent security audit.

The current results are on the [product page](docs/index.html) and on the Settings page in the application. Run `npm test` to check your own machine.

## What is protected

- **Network.** The server listens only on `127.0.0.1`. Requests with a foreign `Host` header (DNS rebinding) are refused. The name `my.wiki` is accepted only after the Windows installer has written it into the hosts file (or when `WIKI_HOST` is set): `.wiki` is a real top-level domain, and without the hosts entry the name would lead to someone else's server. Requests from other websites are refused, including simple reads, and requests other than GET need the `x-library` header.
- **HTML in pages.** Page text comes from documents and from Claude, so it is not trusted. It is rendered through an allowlist sanitizer: scripts, event handlers, frames, styles and `javascript:` links are removed. Images are kept only when they are embedded (`data:`) or local, because an external image loads by itself and can carry data out in its address (the reading archive opens from disk without a Content-Security-Policy). In the application a Content-Security-Policy is the second layer: inline code does not run even if something passes the sanitizer, and external images do not load.
- **Uploaded files.** `/raw/` serves only files inside `raw/`, and an uploaded file cannot leave `raw/inbox/`. Uploaded HTML and SVG open in an isolated sandbox with no access to the application.
- **“Add an article”.** It accepts only https and refuses addresses in the local network. The address is checked at the moment of connecting, and the connection uses exactly the checked address, which closes the DNS rebinding window. Size limits apply to decompressed data.
- **Claude during processing.** It runs with `--permission-mode dontAsk` and a fixed tool list: writing only in `wiki/` and `outputs/`, named `npm run` commands, no general shell, no network tool. Reading and searching work only inside the project folder: `Read(./**)` plus a `PreToolUse` hook (`scripts/guard-read.js`) that also covers Grep, Glob and the chapter reader. The hook also refuses the restore history, the settings and the password file. This was checked with the real Claude Code, not only with the simulated one. The commands Claude may run cannot be used to get around this: `npm run extract` accepts only files inside `raw/`, and the hook's settings are written to a private temporary folder, outside the folders Claude may write to.
- **Paths written by Claude.** The `raw_path` field of a page is not trusted when the server deletes or reads files: a path that leaves `raw/.extracted/` is ignored.
- **Isolation (Linux and WSL).** `npm run serve:safe`, and the desktop shortcut in WSL when `bubblewrap` is installed, run the server, every package in `node_modules` and Claude Code in a bubblewrap sandbox. Inside, only the project folder is visible. The code (`scripts/`, `node_modules/`, `.claude/`, `CLAUDE.md`, `package.json`, `.git`) is read-only, and only the library data (`raw/`, `wiki/`, `drafts/`, `outputs/`, `.library-git/`, `.ocr-data/`, the settings and the password file) can be written. Your home folder (`~/.ssh`, other projects, `~/.claude.json`, the history of other Claude conversations), the Windows drives under `/mnt`, the WSL sockets that start Windows programs and the environment variables are not visible. Claude Code gets its sign-in file and a private copy of its state; your Claude Code settings are read-only. The code is read-only because otherwise a compromised package could change a file that later runs outside the sandbox. The one action that must write there, changing the content language from the menu, is done by the launcher outside the sandbox (`scripts/sandbox.js`, which loads no packages): the server asks for it through a private folder, and the launcher installs only an existing pack from `content/`, which is itself read-only inside. `npm run sandbox:check` shows what can be seen from inside. Install bubblewrap once with `sudo apt install bubblewrap`.
- **Installing packages.** `.npmrc` turns off install scripts (`ignore-scripts=true`), where most supply-chain attacks start. No dependency needs one.
- **Updating packages from Settings.** The “Update” buttons in Settings → Updates run `npm update` with `--ignore-scripts`, only for direct dependencies named in `package.json` and only to the versions its ranges allow; major versions are shown as a command to copy, not installed. Inside the isolation `node_modules/` is read-only, so the launcher outside runs npm (`scripts/npm-update.js`, which loads no packages). The sandbox can only ask for package names: `package.json`, which sets the allowed versions, stays read-only inside, so it cannot choose what gets installed. The previous `package-lock.json` is kept only in the launcher's memory, never in a folder the sandbox can write: a lock file there could be swapped for one that points to foreign packages. If the server does not start with the new versions within 30 seconds, the launcher reinstalls the previous ones (`npm ci`). A compromised package inside the sandbox could trigger such an update without you, but the result is the same as pressing the button yourself.
- **Password (optional).** Settings can turn on a password for the interface. Only a salted scrypt hash is stored, in `.library-auth.json`, outside git. Sessions use an `HttpOnly`, `SameSite=Strict` cookie, and repeated wrong attempts pause sign-in for a minute. If you forget it, stop the application and delete that file.

## Known limitations

- **Files are not encrypted.** Pages are plain text on disk, because Claude Code and the application must read them. Use full-disk encryption (BitLocker, FileVault, LUKS) for sensitive material. The password protects the interface, not the files.
- **The password is off by default,** and it does not stop other programs running under your account from reading the files directly.
- **Prompt injection cannot be fully prevented.** A harmful document can still mislead Claude into writing wrong or misleading text in `wiki/`. Claude can also read anything inside the project, such as your other sources, and that text goes to Anthropic. The limits above restrict what it can do, not what it can be persuaded to write.
- **`'unsafe-eval'` remains in the policy.** Vue compiles its templates in the browser and needs it. Inline scripts stay blocked.
- **The isolation keeps the network open,** because Claude and “Add an article” need it. A compromised package inside it could still send out what it can see: the library itself and the Claude sign-in token. It cannot see the rest of your computer.
- **The isolation exists only on Linux and WSL.** On macOS and on Windows without WSL, and when you start with `npm run serve`, the packages run with all your rights.
- **Without the isolation,** a symbolic link inside `raw/` that points outside the folder would be followed. Nothing in the application creates one, but code running with your rights could.
- **Dependencies.** New vulnerabilities appear over time. Check with `npm audit` or the Settings page. `package.json` uses `overrides` to replace vulnerable packages inside `exceljs`, whose own releases have not caught up; check these on every update.

## Data sent to Anthropic

Text processed with Claude goes to Anthropic through Claude Code. Whether it is used for model training depends on your plan and settings: see the “Where your data goes” section on the product page and Anthropic (2026a).

## Other models and API keys

- **Where the text goes.** With another provider (Settings → Model) the text goes to that provider, under its terms; free tiers often use the content for training. A local model (Ollama, LM Studio) keeps everything on the computer. In copy-and-paste mode nothing is sent by the application: you paste each request into a chat yourself.
- **Keys.** API keys are kept in `.library-secrets.json` in the project folder: created with mode 0600, listed in `.gitignore`, not in the reading archive, refused to the agent by `--disallowedTools` and by the `guard-read.js` hook, and writable inside the isolation only as that one file. The settings page receives only the last 4 characters. A key can also come from an environment variable (`LIB_AI_KEY` or the usual one of the provider); such variables pass into the isolation.
- **Claude Code with another provider.** The application sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and the three model names only for that run; the permission rules, the hook and the isolation stay the same. With the Claude subscription the environment of Claude Code is not changed.
- **Without tools** the model cannot read or write files at all: the server sends the text and writes the pages itself, and links to pages that do not exist become plain text.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/cecosd/llm-wiki/security/advisories/new). If it is not available, open an issue without technical details and ask for a private contact. Do not publish working exploits before a fix.

## References

Anthropic. (2026a). *Data usage*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/data-usage

Anthropic. (2026b). *Configure permissions*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/permissions

Containers. (n.d.). *bubblewrap: Low-level unprivileged sandboxing tool used by Flatpak and similar projects* [Computer software]. GitHub. https://github.com/containers/bubblewrap

Node.js. (n.d.). *Permissions*. Node.js documentation. https://nodejs.org/api/permissions.html
