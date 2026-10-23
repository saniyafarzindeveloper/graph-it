# Repository map agent

A standalone Deep Agent for answering questions from one analyzed repository graph. It has six read-only tools, and its dependency walk and insight calculations use the same functions as the map canvas.

## Current boundary

The app issues an encrypted, signed, short-lived capability after confirming the signed-in user's organization can read a completed analysis. It binds exactly one analysis and organization. The embedded Clerk session JWT is encrypted inside the capability so the agent service never receives or decodes a broad organization token. The app's tool endpoints validate the capability and use that JWT through the publishable-key Supabase client, so database RLS remains in force; there is no service-role credential in the agent.

Add this secret to the app's root `.env.local` (generate a fresh value with `openssl rand -base64 32`):

```dotenv
AGENT_CREDENTIAL_SECRET=<random value of at least 32 bytes>
```

The app exposes `POST /api/analyses/{analysisId}/agent-credential` for a signed-in organization member. The six bearer-only GET endpoints are `GET /api/agent/tools/summary`, `/search-files`, `/files-by-role`, `/neighbors`, `/walk`, and `/routes`. Requests without a valid credential, with an expired credential, or for an analysis outside its signed scope are rejected. These endpoints return graph metadata only.

The agent receives the opaque capability only in its tool closures. It receives no analysis ID, organization ID, or raw database token, and it cannot query Supabase or fetch repository source code directly. The app's authenticated `POST /api/analyses/{analysisId}/ask` entry point mints a fresh capability for each question, maps the browser conversation to an opaque per-user/per-organization/per-analysis thread ID, and proxies the agent's server-sent events to the browser. Conversation checkpoints live in the service process's memory and are lost when it restarts.

The six tools are:

- `get_repository_summary` — stored framework, counts, parser coverage, role counts, and shared graph insights.
- `search_files_by_path` — exact analyzed paths matching a substring.
- `list_files_by_role` — paths assigned a stored role.
- `get_direct_neighbors` — direct imports and direct dependents.
- `walk_dependencies` — transitive walk in either direction via the shared `walkGraph` function.
- `get_route_table` — exact parsed routes, optionally filtered.

Tool output is capped at 100 entries. Dependency walks are capped at 20 levels. All tools are read-only.

## Configure

The command loads `../.env.local`. Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Optional settings:

```dotenv
REPOSITORY_AGENT_MODEL=gemini-3.8-flash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
LANGSMITH_PROJECT=my-first-agent
```

Use `.env.local` for real keys. The `.env.example` file contains placeholders only. The app can point at another HTTPS service URL with `REPOSITORY_AGENT_SERVICE_URL`; local development defaults to `http://127.0.0.1:3100`.

## Invoke locally

Start the standalone agent service in one terminal:

```sh
npm run agent:server --prefix deep-agent
```

It listens on `127.0.0.1:3100` by default. The tools call the app's read-only endpoints. Set `REPOSITORY_TOOLS_URL` to the app origin (it defaults to `http://localhost:3000`). The dashboard's Ask panel mints and passes short-lived capabilities automatically. To invoke the local CLI manually, pass a capability from `POST /api/analyses/{id}/agent-credential`:

```sh
npm run agent -- "Where are the authentication-related files?"
```

The CLI reads the opaque token from `REPOSITORY_AGENT_CREDENTIAL` in its environment. Treat it like a password and do not put it in shell history, a dotenv file, or logs. The command prints tool names followed by the answer.

## Check types

```sh
npm run typecheck
```
