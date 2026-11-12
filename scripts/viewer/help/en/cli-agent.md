# Working with Claude Code

Besides the interface, the library can be run straight from Claude Code in a terminal. This is the "agent" mode: Claude opens the files and writes the pages by the rules of the project.

## Preparation

1. Install Claude Code from the [Anthropic documentation](https://docs.claude.com/en/docs/claude-code/setup) and sign in once with `claude`.
2. In the library folder run `claude`. It reads `CLAUDE.md` (the rules of the wiki) and, if it exists, `CLAUDE.local.md` (your personal preferences, outside Git) automatically.

## Skills

Skills are in `.claude/skills/` and are called with a slash:

| Command | What it does |
|---|---|
| `/wiki-inbox` | Sorts `raw/inbox/`, extracts the text, shows what is waiting. |
| `/wiki-ingest` | Processes the new raw files: source page, chapters, concepts, index, log. |
| `/wiki-chapters <slug>` | Adds chapter pages to an already processed book. |
| `/wiki-upgrade <slug>` | Upgrades an old source to the current standard. |
| `/wiki-query <question>` | Answers from the wiki, with citations. |
| `/wiki-synthesis [tag]` | Comparisons, topic hubs, gaps. |
| `/wiki-lint` | Mechanical and semantic check. |

## The rules in `CLAUDE.md`

- `raw/` is never changed.
- Frontmatter on every page; citations like `([[source-ch03]], p. 53)`; `p. N` is the PDF page number from the marker `<!-- стр. N -->`.
- A new page has at least one incoming link; contradictions go in `## Contradictions`.
- The language of the pages is the content language (Bulgarian or English).

To change the rules, edit the pack in `content/<code>/` and run `npm run content -- <code>`; otherwise the next language switch brings back the old text.

## Something other than Claude

If you use another model through Claude Code (Ollama, DeepSeek), set the profile in the interface: it passes the needed environment variables. Details: [Choosing a model](#/docs/choose-model).

## It does not read secrets

The files with keys and settings (`.library-secrets.json`, `.library-auth.json`, `library.config.json`) are forbidden for the agent to read.
