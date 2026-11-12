# Backups and sharing a library

This guide is for anyone who wants their library to survive a dead disk, or to work on one library together with another person. Read the first two sections if you only want a backup. Read the whole guide if you share a folder (for example in pCloud, Dropbox or Google Drive) with a colleague.

The Bulgarian version is [backup-and-sharing.bg.md](backup-and-sharing.bg.md).

## 1. The idea in one minute

Your library lives on one computer: `raw/` (your sources), `wiki/` (the pages), `drafts/` (your articles) and some personal files. If that disk dies, everything is gone. The reading archive in Settings is not enough, because it is a read-only copy without the original files.

A **copy** is any folder you point the app to: another disk, a network disk, a folder that Google Drive, Dropbox or pCloud uploads. You press **Copy now** when you want. Nothing runs by itself, and nothing is watched in the background.

There are three kinds of copy. Choosing the right kind is the only decision that matters.

| Kind | Who writes in the folder | What it does | Use it for |
|---|---|---|---|
| **Backup** | Only you | Always writes yours to the folder and does not ask. Older versions and files you deleted go to `_deleted/` in the folder. | Disaster recovery |
| **Shared folder** | You and other people | Compares before it writes. If somebody else changed something, it shows you and asks. | Working together |
| **Take from a copy** | Someone else | Only takes what they added. Nothing is written in their folder. | Merging a colleague's library into yours |

**Rule of thumb:** if only you write in the folder, it is a Backup. If anybody else writes in it too, it is a Shared folder. A backup folder that two people write to will silently overwrite each other's work.

## 2. Make a backup (5 minutes)

1. Open **Settings → Backups and sync**.
2. Give the copy a name, for example `Disk E`.
3. Write the full folder path. In WSL, a Windows disk `E:` is `/mnt/e/...`, for example `/mnt/e/llm-wiki-backup`. A path like `E:\llm-wiki-backup` is converted for you. The form checks the folder and shows the free space.
4. Choose **Backup**.
5. Tick **Include the program code** if you want the folder to be a complete project you can start from. It never includes `node_modules`. Leave **keys and password** unticked unless the folder is private.
6. Press **Add**, then **Copy now**.

The window first compares and tells you what will happen: how many files are new, how many changed, and which kinds (original files, extracted text, pages, drafts, settings and history, program code). **Show the files** lists them one by one. Press **Copy** to go on.

The button **Copy to other folders** in the left menu does the same from any page. It turns amber when there has been no copy for more than 7 days.

**Check the copy** in Settings compares the copy with your library and tells you what is missing or different.

### What a backup contains

| In the folder | What it is |
|---|---|
| `raw/`, `wiki/`, `drafts/` | Your sources, pages and articles |
| `outputs/` | Collections, saved paths, history of processing (not the old archives) |
| `.library-git/` | The history that **Undo** uses |
| `_machine/library.config.json` | Your settings (model, language, the list of copies) |
| `scripts/`, `content/`, `locales/`, `package.json`, … | The program, only if you ticked **Include the program code** |
| `_deleted/<date>/` | Older versions of files that were replaced, and files you deleted |

Not included: `node_modules`, `.git`, the keys and the password (unless you ticked it).

### Older versions and deleted files

In a backup, a file you deleted on your computer is moved to `_deleted/<date>/` in the copy, not erased. The same happens with the old version of a file that was replaced. You choose how many days to keep them (default 30). Open the folder `_deleted` in your file manager if you need something back.

## 3. After a disaster: bring the library back

You need the program and a copy.

1. Get the program: clone it from GitHub, or take the code from a copy that included it.
2. In the program folder run `npm ci`.
3. Look first, change nothing:
   ```
   npm run restore -- /mnt/e/llm-wiki-backup
   ```
   It prints how many files would be restored and how many differ.
4. Restore:
   ```
   npm run restore -- /mnt/e/llm-wiki-backup --apply
   ```
   Files that already exist and differ are not touched unless you add `--force`. Even then, your version is saved in `outputs/merged/restore-<time>/`.
5. Start the app: `npm run serve`.

Keys and the password are restored only if the copy had them. Otherwise add your model key again in **Settings → Model**.

## 4. Work with another person in a shared folder

Example: you and Ivan both use a pCloud folder `llm-wiki-shared`.

### 4.1 Set up (both of you)

Each person, on their own computer:

1. **Settings → Backups and sync → Add a copy**.
2. Choose **Shared folder**, and write the path of the pCloud folder on your computer.
3. Press **Add**.

Also add your own **private Backup** to a different folder. The shared folder is for working together; it is not your safety net (see 4.4).

### 4.2 What goes in a shared folder

Only `raw/`, `wiki/` and `drafts/`. Your settings, collections, history of processing, the Undo history and the program code stay on your computer. This is on purpose: otherwise each of you would overwrite the other's settings.

### 4.3 The first time and every time after

Press **Copy now**. The app compares three things: your files, the files in the folder, and what the folder looked like the last time **you** copied.

