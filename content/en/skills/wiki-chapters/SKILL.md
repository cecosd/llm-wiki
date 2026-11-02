---
name: wiki-chapters
description: Adds per-chapter pages to an already processed book (drill down). Use for /wiki-chapters <slug or raw path> or "split into chapters".
---

# wiki-chapters

Argument: the slug of the book's source page (e.g. `smith-2020-example`) or its `raw_path`.

1. Read the book's source page. If it already has a `## Chapters` section with complete links, say so and stop.
2. Open `raw/.extracted/<raw_path>.md`. Read the table of contents to find the chapters and their PDF pages (the markers `<!-- стр. N -->`; the marker name is historical, "стр." means "page").
3. Determine `page_offset` (PDF minus printed number) and write it into the book.
4. For each chapter, **one at a time**: read only its text and create `wiki/sources/chapters/<slug>-chNN.md` from `wiki/_templates/chapter.md`.
5. Update the book: a `## Chapters` section with all chapters in order, `updated`.
6. In the concept and entity pages that cite the book, redirect the citation to the chapter where it is clear which one it is: `([[<slug>]], p. 53)` → `([[<slug>-ch03]], p. 53)`.
7. A `ingest` entry in the log: "chapters for <book>".
8. `npm run lint:quick` and fix broken links.

No questions. Rules: English, no em dash, do not touch raw/.
