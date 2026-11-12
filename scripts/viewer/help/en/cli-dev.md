# Tests and development

The project is Node.js (ESM) with an Express server and a Vue 3 interface with Tailwind, with no build step. A detailed "goal → files" map is in `PROJECT-HISTORY.md` in the root.

## Structure

| Path | Role |
|---|---|
| `scripts/server.js` | All `/api/*` routes, static files, protections. |
| `scripts/app.js`, `modes.js`, `app-control.js`, `hosts.js` | Launcher, modes, requests to the launcher, site name. |
| `scripts/sandbox.js` | The bubblewrap cage (built-in modules only). |
| `scripts/viewer/app.js`, `index.html` | Components and x-templates. |
| `scripts/viewer/help/` | This documentation (`index.json` and `bg/`, `en/`). |
| `locales/`, `content/` | Interface translations; language packs of rules and prompts. |
| `tests/` | Tests (`node:test`). |

## Tests

```
npm test                 # in a temporary copy, with a fake Claude
npm run i18n:check       # the interface translations
node --check scripts/viewer/app.js
```

The tests spend no tokens and do not touch the library. For a project reached through `\\wsl.localhost`, run them from Linux or from a local copy (a junction to a UNC path does not work).

## Rules

- New interface text: `$t('English text')` and a translation in `locales/bg.json` (`en.json` has the key for key).
- Every non-GET `fetch` carries the header `x-library: 1`: use `api()`.
- Files the launcher runs outside the cage (`app.js`, `modes.js`, `hosts.js`, `sandbox*.js`) use ONLY Node's built-in modules.
- A new writable location (cage): add it to `WRITABLE_DIRS` or `WRITABLE_FILES` in `modes.js` and `sandbox.js`.

## Documentation

Add a page: a file `help/bg/<id>.md` and `help/en/<id>.md`, and a line in `help/index.json`. No long dash.

## Contributing

See `CONTRIBUTING.md`. `main` is protected: changes go through a pull request.
