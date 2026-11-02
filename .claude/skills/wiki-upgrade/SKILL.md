---
name: wiki-upgrade
description: Upgrades an already processed source to the current standard (emphasis, chapters, exact PDF pages, missed concepts, contradictions) without starting over. Use for /wiki-upgrade <slug> or "upgrade <book>".
---

# wiki-upgrade

Argument: the slug of the source page (e.g. `smith-2020-example`).

The upgrade **adds**. It never creates a second source page for the same file, does not duplicate concepts and carries over the section `## My notes` verbatim. No questions.

## Steps

1. Read `wiki/sources/<slug>.md`. If it already has `depth: 2`, say "Already upgraded" and stop.
2. Read `wiki/index.md` and the chapters of the book in `wiki/sources/chapters/<slug>-ch*.md`, if there are any.
3. The text has already been extracted again by the server. Open `raw/.extracted/<raw_path>.md`: first the table of contents and the introduction, then **chapter by chapter** (not the whole book at once). Pages come from the markers `<!-- стр. N -->` (the marker name is historical; "стр." means "page").
4. The book:
   - `emphasis` + a section `## Emphasis of the source` (by the author's purpose, the most developed chapters, the central concept);
   - `page_offset` (PDF minus printed number);
   - `## Key ideas` with PDF pages;
   - `## Chapters` (books only);
   - `depth: 2`, `upgraded: <today>`, `updated: <today>`.
5. Chapters (books only): for every chapter in the table of contents create `wiki/sources/chapters/<slug>-chNN.md` following `wiki/_templates/chapter.md`, or update the existing one.
6. Citations: search for the slug in `wiki/` with the Grep tool and in every page found bring the citations to this book to the form `([[<slug>-chNN]], p. N)` with a PDF page.
7. Concepts: add those that the book develops substantially and that are missing (check for synonyms in index.md and `wiki/concepts/`). Update the existing ones with a new citation to the chapter.
8. Contradictions with other sources: `## Contradictions` in the affected page, with citations to both sides (use their source and chapter pages, not the originals).
9. Update `wiki/index.md` for the new concepts. An `upgrade` entry in `wiki/log.md`.
10. `npm run lint:quick` and fix broken links.

A report in 3 to 6 lines: emphasis, how many chapters, how many new and updated concepts, contradictions.

Rules: English, no em dash, APA 7, kebab-case names, write only in wiki/.
