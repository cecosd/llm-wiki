# Processing with the AI

New files wait on the home page. You press **Process** and the AI turns them into pages.

## What is created for one source

- **The source page**: summary, emphasis, key ideas with pages (`p. N`, the PDF page number that opens the reader at exactly that place), an APA 7 reference.
- **A page for each chapter** (books only), so you can go down from a concept to the chapter and the page.
- **Concepts and people**: new pages or additions to existing ones (usually 5 to 15 pages are touched). Before making a new one the program checks that the same thing does not exist under another spelling.
- **Contradictions**: if a source disagrees with something already known, there is a `## Contradictions` section.
- The index, the overview and the log are updated.

The **emphasis** of a source is decided by the source itself (its stated aim, its most developed chapters), not by you.

## Before it starts

A window shows approximate tokens and cost. You continue or cancel. With "Do not ask again" the display is switched off (it comes back from the home page settings).

## Modes (when an agent, Claude Code, works)

| Mode | How it works |
|---|---|
| Economy | A cheaper model reads the chapters, a stronger one writes the pages. |
| Balanced | One medium model. |
| Best | The strongest model. |

The models for reading and writing can also be chosen separately. With a model without tools (API, local, manual) the server cuts the book into parts itself and writes the pages; there are fewer modes.

## While it runs

The left bar shows "working" and the step. You can stop. Runs that were stopped or hit a provider limit resume (the "continue automatically" setting).

## If you do not like the result

- **Undo**: returns the wiki to the state before the run (needs `git`).
- **Upgrade**: an old source is completed to the current standard without making a second page.
- **Reprocess** a file explicitly if you want a fresh reading. Otherwise every file is read once.

## What it costs

See [Cost and privacy](#/docs/cost-privacy). Next: [Reading and searching](#/docs/reading).
