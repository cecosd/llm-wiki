# Commands

They run in the library folder (`npm run <name>`).

## Files and pages

| Command | What it does |
|---|---|
| `npm run inbox` | Sorts `raw/inbox/` into folders and records them in `raw/manifest.json`. |
| `npm run extract` | Extracts text from PDF, DOC/DOCX, XLSX, CSV, EPUB, HTML into `raw/.extracted/` (only files in `raw/`). |
| `npm run status` | Which raw files still have no source page. |
| `npm run pending` | Only the new files, one path per line: the list for processing. |
| `npm run fix-paths` | Brings `raw_path` in the pages to the exact path on disk. |
| `npm run new -- <type> <slug>` | A new page from a template. |
| `npm run index` | Rebuilds `index.md`, `log.md`, `overview.md` (when files are lost). |
| `npm run lint` | Mechanical check: broken links, orphans, missing frontmatter; report in `outputs/`. |
| `npm run lint:quick` | Only the broken links. |

## Management

| Command | What it does |
|---|---|
| `npm run remove -- <slug>` | Preview of removing a source (applied with `--apply`). |
| `npm run dupes` | Possible duplicates; `npm run dupes -- <keep> <drop> [--apply]` merges them. |
| `npm run merge-sources -- "Title" <slug1> <slug2> [--apply]` | Merges separately uploaded chapters into a book. |
| `npm run archive` | ZIP archive for reading. |
| `npm run sync -- list\|plan <name>\|run <name> [--push-only\|--overwrite]` | Backups and synchronisation. `--overwrite` overwrites others' changes: only for a clear reason. |
| `npm run restore -- <folder> [--apply]` | Restores the library from a copy. |
| `npm run content -- <bg\|en>` | Switches the content language (the rules, skills, templates). |

## Server and app

| Command | What it does |
|---|---|
| `npm run app` | Launcher: hidden server and window ([see](#/docs/cli-launch)). |
| `npm run serve` | Server in the foreground. |
| `npm run serve:safe` | Server in a cage (bubblewrap). |
| `npm run sandbox:check` | What is visible from inside the cage. |

## Development

| Command | What it does |
|---|---|
| `npm test` | Tests in a temporary copy with a fake Claude. Does not touch the library and spends no tokens. |
| `npm run i18n:check` | Missing and extra interface translations. |
| `npm run docs` | Copies the libraries for the product page. |
| `npm run release:docs` | Before a release: updates the test report. |

All scripts that touch files work only inside the project folder.
