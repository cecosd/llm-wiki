# Security

LLM Wiki is developed by SDevelopers LTD (ЕсДевелопърс ЕООД) together with Claude. It is designed for one person on their own computer, working with documents they trust. It is not designed for a server, for shared access or for hostile files, and it has not had an independent security audit.

The current results are on the [product page](docs/index.html) and on the Settings page in the application. Run `npm test` to check your own machine.

## What is protected

- The server listens only on `127.0.0.1`.
- Requests with a foreign `Host` header (DNS rebinding) are refused. Requests other than GET need the `x-library` header, which other websites cannot send without permission.
- `/raw/` serves only files inside `raw/`, and an uploaded file cannot leave `raw/inbox/`.
- “Add an article” accepts only https and refuses addresses in the local network.
- During processing, Claude Code runs with `--permission-mode dontAsk` and a fixed tool list: writing only in `wiki/` and `outputs/`, named `npm run` commands, no general shell, no network tool.

## Known limitations

These are real checks in `tests/security.test.js`, marked as known issues. When the code is fixed they pass and the report changes by itself.

- **HTML in pages.** Page text is rendered from Markdown without a sanitizer and without a Content-Security-Policy. Harmful HTML that reaches a wiki page can run code in the application’s page and call its local API.
- **Prompt injection and the Read tool.** A harmful document can try to mislead Claude. `Read` is not limited to the project folder, so other files can be read; there is no network tool to carry them away, but the text reaches Anthropic and may land in a wiki page.
- **No login and no encryption.** Anyone with access to your account on the computer can use the application and read the files. Use full-disk encryption for sensitive material.
- **DNS check before connecting.** The address check in `scripts/discover.js` resolves the name before the connection, which leaves a narrow DNS rebinding window.
- **Dependencies.** Packages can have known vulnerabilities. Check with `npm audit` or the Settings page.

## Data sent to Anthropic

Text processed with Claude goes to Anthropic through Claude Code. Whether it is used for model training depends on your plan and settings: see the “Where your data goes” section on the product page and Anthropic (2026).

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/cecosd/llm-wiki/security/advisories/new). If it is not available, open an issue without technical details and ask for a private contact. Do not publish working exploits before a fix.

## References

Anthropic. (2026). *Data usage*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/data-usage
