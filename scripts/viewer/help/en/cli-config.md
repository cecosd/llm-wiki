# Settings and variables

## Files

| File | What it holds | In Git? |
|---|---|---|
| `library.config.json` | Settings: model and provider (`ai`), content language (`contentLang`), copies (`sync`), processing mode, `setupDone`, `welcomeDone`. | no |
| `.library-secrets.json` | The API keys (0600). | no |
| `.library-auth.json` | The hash of the interface password. | no |
| `.launch.json` | The launcher's mode, site name and port. | no |
| `outputs/` | History of runs, the server log (`server.log`), collections, reports. | no |

None of the above should be edited while the server runs, except through the interface.

## Environment variables

| Variable | Effect |
|---|---|
| `PORT` | Server port (4321 by default). |
| `WIKI_HOST` | An extra site name the server accepts (it must be in `hosts`). |
| `LIB_LANG` | Language of console messages. |
| `LIB_AI_KEY` | Key for the chosen provider (instead of the file). The usual ones also work: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`. |
| `LIB_BROWSER` | Path to a Chromium-based browser for the app window. |
| `LIB_SANDBOX=off` | Only for `wsl-start.sh`: turns the cage off. |
| `CLAUDE_BIN` | Path to `claude` if it is not in PATH. |
| `LIBRARY_OCR=builtin` | Forces the built-in OCR instead of `ocrmypdf`. |
| `LIB_LAUNCHER`, `LIB_MODE`, `LIB_ISOLATION` | Set by the launcher; they tell the server how it was started. Do not set them. |

## Basic protection by hand

The launcher starts the server like this (Node 24+):

```
node --permission --allow-fs-read=<project> --allow-fs-write=<project>/wiki ... --allow-child-process --allow-worker scripts/server.js
```

If you want another folder to be readable, pass it in `extraRead` of `permissionArgs` in `scripts/modes.js`.

## Updating packages

**Settings → Updates** shows which packages have a safe new version (within `package.json`) and updates them with `npm update --ignore-scripts`, then restarts. Major versions stay as a command to copy. The minimum is Node.js 24.
