# Changelog

All notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/).
The program reads this file to show "What is new" before an update, so please keep the headings as they are:
`## [version] - date`, then `### Added`, `### Changed`, `### Fixed` and, when something may stop working for someone,
`### Breaking changes` (every item under that heading is shown in a warning box).

## [2.2.0] - 2026-11-16

### Added
- **Install new versions from the app.** The start-up check shows a "New version" button with what changed and whether anything may break; one more button installs it (git fast-forward, packages when the lock file changed, then a restart). Edited program files are never overwritten without a copy in `outputs/update-backup/` and your yes.
- **Quiet start-up checks** for a new version and for a retired model. Both can be turned off in Settings -> Updates.
- **A warning when the chosen model is no longer offered** by its provider, with a link to Settings -> Model.
- **Quick drafts for every kind of text**, not only for a scientific article: an essay (introduction, thesis, antithesis, conclusion), a popular science article, a literature review (with a table of positions) and an outline for a story. They are built from the library without a model.
- **Levels of use:** Bookworm, Librarian and Keeper of the Scrolls decide how much of the menu and of the settings is shown. Everything stays reachable by its address.
- `scripts/git-setup.js`: the installers install git when it is missing and link the folder to the project repository, so that updating works for a folder that came from a ZIP too.
- Release notes: this file.

### Changed
- The setup screen and the check list no longer mention Claude Code until you have chosen a model that needs it.
- Cloud examples in the backup texts no longer name one provider.
- All comments in the code are in English.

### Fixed
- The quick draft no longer refuses kinds of text other than a scientific article.

## [2.1.0] - 2026-11-14

### Added
- Backups and sync, the installer with a window, the app in its own window, safe mode without WSL, kinds of text and creativity in "Write with the wiki", "Review with the wiki" and the `wiki-review` skill.
