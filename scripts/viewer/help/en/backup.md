# Backups and archive

The library is a folder on one disk. If the disk dies, everything is lost, so make at least one copy elsewhere.

## Backup and sharing

**Settings → Backups** (and the button in the menu). The target is any folder: a second disk, a network drive, Google Drive, Dropbox, OneDrive, pCloud Sync. There are three kinds of target:

| Kind | Behaviour |
|---|---|
| Backup | Always writes our state, does not ask. |
| Shared folder | If it has someone else's changes, it asks whether to take or overwrite them; for one page it merges paragraph by paragraph. |
| Pull only | Takes from a colleague's copy. |

Checking happens only on request ("Check the copy"); there is no timer. Replaced versions go to `_deleted/`. Keys and the password are not copied by default. A detailed guide: `docs/backup-and-sharing.md` in the project folder.

## Restoring

```
npm run restore -- <folder>            # only shows
npm run restore -- <folder> --apply    # restores
```

## Archive for reading

**Settings → Archive for reading → Make the archive** makes one ZIP with the pages and the text of the books (without the original PDFs). It opens by double-clicking `index.html` and works without a server and without the internet. It is not a backup: the library cannot be restored from it.

## Limit

In [safe mode](#/docs/safe-mode) (with both kinds of protection) copies to other folders are off, because the program cannot write outside the project. Make the copy in normal mode.
