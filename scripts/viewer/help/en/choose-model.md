# Choosing a model or provider

The model is chosen in the app: **Settings → Model**. You can change it at any time. Claude Code is **not required**.

## The three ways to work

| Way | What it means | When |
|---|---|---|
| **Agent** (Claude Code) | The model has tools: it opens files itself, checks pages, fixes links. | Best quality. Needs Claude Code. |
| **Without tools** (API, local) | The server cuts the text into parts, sends them to the model and writes the pages itself from templates. | Any provider or local model. |
| **Manual** | Every request is copied into a chat in the browser and the answer is pasted back. | No account and no key. Slow. |

## Profiles

- **Claude**: a subscription (Pro, Max) or an API key, through Claude Code.
- **Claude Code with another provider** (DeepSeek, Ollama, another that accepts the Anthropic format).
- **With a key (API)**: ChatGPT (OpenAI), Claude API, Gemini (paid), DeepSeek, Mistral.
- **Free tier**: Gemini, Groq, OpenRouter. They have limits per minute and per day; the queue waits by itself when they run out.
- **On this computer**: Ollama, LM Studio or another OpenAI-compatible server ([A local model](#/docs/local-model)).
- **Manual**.

## How to set it up

1. Pick a profile from the list.
2. Paste the key if it needs one (there is a link to the keys page next to the profile). The key is stored locally in a file and is not shown in the page (only the last 4 characters).
3. Choose the three models: light (reads chapters), medium (writes pages), powerful (synthesis). "Load the models" takes them from the provider; models for speech, audio and images are hidden.
4. Press **Test the connection**: a short check that shows a wrong key, a missing credit, or a model that does not write text.

Button texts follow your choice: "Ask ChatGPT" instead of "Ask Claude" (the labels can also be replaced by hand).

## What should I choose?

- I want to think about it as little as possible: **Claude** with a subscription.
- I want free: **Gemini** (free tier) or **Groq**, or **manual**.
- I want nothing to leave the computer: **a local model**.

Next: [Cost and privacy](#/docs/cost-privacy).
