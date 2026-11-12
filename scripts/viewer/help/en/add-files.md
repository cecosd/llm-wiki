# Adding files

## From the home page

Drop files on the home page or pick them with the button. PDF, EPUB, MOBI, Word (DOCX, ODT and the old DOC), text, Markdown, HTML, tables (XLSX, CSV, JSON) and images are accepted. One file can be up to 2 GB.

Files first go to `raw/inbox/`. The program **sorts** them into folders by type (books, articles, tables, images and so on), records a checksum, and **extracts the text** into the hidden folder `raw/.extracted/`. The original is not changed.

A file you do not want is deleted from the "pending" list; it goes to `raw/.trash/` and is never processed.

## Add an article

The menu **Learn and write → Add an article** accepts a **DOI** or an `https://` address. The program downloads the PDF (if it is free), otherwise the text of the page or only the abstract. There is no search in catalogues. Then you choose the processing mode and the indexing language for that file.

## Scanned documents

A PDF without a text layer is recognised with OCR. `ocrmypdf` works best (optional, see the **Setup** screen); otherwise the built-in one is used, which is slower and less exact. In [safe mode](#/docs/safe-mode) on Windows and macOS the built-in OCR is off.

## Tables and images

For tables the AI describes the columns, the range and what questions can be asked; the data is not copied. Images are described if the model can see pictures.

## By hand in the folders

You can put files straight into `raw/inbox/` and press refresh. From a terminal: `npm run inbox`, then `npm run extract` ([commands](#/docs/cli-commands)).

Next: [Processing with the AI](#/docs/processing).
