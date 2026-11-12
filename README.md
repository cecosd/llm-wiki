# LLM Wiki: a personal library maintained by Claude Code

English · [Български](README.bg.md) · [Product page](https://cecosd.github.io/llm-wiki/)

Developed by **SDevelopers LTD (ЕсДевелопърс ЕООД)** together with **Claude**. Not published or endorsed by Anthropic.

A local knowledge base for books, papers, articles, tables and notes, built on the *LLM Wiki* pattern by Andrej Karpathy (Karpathy, 2026). You choose what goes in; [Claude Code](https://code.claude.com) reads, summarizes, links and maintains the wiki. A small local web app lets you browse, search, learn by question and write with the library.

It is not tied to any subject: it works for any kind of text (science, law, history, engineering, literature…).

## How it works

```
 raw/inbox/  ──npm run inbox──▶  raw/books, papers, articles, data…   (originals, never modified)
                                        │
                                 npm run extract
                                        ▼
                                 raw/.extracted/*.md                    (text for the agent to read)
                                        │
                                 Claude Code: /wiki-ingest
                                        ▼
            wiki/sources · concepts · entities · topics · questions     (maintained by the agent)
                     index.md (catalog)   log.md (journal)
                                        │
             /wiki-query  ·  /wiki-lint  ·  npm run serve  ·  Obsidian
```

Three layers: `raw/` (originals), `wiki/` (generated pages), `CLAUDE.md` (the schema that tells the agent how to work). Three operations: ingest, query, lint.

## Requirements

- Node.js 24 or newer
- A model. By default [Claude Code](https://code.claude.com), signed in once (run `claude` in a terminal); the app runs it in the background (`claude -p`) with your own subscription. Other models are chosen in **Settings → Model** (see “Other models” below), and then Claude Code is needed only for the agent.
- Optional: Git (gives the “Undo” button), `pdftotext` from poppler (better PDF text; without it the built-in `unpdf` is used), Obsidian.

> **Privacy.** Everything runs on your machine and the server accepts requests only from `localhost`. When you ask Claude to process a source, the text of that source is sent to Anthropic through Claude Code. Nothing is sent before you confirm; the app shows an estimate of tokens and cost first.

## Quick start

**On a computer with nothing installed**, download the repository (the green Code button, then Download ZIP, or `git clone`) and run the installer. It checks Node.js, the libraries, Claude Code and your Claude sign-in, asks before installing anything that is missing, and then starts the library and opens it in the browser:

- Windows: double-click `install.cmd`
- macOS, Linux, WSL: `./install.sh`

Every step is also listed on the **Setup** page inside the app (`#/setup`) with the exact command for your system. The installer needs an internet connection and, for a Claude account, a Claude subscription (Pro or Max) or an Anthropic API key.

If you prefer to do it by hand:

```bash
git clone <this repository> llm-wiki
cd llm-wiki
npm install
claude               # sign in once
npm run serve        # http://localhost:4321
```

Open the page, drop files into the upload field, press “Sort and extract text”, and Claude starts processing. On Windows the recommended setup is WSL (see `scripts/launch/`).

## Languages (interface)

The interface and the server messages are available in **English** and **Bulgarian**. The language is chosen in the sidebar; the first visit follows your browser language.

**Adding an interface language needs no code.** Translations live in `locales/<code>.json`:

```json
{
  "_meta": { "code": "de", "name": "Deutsch" },
  "messages": {
    "Search": "Suche",
    "{0} pages · {1} files": "{0} Seiten · {1} Dateien"
  }
}
```

1. Copy `locales/en.json` to `locales/<code>.json` (for example `de.json`).
2. Change `_meta` (`code` is the file name, `name` is shown in the language menu).
3. Translate the values. The keys are the English texts and must stay unchanged; keep placeholders such as `{0}` and `{1}` in the translation.
4. Run `npm run i18n:check` to see missing keys and placeholder mismatches. A missing translation is not an error: the English text is shown.
5. Reload the page; the new language appears in the menu.

A pull request with a new locale file is welcome.

**One language for everything.** Choosing a language in the sidebar switches the interface **and** everything Claude reads and writes: `CLAUDE.md`, the skills, the page templates, the starter pages and the prompts the app sends to Claude. The language packs are in `content/<code>/` (English `en` and Bulgarian `bg` are included); if a language has an interface translation but no content pack yet, the English pack is used. `npm run content -- <code>` installs a pack from the command line. Wiki pages that already exist are not rewritten. To add a content language (for example Polish) copy `content/en/` to `content/pl/` and translate all files, including `prompts.json` (English text → translation, same `{0}` placeholders); add `locales/pl.json` for the interface; then pick Polish in the menu. The setting “Indexing language” → “Pages in the language of the source” makes Claude write each source's pages in that source's own language.

## Everyday use

1. **Upload:** drop files on the home page (or copy them into `raw/inbox/`).
2. **Sort:** “Sort and extract text” puts files into folders and extracts their text.
3. **Process:** Claude reads each source, decides its emphasis, writes the source page (books also get one page per chapter) and updates concepts, people and topics. You see live what it reads and which page it writes.
4. **Browse:** pages appear on their own. Search with `Ctrl K`, follow the link map, open the original page of a book from any “p. N” citation.
5. **Learn and write:** “Learn by question” builds an ordered reading path; “Write with the wiki” drafts an article with APA 7 citations from the library.

### Menu, collections and the log

- **Menu.** The sidebar is split into groups that fold: Learn and write, Library, Collections, Tags and System. The app remembers which groups are folded.
- **Collections.** The page types come from the wiki itself, so “Chapters” and any new type appear without code changes. A **smart collection** fills itself from conditions: type, tag, area, format, confidence, reading status, author, years and a word in the title (AND between fields, OR within one field). A **list** is filled by hand with the “List” button on any page and ordered with arrows. The Collections screen (the gear next to “Collections” in the menu) orders and hides them. They are stored in `outputs/collections.json`; the pages themselves are not changed.
- **Log.** The Log screen shows the entries of `log.md` newest first, grouped by day, with a filter by kind (processing, upgrade, synthesis, check, restructuring…) and a search.
- **Settings.** A submenu on the left: Model, Updates, Data, Password, Backups and sync, Archive and Tests. Each section has its own address (`#/settings/updates`).

### Backups and sharing

Your library lives on one disk. If it dies, the reading archive is not enough: it has no original files. **Settings → Backups and sync** copies the whole working library to another folder (another disk, a network disk, or a folder that pCloud, Dropbox or Google Drive uploads), without `node_modules`, so it can bring the library back on a new computer. You press **Copy now** (the button is also in the left menu); nothing runs by itself.

There are three kinds of copy:

- **Backup:** only you write in the folder. It always writes yours; older versions and files you deleted go to `_deleted/`.
- **Shared folder:** you and other people write in it. It compares before it writes and, if somebody else changed something, asks you: take it, leave it, overwrite it, or merge paragraph by paragraph. Only `raw/`, `wiki/` and `drafts/` are shared.
- **Take from a copy:** only takes what a colleague added. Their deletions are ignored, and nothing is written in their folder.

Before each copy the window lists which files will be sent and what kind they are. A backup folder that two people write to will overwrite each other's work, so use a Shared folder for that. After a disaster: `npm ci`, then `npm run restore -- <folder> --apply`. Read the full guide, with the pCloud example, the rules for two people and the Windows and WSL notes, in [docs/backup-and-sharing.md](docs/backup-and-sharing.md) ([Bulgarian](docs/backup-and-sharing.bg.md)). Copies are not available in the isolated mode (`serve:safe`) yet, and they are tested with ordinary folders, not yet with real cloud drives.

### Processing modes

| Mode | Who reads | Who edits | For |
|---|---|---|---|
| **Economy** (default) | the `chapter-reader` subagent on Haiku | Sonnet | many books at once |
| **Balanced** | Sonnet | Sonnet | when Haiku misses nuance |
| **Best** | Opus | Opus | key books |

Before every action with Claude the app shows approximate tokens and cost (it can be turned off on the home page). Before each processing a Git checkpoint is made, and “Undo” restores the wiki to how it was.

### Other models

**Settings → Model** chooses who processes the library. The buttons and texts follow the name of the model (“Ask Gemini”, “Process with Ollama”), and each label can be renamed for each model.

| Way of working | Providers | How it works |
|---|---|---|
| **Agent with tools** | Claude subscription, Claude API key, DeepSeek, local Ollama 0.14+, any endpoint compatible with Anthropic | Claude Code as usual; for another provider it gets `ANTHROPIC_BASE_URL` and the three models (Anthropic, n.d.; DeepSeek, n.d.; Ollama, n.d.) |
| **Without tools** | OpenAI, Google Gemini (free or paid key), Groq, OpenRouter, DeepSeek, Mistral, Claude API, Ollama, LM Studio, any `/chat/completions` endpoint | The server gives the model the text chapter by chapter and writes the pages itself from the templates, so small and local models work too (Google, n.d.-c) |
| **Copy and paste** | any chat in the browser, including free accounts | Each step is a request you copy into the chat; you paste the answer back |

Keys are stored in `.library-secrets.json` (outside git, readable only by you, closed to the agent) or come from an environment variable. Free tiers may use your content for training: do not send private material there. Each profile in Settings → Model has a short “What happens and why” list with the steps of its setup.

#### Gemini: free key or paid key

The key belongs to a project in Google AI Studio, and the project decides the tier (Google, n.d.-a; Google, n.d.-d):

| | Free tier | Paid tier |
|---|---|---|
| Profile in Settings → Model | “Google Gemini, free tier (project without billing)” | “Google Gemini, paid (project with billing)” |
| Project | not linked to a billing account | linked to a billing account; new accounts pay in advance (Prepay, at least 5 USD) |
| Models | Flash and Flash-Lite; Pro and Gemini 4 Argon have no free tier (Google, n.d.-b) | all |
| Limits | per minute and per day, for each project and model, shown only in AI Studio (Rate limits); the daily ones reset at midnight Pacific time | higher, with a monthly spending cap by the tier of the account |
| Your content | used to improve Google products | not used |

- **Error 402 “Your prepayment credits are depleted”.** The key is from a project linked to a billing account that has no credit. Such a project takes the paid tier of the account and is not moved back to the free tier at 0, so every key of the account stops. Add credit in AI Studio (Billing), or create a project without billing and take the key from there (Google, n.d.-a).
- **A paid Gemini account.** Its key goes into the paid profile, which carries Google's prices, so the estimate shows an amount (the prices can be changed). A Google AI Pro or Ultra subscription to the Gemini app does not give an API key by itself, but it includes monthly Google Cloud credits (10 USD with AI Pro) that count for the Gemini API after you activate them in the Google Developer Program (Google, 2026).
- **How many requests.** A book takes about one request per chapter plus 5 to 10. The light model (Flash-Lite) reads the chapters and the medium one (Flash) writes the pages, so the limits of the two models are used separately. When the daily limit runs out, the queue waits for the reset and starts that source again.

#### Groq: free key

Groq is fast, but its free plan counts tokens, not only requests.

- **Models.** Groq's list mixes text models with models for speech (Whisper, Orpheus) and safety checks (Prompt Guard, Safeguard) (Groq, n.d.-d). Only text models write pages, so “Load the models” hides the others and a warning appears if one of them is in a field. The profile reads chapters with `openai/gpt-oss-20b` and writes with `openai/gpt-oss-120b`; Llama 3.x was retired for the free plan on 16 August 2026 (Groq, n.d.-b).
- **Limits.** Groq's limits table gives these models 30 requests and 8,000 tokens per minute and 1,000 requests and 200,000 tokens per day, for each model (Groq, n.d.-c). The page does not say clearly which plan the table is for, and the Developer column on the models page is much higher (250,000 tokens per minute; Groq, n.d.-d), so check your own numbers on the limits page of the Groq console (the “Your limits” link in Settings → Model).
- **What follows.** One request must fit in the limit per minute, so the profile sets the context to 7,000 tokens and the server sends short parts. A book needs more tokens than one day gives: the estimate warns before you start, and a job that hits the daily limit waits as long as Groq says and then starts that source again. Use the free plan for articles and short texts, and expect it to be slow: a request takes most of the limit per minute, so about one passes per minute (a chapter of 6,500 words takes around 15 to 20).
- **Errors.** A model for speech answers “does not support chat completions”, and some models first ask you to accept their terms in the Groq console; both get a clear message. A request that is too large is error 413 (Groq, n.d.-a). The gpt-oss models think before they answer and spend part of the output limit on it, so the profile asks them for short thinking, and an answer cut off at the limit is asked for again with more room. “Test the connection” sends one short request to each chosen model, so a wrong model shows up before a whole text is sent.

### Claude Code commands

| Command | What happens |
|---|---|
| `/wiki-inbox` | Sorts the inbox, extracts text, shows what is pending |
| `/wiki-ingest` | Processes everything pending (or `/wiki-ingest raw/books/x.pdf`) |
| `/wiki-chapters <book>` | Adds per-chapter pages to an already processed book |
| `/wiki-upgrade <book>` | Upgrades an old source to the current standard |
| `/wiki-synthesis [tag]` | Synthesis across sources |
| `/wiki-query <question>` | Answer with citations from the wiki |
| `/wiki-lint` | Broken links, contradictions, gaps |

### Commands without the agent

| Command | What it does |
|---|---|
| `npm run serve` | The web app (`PORT=5000 npm run serve` for another port) |
| `npm run serve:safe` | The web app in isolation (Linux and WSL, needs `sudo apt install bubblewrap`): the program and its packages see only this folder. See [SECURITY.md](SECURITY.md) |
| `npm run sandbox:check` | Shows what can and cannot be seen from inside the isolation |
| `npm run inbox` | Sort `raw/inbox/` (`-- --dry` to preview) |
| `npm run extract` | Extract text from all raw files (`-- --force` to redo) |
| `npm run status` / `npm run pending` | What is processed and what waits |
| `npm run lint` / `npm run lint:quick` | Mechanical report in `outputs/` / broken links only |
| `npm run index` | Rebuild `index.md`, `log.md`, `overview.md` from the pages |
| `npm run dupes` | Possible duplicate pages and author spellings (`-- <keep> <drop> [--apply]` merges) |
| `npm run merge-sources` | Merge separately uploaded files (e.g. chapters) into a book with chapters |
| `npm run sync -- list` / `plan <name>` / `run <name>` | Backups and sharing: list the copies, show what a copy would do, copy (see [the guide](docs/backup-and-sharing.md)) |
| `npm run restore -- <folder> [--apply]` | Bring the library back from a copy (without `--apply` it only shows) |
| `npm run remove -- <slug>` | Preview removal of a source and what cites only it (`--apply` removes) |
| `npm run new -- concept my-concept "My concept"` | New page from a template |
| `npm run i18n:check` | Check translation files |

### Sorting rules

| File | Folder |
|---|---|
| PDF over 80 pages, EPUB, MOBI, DJVU | `books/` |
| PDF up to 80 pages | `papers/` |
| DOCX, ODT, RTF, TXT | `articles/` |
| HTML, MD with `source: http…` (Obsidian Web Clipper) | `web/` |
| MD without a source | `notes/` |
| XLSX, CSV, TSV, JSON | `data/` |
| PNG, JPG, SVG, HEIC | `images/` |
| anything else | `other/` |

Duplicates (same content, different name) are detected by SHA-256 and stay in the inbox. Scanned PDFs are recognized automatically and go through the built-in OCR (tesseract.js, Bulgarian and English data included).

## Updates and maintenance

The product works well, but it stands on Node.js libraries, and they have their own dependencies. These change independently of it, so check versions and vulnerabilities regularly. **Settings → Updates** (`#/settings/updates`) checks with one button whether GitHub has a newer version of the code and which packages are out of date. Nothing is installed by itself.

- **“Update to X”** next to a package and **“Update all safe ones”** run `npm update` with `--ignore-scripts`, only for the packages in `package.json` and only to the versions its ranges allow. Then the library restarts by itself and the page reloads.
- **Major versions** (for example 2.x when 1.x is allowed) are not installed by the button. They are shown as a command to copy, because they can change behavior and need `npm test` afterwards.
- **In the isolation** (`npm run serve:safe`, the shortcut in WSL) `node_modules/` is read-only, so the launcher outside runs npm. If the library does not start with the new versions within 30 seconds, the launcher reinstalls the previous ones (`npm ci`). Details are in [SECURITY.md](SECURITY.md).
- **Without the isolation** the restart is automatic only when the library was started with the shortcut or `scripts/launch/wsl-start.sh`. With `npm run serve` in a terminal the page asks you to stop the library (`Ctrl+C`) and start it again, so that the new versions load.

By hand:

```bash
npm outdated && npm audit     # what is out of date, known vulnerabilities
npm update && npm test        # safe update, then check
```

To update the code with git (the language pack rewrites a few tracked files, so restore them first; your library is not touched):

> **From 1.x to 2.0:** version 2.0 needs Node.js 24 or newer. Check with `node -v` and update Node.js first (with nvm: `nvm install 24`).

```bash
git restore CLAUDE.md .claude wiki/_templates scripts/starter
git pull && npm install
npm run content -- <code>     # only if your content language is not English
```

## Your data and model training

Content you process with Claude goes to Anthropic through Claude Code. Reading, search and local modes stay on your computer. On Free, Pro, Max and Ultra plans the data trains models only if the model improvement setting is on: turn it off at [claude.ai/settings/data-privacy-controls](https://claude.ai/settings/data-privacy-controls). Team, Enterprise and API terms do not train by default (Anthropic, 2026). Details, retention periods and exceptions are on the [product page](https://cecosd.github.io/llm-wiki/#data).

## Security and tests

The application is designed for one person on their own computer. Protections and known limitations are listed in [SECURITY.md](SECURITY.md). An optional password for the interface is on the Settings page.

`npm test` runs the real server in a temporary copy with a simulated Claude: it does not touch your library and spends no tokens. Results are shown on the Settings page and the product page, including what is known not to work and what is not tested.

## Your data stays out of the repository

`.gitignore` excludes `raw/`, the pages under `wiki/`, `drafts/`, `outputs/`, `library.config.json` and `CLAUDE.local.md`. To keep your own library under version control, put it in a separate private repository (or remove those lines from `.gitignore` in your own copy). Personal preferences for the agent go into `CLAUDE.local.md`, which Claude Code reads next to `CLAUDE.md`.

## Limits

- Works best up to roughly 100 to 200 sources; beyond that, navigation through `index.md` alone weakens and a search tool is worth adding.
- OCR can err on names and special terms; pages with many errors get `confidence: low`.
- Architecture, file map and lessons learned are in [PROJECT-HISTORY.md](PROJECT-HISTORY.md) (in Bulgarian); the rules for the agent are in [CLAUDE.md](CLAUDE.md) (in Bulgarian).

## References

Karpathy, A. (2026). *LLM Wiki* [GitHub Gist]. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Anthropic. (2026). *Claude Code documentation*. https://code.claude.com/docs

Anthropic. (2026). *Data usage*. Claude Code Docs. Retrieved November 4, 2026, from https://code.claude.com/docs/en/data-usage

Anthropic. (n.d.). *Environment variables*. Claude Code Docs. https://code.claude.com/docs/en/env-vars

DeepSeek. (n.d.). *Anthropic API*. DeepSeek API Docs. https://api-docs.deepseek.com/guides/anthropic_api

Google. (2026, January 27). *New developer tools for Google AI Pro and Ultra subscribers*. The Keyword. https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/

Google. (n.d.-a). *Billing*. Google AI Studio. Retrieved November 9, 2026, from https://aistudio.google.com/docs/billing

Google. (n.d.-b). *Gemini Developer API pricing*. Google AI Studio. Retrieved November 9, 2026, from https://aistudio.google.com/docs/pricing

Google. (n.d.-c). *OpenAI compatibility*. Google AI Studio. https://aistudio.google.com/docs/openai

Google. (n.d.-d). *Rate limits*. Google AI Studio. Retrieved November 9, 2026, from https://aistudio.google.com/docs/rate-limits

Groq. (n.d.-a). *API error codes and responses*. GroqDocs. Retrieved November 9, 2026, from https://console.groq.com/docs/errors

Groq. (n.d.-b). *Model deprecation*. GroqDocs. Retrieved November 9, 2026, from https://console.groq.com/docs/deprecations

Groq. (n.d.-c). *Rate limits*. GroqDocs. Retrieved November 9, 2026, from https://console.groq.com/docs/rate-limits

Groq. (n.d.-d). *Supported models*. GroqDocs. Retrieved November 9, 2026, from https://console.groq.com/docs/models

Ollama. (n.d.). *Anthropic compatibility*. Ollama Docs. https://docs.ollama.com/api/anthropic-compatibility

## Contributing

Bug reports, ideas, translations and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: every change reaches `main` through a pull request that the maintainer reviews and approves. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are reported privately, as described in [SECURITY.md](SECURITY.md).

## License

GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).
