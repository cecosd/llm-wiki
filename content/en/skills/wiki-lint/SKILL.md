---
name: wiki-lint
description: Health check of the wiki: a mechanical lint with a script plus a semantic check for contradictions, outdated claims and gaps. Use for /wiki-lint or "check the wiki".
---

# wiki-lint

1. Run `npm run lint`. Read the generated `outputs/lint-mech-YYYY-MM-DD.md`.
2. Fix the mechanical problems that are safe (broken links with an obvious target, missing entries in index.md). Link orphans from a suitable topic hub.
3. Semantic check (read by topic, not everything at once):
   - contradictions between pages;
   - claims superseded by a newer source;
   - frequently mentioned concepts without a page (see the "Missing pages" section of the report);
   - `confidence: low` pages;
   - topics with a single source.
4. Write `outputs/lint-YYYY-MM-DD.md`: what was fixed, what waits for the human's decision, reading recommendations.
5. A `lint` entry in `wiki/log.md`.
