# samatva-support

A support assistant that listens first, then helps someone work out what kind of help they need. Its restraint lives in a controller outside the model, following [samatva](https://github.com/lokeshrana9999/samatva)'s design.

Status: step 1 of the build (deployed skeleton). See `docs/spec.md` for the decisions and step plan, and `docs/design.md` for the system and frontend design.

## run locally

Needs Node 22+. Secrets live in `.env` and `.env.local`, both gitignored.

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (vitest)
npm run typecheck
npm run lint       # includes the core's import-boundary rule
```

With `LLM_LOCAL_CLI=1` in `.env.development.local`, local chat goes through the Claude CLI on Haiku instead of OpenRouter, and without Supabase keys sessions are kept in memory. Neither path exists in a production build.
