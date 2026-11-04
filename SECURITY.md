# Security

LLM Wiki is developed by SDevelopers LTD (ЕсДевелопърс ЕООД) together with Claude. It is designed for one person on their own computer. It is not designed for a server or for shared access, and it has not had an independent security audit.

The current results are on the [product page](docs/index.html) and on the Settings page in the application. Run `npm test` to check your own machine.

## What is protected

- **Network.** The server listens only on `127.0.0.1`. Requests with a foreign `Host` header (DNS rebinding) are refused. Requests from other websites are refused, including simple reads, and requests other than GET need the `x-library` header.
- **HTML in pages.** Page text comes from documents and from Claude, so it is not trusted. It is rendered through an allowlist sanitizer: scripts, event handlers, frames, styles and `javascript:` links are removed. A Content-Security-Policy is the second layer: inline code does not run even if something passes the sanitizer. External images do not load, so a page cannot send data out through an image address.
- **Uploaded files.** `/raw/` serves only files inside `raw/`, and an uploaded file cannot leave `raw/inbox/`. Uploaded HTML and SVG open in an isolated sandbox with no access to the application.
- **“Add an article”.** It accepts only https and refuses addresses in the local network. The address is checked at the moment of connecting, and the connection uses exactly the checked address, which closes the DNS rebinding window. Size limits apply to decompressed data.
- **Claude during processing.** It runs with `--permission-mode dontAsk` and a fixed tool list: writing only in `wiki/` and `outputs/`, named `npm run` commands, no general shell, no network tool. Reading and searching work only inside the project folder: `Read(./**)` plus a `PreToolUse` hook (`scripts/guard-read.js`) that also covers Grep, Glob and the chapter reader. The hook also refuses the restore history, the settings and the password file. This was checked with the real Claude Code, not only with the simulated one.
- **Password (optional).** Settings can turn on a password for the interface. Only a salted scrypt hash is stored, in `.library-auth.json`, outside git. Sessions use an `HttpOnly`, `SameSite=Strict` cookie, and repeated wrong attempts pause sign-in for a minute. If you forget it, stop the application and delete that file.

## Known limitations

- **Files are not encrypted.** Pages are plain text on disk, because Claude Code and the application must read them. Use full-disk encryption (BitLocker, FileVault, LUKS) for sensitive material. The password protects the interface, not the files.
- **The password is off by default,** and it does not stop other programs running under your account from reading the files directly.
- **Prompt injection cannot be fully prevented.** A harmful document can still mislead Claude into writing wrong or misleading text in `wiki/`. Claude can also read anything inside the project, such as your other sources, and that text goes to Anthropic. The limits above restrict what it can do, not what it can be persuaded to write.
- **`'unsafe-eval'` remains in the policy.** Vue compiles its templates in the browser and needs it. Inline scripts stay blocked.
- **Dependencies.** New vulnerabilities appear over time. Check with `npm audit` or the Settings page. `package.json` uses `overrides` to replace vulnerable packages inside `exceljs`, whose own releases have not caught up; check these on every update.

## Data sent to Anthropic

Text processed with Claude goes to Anthropic through Claude Code. Whether it is used for model training depends on your plan and settings: see the “Where your data goes” section on the product page and Anthropic (2026a).

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/cecosd/llm-wiki/security/advisories/new). If it is not available, open an issue without technical details and ask for a private contact. Do not publish working exploits before a fix.

## References

Anthropic. (2026a). *Data usage*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/data-usage

Anthropic. (2026b). *Configure permissions*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/permissions
