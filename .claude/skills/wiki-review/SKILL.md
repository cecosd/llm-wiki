---
name: wiki-review
description: Reviews and corrects a finished text (article, review, essay) against the library: checks every citation page by page in the original, fixes APA 7, supports unsupported claims, adds counterpoints, fills in missing parts and makes the sentences read naturally. Use for /wiki-review <file>, "review the article" or "check the citations". Also used by the "Review with the wiki" button in "Write with the wiki".
---

# wiki-review

Argument: the path to the text (`.md`) or the id of a draft in `drafts/`. From "Write with the wiki" the text comes directly in the request, together with the format of the answer: then the format in the request takes precedence over the "Report" section below.

The review **corrects and adds**; it does not write a new text. The author's thesis, structure and voice stay. Do not ask questions: the person has released you from them for this task.

## Rules that are never broken

- **Do not invent.** No citations, pages, years or facts about the author. What only the author knows (period of observation, number of participants, consent, method) is written as `[FILL IN: ...]`.
- **Every claim about a source is checked in the original** (`raw/.extracted/`), not from memory and not only from the wiki page.
- **No em dash (—)** anywhere. Citations in APA 7.
- An observation of yours that has no support in the library is written as the author's observation or as a hypothesis, never as a fact.

## Steps

1. **Preparation.** If you work on a file, first save a copy next to it (`<name>-original.md`; if it exists, `<name>-revision-N.md`). Read `wiki/index.md`.

2. **Citation map.** List every citation in the text (author, year, page) and every entry in the bibliography. For each work find the source page in `wiki/sources/` (by `authors`, `year`, `apa`): `raw_path`, `page_offset`, the chapters in `wiki/sources/chapters/`. A work that is not in the library is marked as not verifiable.

3. **Page-by-page check.**
   - The printed page is the PDF page minus `page_offset`. Open `raw/.extracted/<raw_path>.md` at the marker `<!-- стр. N -->`, where N is the printed page plus the offset (for EPUB: `<!-- раздел N -->`).
   - Check that the claim is there and **whose it is**: an example the author quotes from someone else belongs to the other person; a chapter in an edited book belongs to the chapter author, not to the editors.
   - The printed number is often visible in the text near the marker (running head or foot). Use it to confirm the offset.
   - If `page_offset` is `?` or the book is an e-book without printed numbers, cite by chapter (`ch. N`) and say so in the report.
   - Fix wrong pages. What you cannot check stays unchanged and goes into the report.

4. **APA 7.**
   - Chapter in an edited book: the chapter author in the text; in the bibliography a separate entry "In A. Editor & B. Editor (Eds.), *Title* (pp. X-Y)".
   - Two authors: "A and B"; three or more: "A et al." from the first mention.
   - Translation: in the text "(Author, year of the original/year of the translation)", with the name spelled as in the bibliography; in the entry "(Original work published ...)".
   - Secondary citation: "(Author, year, as cited in Source, year, p. N)"; only the source actually read goes into the bibliography.
   - Without printed pages (e-book, reprint with different pagination): in a paraphrase the page may be left out; in a direct quote it is required (or a chapter, section).
   - Several sources in one pair of parentheses: in alphabetical order.
   - Every citation has an entry and every entry is cited. One entry per paragraph, in alphabetical order.

5. **Unsupported claims.** Find the claims without a citation. Look for support in the library (Grep in `wiki/` by the key concepts, then in `raw/.extracted/`) and add a citation. If there is no support, rephrase it as the author's observation or hypothesis, or say so in the report.

6. **Counterpoints.** If a source in the library contradicts a claim or nuances it, add it in one sentence with a citation. The selection must be fair, not only in favour of the thesis.

7. **Structure** (for a scientific article and a review):
   - is there a section on the approach (what kind of analysis, how the literature was selected, the status of self-observation and of the examples);
   - is the central hypothesis explained (a mechanism, not only a claim);
   - is there a practical application if the text is for practitioners (concrete questions, a composite vignette explicitly marked as composite);
   - is it clear whom the text is about and for (population, reader);
   - do the limitations reflect the real sources (preprints, secondary sources, old texts).
   Add what is missing with `[FILL IN: ...]` where only the author knows the facts. Shorten or merge weakly connected parts (a concept used once) rather than expanding everything.

8. **Style.** The sentences should sound like human speech:
   - on average about 14 to 18 words, with variety; none above about 35 words;
   - keep the conjunctions that carry the logic (because, so, but, while) when you split a long sentence;
   - avoid the pattern "a short slogan sentence, then a very long one" at the start of every paragraph;
   - one spelling of every name in the whole text; the original term in parentheses at first use.

9. **Self-check.** Zero em dashes; every citation has an entry and vice versa; average sentence length and the longest sentence before and after; word count before and after.

## Report

Start with one line "Written for: ..." (the reader the text is for). Then:
- **Errors fixed:** each with the source and page it was checked against;
- **Added:** new sources and parts, and why;
- **For the author to fill in:** every `[FILL IN: ...]`;
- **Not verified:** citations and claims you could not check, and why;
- **Assessment:** strengths and weaknesses by importance, as a reviewer would see them.

## Assessment only

If the person asks how you assess the text, do not change it. Give a clear verdict (for example "major revision"), the strengths, the weaknesses by importance and what you propose, with sources. At the end ask what they think.
