---
name: wiki-inbox
description: Sorts the new files from raw/inbox, extracts their text and shows what is waiting for processing. Use when the human says they added files, or types /wiki-inbox.
---

# wiki-inbox

1. Run `npm run inbox`. Briefly show which file went where.
2. If a file was sorted wrongly (e.g. a short book in papers/), tell the human and suggest `npm run inbox -- --move <file> <folder>`. You do not move it yourself without consent.
3. Run `npm run extract`. If a PDF gives empty text, it is probably scanned: mark it as needing OCR.
4. Run `npm run status` and show the list of unprocessed files.
5. Add an `inbox` entry to `wiki/log.md`.
6. Ask which file to start the ingest with (or "all").
