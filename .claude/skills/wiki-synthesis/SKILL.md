---
name: wiki-synthesis
description: Synthesis across sources: comparisons of authors on shared concepts, topic hubs, an overview and gaps. Reads only wiki pages. Use for /wiki-synthesis [tag] or "synthesis".
---

# wiki-synthesis

Optional argument: a tag (e.g. `thermodynamics`). Without an argument: the whole library.

Reads **only** pages in `wiki/`, never the originals. No questions.

1. Read `wiki/index.md`, `wiki/overview.md` and the existing `wiki/topics/` and `wiki/comparisons/`.
2. Find the concepts (with the tag, if given) that **at least two different sources** point to (a book or one of its chapters). Read those concepts and the corresponding chapters.
3. **Comparisons:** for every concept where the authors differ substantially, create or update `wiki/comparisons/<a>-vs-<b>-<concept>.md` following the template: a table by dimensions, conclusions, citations `([[...-chNN]], p. N)`. Do not make a comparison where they simply say the same thing.
4. **Hubs:** a group of 3+ related concepts without a topic page → `wiki/topics/<topic>.md` following the template.
5. **Overview:** rewrite `wiki/overview.md`: the main lines in the library, which authors are in which camp, how the topics connect. `confidence` according to coverage.
6. **Gaps:** concepts with one source, pages with `confidence: low`, contradictions without a resolution. Write them to `outputs/synthesis-<today>.md` with concrete recommendations on what to read or add.
7. Update `wiki/index.md` (Comparisons, Topics). A `synthesis` entry in `wiki/log.md`.
8. `npm run lint:quick` and fix broken links.

A report in 3 to 6 lines: how many comparisons and hubs, the main line, the most important gaps.

Rules: English, no em dash, APA 7, kebab-case names, write only in wiki/ and outputs/.
