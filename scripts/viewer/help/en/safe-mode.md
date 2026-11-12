# Normal and safe mode

The library uses many packages written by other people. If one of them were ever tampered with, with ordinary rights it could read and send your files. **Safe mode** limits how far the program reaches. It is a precaution for the rare bad case, not something to think about every day.

The mode is shown at the bottom of the menu and changed in [Settings → Mode and safety](#/settings/mode). Switching restarts the server for a few seconds.

## The two modes

| | Normal | Safe |
|---|---|---|
| Files the program can reach | All of your account | Only the library folder |
| Scanned PDFs (built-in OCR) | Works | Only with strong protection |
| Backups to other folders | Work | Off (the folders are outside the project) |
| For whom | Everyday work | When you handle files from others or want more peace of mind |

## Two kinds of protection

The kind is chosen automatically by the system, **without needing WSL**.

### Strong protection (bubblewrap)

Linux and WSL with `bubblewrap` installed (`sudo apt install bubblewrap`). The program runs in a "cage":

- it sees only the library folder; its code is read-only;
- it does not see `~/.ssh`, other projects, the Windows drives, the keys of other programs;
- it cannot start Windows programs through WSL.

### Basic protection (Node.js permissions)

For Windows, macOS and Linux without bubblewrap. It runs with `node --permission` (Node.js 24 or newer): Node.js forbids reading and writing outside the library folder (writing is allowed only in `raw/`, `wiki/`, `drafts/`, `outputs/` and the settings files). Helper Node processes (text extraction) get the same limits.

This is a **seat belt, not a cage**:

- programs the server starts (`git`, Claude Code, `ocrmypdf`, `pdftotext`) run with your normal rights;
- the Node.js documentation says explicitly that this mode does not stop determined malicious code;
- the built-in OCR is off because it needs a native add-on.

## What NEITHER mode protects from

- The network is open (it is needed for the model and for "Add an article"). A malicious package could send what it can reach, that is, the library itself.
- Files in `raw/` and `wiki/` can be changed by the program: use "Undo" and backups.
- Mistakes of the AI in the pages.

## Always on (in both modes)

- The server listens only on `127.0.0.1`.
- Checks of `Host`, the origin of the request and a required header: another website cannot read your library.
- A content policy in the pages (no inline code and no outside addresses); HTML from sources is cleaned.
- An optional password.

## Honestly about the switch

The switch button is a convenience for you, not a barrier against code that already runs in the server: such code could ask for a change of mode. If you accept that risk, start the program only with strong protection and avoid hostile files. Details about the packages are in `SECURITY.md`.

## From a terminal

```
npm run app -- --safe      # the shortcut's launcher in safe mode (remembered)
npm run app -- --normal
npm run serve:safe         # bubblewrap only (Linux, WSL)
npm run sandbox:check      # check from inside
```

See also [Starting from a terminal](#/docs/cli-launch).
