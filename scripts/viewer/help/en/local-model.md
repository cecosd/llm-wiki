# A local model (Ollama)

A local model runs entirely on your computer. Nothing is sent to the internet and there is no cost per request. Quality depends on the model and on the power of the computer.

## Steps with Ollama

1. Install Ollama from [ollama.com](https://ollama.com) and start it.
2. In a terminal download a model: `ollama pull <model name>`. Pick a bigger model if your computer can take it (more RAM or a graphics card). Small models write weaker pages in less common languages.
3. In the library: **Settings → Model → Ollama**.
4. The default address is `http://localhost:11434`. Press **Load the models** and choose the downloaded model for the three levels (it can be the same one).
5. **Context**: set the real context size of the model. The server cuts the text so that every part fits.
6. **Test the connection**.

## LM Studio and others

The "LM Studio" and "OpenAI-compatible" profiles work the same way: you give the address of the local server (for LM Studio usually `http://localhost:1234/v1`) and the model.

## Notes

- Processing a big book is slow: it is made of many small requests. The price is "free", the time is not.
- A model without tools writes the pages from templates; unknown `[[links]]` become plain text until a stronger model upgrades them ("Upgrade").
- If format errors are frequent, raise the context or pick a stronger model for the "medium" level.

See also: [Choosing a model](#/docs/choose-model).
