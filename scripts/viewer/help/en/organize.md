# Areas, collections, fixes

## Areas

Every source has an **area** (1 to 3 words, for example "Physics"). The **Areas** page assigns them automatically for old sources (a cheap model, with the cost shown first and a preview), renames and merges. Renaming to a name that already exists merges them. "Learn by question" and "Write with the wiki" can be limited to chosen areas and topics. Concepts take their area from the sources that cite them, but stay **one** page.

## Collections

The **Collections** menu has three kinds:

- **Types** from the wiki itself (Sources, Concepts...). Their order and hiding are arranged with the gear icon.
- **Smart collections**: conditions (type, tag, area, format, confidence, author, years, text). Pages are computed in the browser; "and" between fields, "or" inside one field.
- **Lists**: your pages in an order you choose. The "List" button above a page adds it.

## Fixes inside a page

Select text and use the bubble:

| Action | What it does |
|---|---|
| Ask | A question about the selected text; the answer can be saved as a "Question" page. |
| Edit | Manual change of the paragraph. The number and order of `[[links]]` do not change. |
| With AI | A proposed change; you see "before, after" and accept or not. |
| Link | Turns the selected text into a link to another page. |
| Remove | Removes the paragraph with the links in it. Headings cannot be removed here. |

## Undo

Every processing run and every change by the AI or by these actions is a restore point. **Undo** returns the previous state (needs `git`; the history is in the separate `.library-git`, not in your own repository). If there are other changes in `wiki/` afterwards, the undo is refused with an explanation.

## Duplicates

If one name is written two ways (Tchaikovsky and Chaikovsky), `npm run dupes` or the collections in the interface show and merge them. An archive of what was merged stays in `outputs/merged/`.

## Removing a source

A preview of what will go (pages only from this source and the citations to it). It is applied only by you, with the button or `--apply`.

Next: [Backups and archive](#/docs/backup).
