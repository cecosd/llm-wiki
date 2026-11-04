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

- Node.js 20 or newer
- [Claude Code](https://code.claude.com), signed in once (run `claude` in a terminal). The app runs it in the background (`claude -p`) with your own subscription.
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

### Processing modes

| Mode | Who reads | Who edits | For |
|---|---|---|---|
| **Economy** (default) | the `chapter-reader` subagent on Haiku | Sonnet | many books at once |
| **Balanced** | Sonnet | Sonnet | when Haiku misses nuance |
| **Best** | Opus | Opus | key books |

Before every action with Claude the app shows approximate tokens and cost (it can be turned off on the home page). Before each processing a Git checkpoint is made, and “Undo” restores the wiki to how it was.

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
| `npm run inbox` | Sort `raw/inbox/` (`-- --dry` to preview) |
| `npm run extract` | Extract text from all raw files (`-- --force` to redo) |
| `npm run status` / `npm run pending` | What is processed and what waits |
| `npm run lint` / `npm run lint:quick` | Mechanical report in `outputs/` / broken links only |
| `npm run index` | Rebuild `index.md`, `log.md`, `overview.md` from the pages |
| `npm run dupes` | Possible duplicate pages and author spellings (`-- <keep> <drop> [--apply]` merges) |
| `npm run merge-sources` | Merge separately uploaded files (e.g. chapters) into a book with chapters |
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

The product works well, but it stands on Node.js libraries, and they have their own dependencies. These change independently of it, so check versions and vulnerabilities regularly. The **Settings** page (`#/settings`) checks with one button whether GitHub has a newer version of the code and which packages are out of date. Nothing is installed by itself.

```bash
npm outdated && npm audit     # what is out of date, known vulnerabilities
npm update && npm test        # safe update, then check
```

To update the code with git (the language pack rewrites a few tracked files, so restore them first; your library is not touched):

```bash
git restore CLAUDE.md .claude wiki/_templates scripts/starter
git pull && npm install
npm run content -- <code>     # only if your content language is not English
```

## Your data and model training

Content you process with Claude goes to Anthropic through Claude Code. Reading, search and local modes stay on your computer. On Free, Pro, Max and Ultra plans the data trains models only if the model improvement setting is on: turn it off at [claude.ai/settings/data-privacy-controls](https://claude.ai/settings/data-privacy-controls). Team, Enterprise and API terms do not train by default (Anthropic, 2026). Details, retention periods and exceptions are on the [product page](https://cecosd.github.io/llm-wiki/#data).

## Security and tests

The application is designed for one person on their own computer, with documents they trust. Protections and known limitations, including an unsanitized HTML risk in page rendering, are listed in [SECURITY.md](SECURITY.md).

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

## License

GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).
