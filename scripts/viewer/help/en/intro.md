# What the library is

The library is a personal knowledge base kept on your own computer. You decide what goes in: books, articles, notes, tables, images. An AI model reads each file and writes linked pages: a summary of the source, chapters, concepts, people and topics. You read, search and learn from your own sources, and every claim points back to the page it came from.

The model follows Andrej Karpathy's "LLM Wiki" idea. Think of it like programming: the files in `raw/` are the source code, the AI is the compiler, and the pages in `wiki/` are the result.

## What it is made of

| Part | What it is |
|---|---|
| `raw/` | Your files. The program never changes them. |
| `wiki/` | The pages the AI writes: sources, chapters, concepts, people, topics, comparisons, questions. |
| `drafts/` | Your drafts from "Write with the wiki". |
| `outputs/` | Reports, the history of runs, the server log. |

## What happens where

1. **You add** a file from the home page (or an article by DOI).
2. **The AI processes it**: reads, writes pages, updates concepts. You see the approximate cost first.
3. **You read and search**: pages, link map, log, search with Ctrl K.
4. **You learn and write**: a reading path for a question; a scientific article, an essay, a popular science article, a review or a story from what you have read, at the creativity you choose; or a text of your own with help paragraph by paragraph.

## What it does not do

- It uploads nothing by itself. Files and pages stay on your computer; only what you confirm goes to the AI.
- It does not change your originals. Mistakes of the AI in pages are undone with the "Undo" button.
- It does not require a particular model. You can use Claude, another provider with a key, a local model, or copy requests into a chat by hand (see [Choosing a model](#/docs/choose-model)).

Next: [Installing](#/docs/install).
