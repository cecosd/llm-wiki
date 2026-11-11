# Contributing to LLM Wiki

Thank you for your interest. LLM Wiki is maintained by one person, [@cecosd](https://github.com/cecosd). Bug reports, ideas, translations and pull requests are welcome, in English or in Bulgarian.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are reported privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

## How a change reaches `main`

The `main` branch is protected:

- Nobody except the maintainer can push to `main` directly, force-push it or delete it.
- Every other change comes through a pull request. It can be merged only after the maintainer approves it (the maintainer is the code owner of every file, see [.github/CODEOWNERS](.github/CODEOWNERS)) and the tests pass.
- A new push to the pull request after the approval needs a new approval, and every review comment must be resolved.
- Release tags (`1.4.0` and so on) are created only by the maintainer.

The steps:

1. For anything larger than a small fix, open an issue first and agree on the approach. This saves you work on a change that may not fit.
2. Fork the repository and create a branch from `main` (for example `fix/reader-page-numbers` or `feat/epub-covers`).
3. Make the change, with tests where it makes sense.
4. Run the checks below and open a pull request. The template lists what to include.
5. The maintainer reviews it. Expect questions; small, focused pull requests are reviewed faster.

## Development setup

You need Node.js 24 or newer and Git. Claude Code is not needed for development: the tests use a simulated Claude.

```bash
git clone https://github.com/<you>/llm-wiki.git
cd llm-wiki
npm ci
npm test             # the whole test suite, in a temporary copy
npm run i18n:check   # every interface text exists in every language
npm run serve        # the interface on http://localhost:4321
```

`npm test` starts the real server in a temporary copy with a simulated Claude (`tests/fake-claude.js`). It does not touch your library and spends no tokens. Browser tests run only when Chrome or Chromium is found (or set `CHROME_BIN`); the isolation tests need `bubblewrap` on Linux. Tests that cannot run are reported as "not run", not as passed.

`.npmrc` sets `ignore-scripts=true`, so dependencies cannot run install scripts. Keep it that way.

## Ground rules for the code

[PROJECT-HISTORY.md](PROJECT-HISTORY.md) (in Bulgarian) is the map of the code: which files change for which goal, and the lessons learned. The most important rules:

- **Keep to the stack.** Server: Node.js and Express. Interface: Vue 3 (global build with x-templates, no build step) and Tailwind CSS, all served locally, without a CDN. A new dependency needs a reason in the pull request; prefer the built-in Node.js modules.
- **No inline code in pages.** The Content Security Policy forbids inline scripts and external addresses. A new Vue component needs both a `<script type="text/x-template" id="tpl-...">` in `scripts/viewer/index.html` and its registration in `app.js`.
- **Every non-GET request from the browser goes through `api()`** in `app.js`, which sends the `x-library: 1` header. The server refuses requests without it.
- **Interface text lives in `locales/`.** Add every new key to every language file and run `npm run i18n:check`. Texts on the product page are in `docs/landing.js`, in both languages.
- **The agent rules, skills, templates and starter pages are language packs in `content/<code>/`.** `CLAUDE.md`, `.claude/`, `wiki/_templates/` and `scripts/starter/` are installed copies; change the pack and run `npm run content -- <code>`.
- **Personal data never enters the repository.** `.gitignore` keeps out `raw/`, the pages in `wiki/`, `drafts/`, `outputs/`, `library.config.json`, `.library-*.json` and `CLAUDE.local.md`. Check your diff before you commit.
- **Shell scripts keep LF line endings** (`.gitattributes`), or bash refuses them.

## Tests

The tests are in `tests/*.test.js` (`node:test`, no extra framework). A test is named `T(group, English, Bulgarian)` so the report on the Settings page and on the product page can show it in both languages. A known limitation is a real check marked `todo`: when the code is fixed, it passes and the report changes by itself. What is not tested automatically is listed in `tests/not-covered.json`.

## Writing style

- Documentation and interface texts exist in English and Bulgarian. If you can only write one of them, say so in the pull request and the maintainer will add the other.
- Do not use the long dash (em dash, U+2014). Use a comma, a colon, brackets or a new sentence.
- References are in APA 7 style.

## Commit messages

A short subject that says what changed, optionally prefixed by the area (`Groq: text models by default`), and a body that explains why. One logical change per commit.

## License

LLM Wiki is licensed under the [GNU General Public License, version 3 or later](LICENSE). By contributing you agree that your contribution is licensed under the same terms.