| Situation | What the app does |
|---|---|
| Only you changed a file | Sends it |
| Only Ivan changed it (or added it) | Tells you and asks |
| Both changed the same file | Shows the differences paragraph by paragraph and asks |
| Ivan deleted a file | Ignores it. His deletion does not remove anything from your library |
| You deleted a file | Leaves it in the shared folder |

When there are changes by others, you see a yellow notice and four choices:

- **Review the changes one by one.** For each file you choose *Skip*, *Take*, or for a conflict *Keep mine*, *Take theirs*, or *By paragraph*. **Show** displays the two versions side by side. For each difference you pick *Keep mine*, *Take theirs* or *Both*.
- **Send only mine, leave theirs.** Sends your changes and does not touch Ivan's.
- **Overwrite theirs with mine.** Asks first. Ivan's versions stay in `_deleted/` in the folder.
- **Cancel.**

What you skip stays as it is, and you are not asked about **the same version** again. If Ivan changes the file again, you are asked again. **Ask about them again** brings back everything you skipped.

Before the app replaces one of your files, it saves your version in `outputs/merged/sync-<time>/`. Everything taken is one step in the history, so **Undo** brings the pages back.

**The first time** the second person copies there is no record yet, so many files may show as "both changed". Go through them. **Take all new** is safe.

### 4.4 Special files

- **`wiki/log.md`** is merged entry by entry: nothing is lost, new entries from the other person are added to the end.
- **`wiki/index.md` and `overview.md`** are not taken from others. After you take pages, the index is rebuilt from the pages.
- **`raw/manifest.json`** is merged.

### 4.5 Rules that keep two people out of trouble

1. **Do not copy at the same time.** The app puts a lock file in the folder for 10 minutes, but cloud programs are slow and the lock may arrive late.
2. **Wait for the cloud program to finish** before you press **Copy now**. If Ivan saved a minute ago, his files may not have reached your computer yet.
3. **Each person keeps a private Backup too.** A shared folder helps you work together, but a cloud mistake can still hurt both of you.
4. **Agree who runs "Overwrite theirs with mine".** Use it rarely.
5. If the cloud program creates a "conflicted copy" file, the app sees it as a new file. Look at it and decide.

## 5. Take what a colleague added

Your colleague has their own library. You want what they added, and you do not care what they deleted.

1. Ask them for a copy of their library folder (or use a folder both of you can reach).
2. **Settings → Backups and sync → Add a copy**, kind **Take from a copy**, and write the folder path.
3. **Copy now** shows what is new or different. Review it one by one, as in 4.3.

Nothing is written in their folder. After the merge, the app writes a line in `log.md`, and you can run **Duplicates** from the collections if the same person or concept appears twice.

## 6. Windows and WSL

- A Windows disk `D:` is `/mnt/d/` in WSL. You may write `D:\folder` in the form.
- **Virtual drives do not work.** `pCloud Drive` (the drive letter, usually `P:`) is a virtual drive: WSL does not see it. Use a normal folder instead: the **pCloud Sync** folder (a real folder on `C:`), or a folder on a real disk that pCloud uploads. The form tells you when a drive is not visible.
- **Network paths** (`\\server\share`) must be mounted in WSL first.
- **Isolated mode.** If you start the library with `npm run serve:safe` (or a desktop shortcut that uses it), copies to other folders are switched off, because the isolation sees only the project folder. Start with `npm run serve` to use them. Giving the isolation access to chosen folders only is planned.

## 7. Is it safe?

- The app writes only inside the folders you added and never outside them.
- A copy folder cannot be inside the library, and the library cannot be inside a copy.
- Files are written to a temporary name and renamed, so a stopped copy does not leave half a file.
- Without the isolation, the program and its packages run with all your rights. See [SECURITY.md](../SECURITY.md).
- Copies are not encrypted. Use an encrypted disk or an encrypted cloud folder if the material is sensitive.

## 8. Commands

| Command | What it does |
|---|---|
| `npm run sync -- list` | Lists the copies |
| `npm run sync -- plan <name>` | Shows what a copy would do |
| `npm run sync -- run <name>` | Copies (it stops and tells you if others changed something) |
| `npm run sync -- run <name> --push-only` | Sends only yours, leaves theirs |
| `npm run sync -- run <name> --overwrite` | Overwrites theirs with yours (theirs go to `_deleted/`) |
| `npm run restore -- <folder>` | Shows what a restore would bring back |
| `npm run restore -- <folder> --apply [--force]` | Restores |

## 9. Questions

**Does it copy by itself?** No. You press the button. This keeps it quiet and predictable.

**My copy says "Not available".** The folder cannot be reached: the disk is not connected, or the network is down.

**I added a copy and it disappeared after a restart.** Update to the latest version. An earlier version rewrote the settings file when the processing mode changed.

**Can I copy to several places?** Yes. Add as many copies as you want. Each has its own record. A copy that is not reachable does not stop the others.

**Does it use my model's tokens?** No. Copying is done by the program and never calls a model.

**What is not tested yet?** The app is tested with ordinary folders. It is not yet tested with real pCloud, Dropbox or Google Drive, or with two people at once. Try a small library first.
