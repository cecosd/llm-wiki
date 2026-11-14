# Learning and writing

## Learn by question

**Learn and write → Learn by question.** You type a question ("how are attachment and anxiety connected?") and get a **reading path** through your own pages: which concepts to start with and in what order.

| Level | What it does |
|---|---|
| Quick | Local, with no AI and no cost. Orders by words and links. |
| Light, Medium, Powerful | The model orders the path and explains why. The more powerful, the more expensive. |

Paths are saved; the "read" marks too. You can limit a path to chosen **areas** and topics.

## Write with the wiki

**Learn and write → Write with the wiki.** You pick a kind of text, a topic and a length, and the program writes the text using only your sources.

| Kind of text | What you get |
|---|---|
| Scientific article | Abstract, keywords, introduction, theoretical framework, analysis, discussion, conclusion and an **APA 7 bibliography**. |
| Essay | One line of thought, counterarguments and a clear position; APA 7 citations and a bibliography. |
| Popular science | Lively language for a wide audience, terms explained, fewer citations and a bibliography. |
| Literature review | Who claims what, by theme; a table of the positions, gaps and a bibliography. |
| Fiction | A short story with characters and a plot built on the ideas of the library; no citations in the text, the sources are listed at the end under "Based on". |

- **Quick draft**: from a template, with no AI (scientific article only).
- **With the AI** on three levels.
- **Creativity** from 1 to 5 (strict, restrained, balanced, free, bold): it changes the language and the interpretation, not the facts. At every level the facts and the citations come only from the library; in fiction the level also sets how freely the plot and the characters are invented. Claude Code receives it as an instruction; a model through an API also gets it as the temperature of the request.
- **Blank document**: opens a text with only a title (taken from the topic field, if there is one) and you write it yourself.

### The editor

- **The title** changes when you click it.
- **Help from the AI** (the card above the text): kind of text, level, creativity and **what the model uses**: the areas and topics that are included. You can change them at any time; the scope is kept with the text, so you see the same one next time. Below them are the sources cited so far.
- **Paragraph by paragraph** (in "Preview"): point at a paragraph (on a phone, tap it) and choose: change it by hand, rewrite it with the AI (optionally with a direction, e.g. "shorter, with an example"), add a paragraph after it (you write it or the AI does) or remove it. "Add a paragraph at the beginning" puts a first paragraph right after the title.
- **Continue the text**: adds new text at the end (in a scientific article, before "Conclusion") and completes the bibliography.
- Nothing from the AI is saved by itself: the new text is highlighted, "Save" records it, and **"Undo"** takes back the latest changes one at a time.

Drafts are in the `drafts/` folder and can be edited freely; every version is kept in `drafts/.history/` and deleted ones are in `drafts/.trash/`. Citations to printed pages come from the book's `page_offset`. The bibliography fills itself from the citations; by hand it can only be edited.

## Advice for a thesis or an article

The text is a draft for thinking, not finished work. Check every citation in the original (p. N opens the exact page) and rephrase it in your own words.

Next: [Areas, collections, fixes](#/docs/organize).
