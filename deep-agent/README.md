# Deep Agents quickstart

A small TypeScript research agent built with LangChain Deep Agents. It uses OpenAI's built-in web search and the shared, pinned `gpt-5.5-2026-04-23` model client.

## Configure keys

Add these values to the repository root `.env.local`:

```dotenv
OPENAI_API_KEY=your_openai_api_key
LANGSMITH_API_KEY=your_langsmith_api_key
```

`LANGSMITH_TRACING`, `LANGSMITH_ENDPOINT`, and `LANGSMITH_PROJECT` are configured in the root `.env.local`. LangSmith's API key is separate from your OpenAI key and is needed to send traces to the project.

## Run

From this directory:

```sh
npm install
npm run agent
```

Pass a topic as a prompt:

```sh
npm run agent -- "What changed in the latest TypeScript release?"
```

The agent performs a web search and prints a concise report. Its model uses the same dated GPT-5.5 snapshot pinned by the app.

Run `npm run typecheck` to check the TypeScript source without making a model request.
