# New versions and a retired model

## A new version

When the program starts it asks GitHub, quietly and once, for the version number. If there is a newer one, a green button **"New version X"** appears in the menu. It opens a window with:

- **What is new**, from the file `CHANGELOG.md` of the project, for every version between yours and the new one.
- **A warning box** when the update may change how something works: either an item is listed under *Breaking changes*, or it is a new *major* version (the first number grew). Read it and make a [backup](#/docs/backup) first if you are unsure. When no notes were published, the window says so instead of promising that nothing changes.
- **Install X**. The program fetches the new version with git (only a straight fast-forward), installs new packages if the lock file changed, puts your language pack back and restarts itself. **Your library, drafts and settings are not touched**; only the program files change.

If you ever edited a program file on purpose, the update does not overwrite it silently: it lists the files and offers to replace them, keeping a copy in `outputs/update-backup/`. A copy with commits of its own is not merged at all.

You can also press **Check for a new version** in *Settings -> Updates*, and there you can turn the quiet check at start-up off. `Skip this version` hides the button until a newer version appears. If git is missing, the window says so and points to the installer.

## A retired model

Providers retire models from time to time. With the Claude subscription nothing is needed: *Haiku*, *Sonnet* and *Opus* are names of families that always point to the current model. With any other provider the program asks, quietly and once, for the provider's list of models (a free request, no text of yours) and compares it with your three choices. If one is gone, an amber notice appears in the menu and at the top of *Settings -> Model*: press **Load the models** and choose another one. Nothing changes by itself, because a replacement can cost more or behave differently. If you do not open the program before the model is switched off, the first request fails with a clear message (`... does not know the model ...`) that leads to the same place.

For the terminal: `GET /api/updates/quick`, `POST /api/updates/code/install` and `GET /api/ai/health`; the changelog format is described at the top of `CHANGELOG.md`.
