---
name: wiki-query
description: Answers a question by navigating the wiki (index → relevant pages) and citing with wikilinks. Use for /wiki-query or a question like "what does the library say about…".
---

# wiki-query

1. Read `wiki/index.md`. Choose up to 10 relevant pages.
2. For a larger wiki: `grep -ril "<term>" wiki/` for additional candidates.
3. Read the chosen pages and synthesize an answer. Every claim carries a `[[wikilink]]`.
4. If the wiki does not cover the question: say so and point to the raw files that probably contain the answer (check in `raw/.extracted/` with grep).
5. If the answer is a new synthesis: offer to save it as `wiki/questions/<slug>.md`, then update the index and the log (a `query` entry).
