---
name: wiki-ingest
description: Processes the NEW raw files into the wiki: a source page (and for books, per-chapter pages), updates of concepts and people, index and log. Use for "process", "ingest", /wiki-ingest or after wiki-inbox.
---

# wiki-ingest

Processing is incremental: every raw file is read **once**. Sources that are already processed are not opened again. **You do not ask questions**: the emphasis is determined by the source itself.

## Which files

- With an argument (path to a raw file): only that one.
- Without an argument: run `npm run pending`. Process **only** the paths in the output. If the output is empty, say "No new files" and stop.
- Never walk through `raw/` or `raw/.extracted/` on your own to look for what to process.
- Reprocessing a file that is already processed: only on an explicit "reprocess <file>".

## For each file

1. Read `wiki/index.md`.
2. Read the text from `raw/.extracted/<same path>.md`. If it is missing, run `npm run extract -- <path>`.
   - Books: first the table of contents and the introduction, then chapter by chapter. Do not load the whole book at once.
   - Tables: the description of the sheets and the first rows; do not copy data.
   - Page numbers come from the markers `<!-- стр. N -->` (the marker name is historical; "стр." means "page"; see "Page numbers" in CLAUDE.md).
3. **Emphasis:** determine it from the source itself (the author's stated purpose, the most developed chapters, the central concept). Write `emphasis` and a section `## Emphasis of the source` with the reasoning.
4. Create `wiki/sources/<slug>.md` from `wiki/_templates/source.md`.
   - `raw_path`: copy the path **exactly** as in the output of `npm run pending`.
   - APA 7 record; for books `page_offset`; `depth: 2`.
5. **Books:** one page per chapter in `wiki/sources/chapters/<slug>-chNN.md` from `wiki/_templates/chapter.md`, and a section `## Chapters` in the book.
6. Concepts and people:
   - existing ones: add the new knowledge with a citation to the **chapter**, if there is one: `([[<slug>-ch03]], p. 53)`; update `updated`;
   - new ones, if they are substantial: create them from the template.
   - To link to other sources use their source and chapter pages, not the originals.
7. Contradictions: a section `## Contradictions` + a line in the log.
8. Update `wiki/index.md` (chapters are not in the index, only the book) and, if needed, `overview.md` or a topic hub.
9. A `ingest` entry in `wiki/log.md` with new and updated pages.

## At the end

1. `npm run pending`: the processed files should no longer be in the list. If one is, fix `raw_path` (or run `npm run fix-paths`).
2. `npm run lint:quick` and fix broken links.
3. A report in 3 to 6 lines: the emphasis of the source, how many pages are new, how many updated, contradictions.

Rules: English, no em dash, APA 7, kebab-case names, do not touch raw/.
