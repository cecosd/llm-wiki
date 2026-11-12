# Cost and privacy

## Cost

Before every action with a model, approximate **tokens** and **cost** are shown. Tokens are counted from characters (an error of about ±30%). The cost is a range and depends on the model:

- Claude Code and the Anthropic API: at Anthropic's prices.
- Other providers: at the prices you entered for the provider; if you did not, only the tokens are shown.
- A local model and manual mode: "free".

The real cost of every run is recorded in the history (`outputs/.agent-history.json`).

## Where the data goes

| Way | What leaves the computer |
|---|---|
| Local model | Nothing. |
| Manual | Only what you paste into the chat yourself. |
| Claude, ChatGPT, Gemini and so on | The text of the file being processed and context from the pages. It goes to the chosen provider under its terms. |
| Add an article | A request to the publisher (the DOI or the address you gave). |

The program uploads no library files anywhere. The provider's terms are shown in **Settings → Data and privacy**. For consumer plans of some providers there is a setting about training on your data in their account: check it there.

## Keys and passwords

- Keys are in the file `.library-secrets.json` (only for you, outside Git). The page never gets them back.
- A password for the interface is optional: **Settings → Password**.
- The server listens only on `127.0.0.1`: it is not visible from the network.

## How to limit the cost

- Start with one small source.
- Use a cheap model for reading chapters (economy mode).
- With free keys watch the limits; the queue waits by itself.
