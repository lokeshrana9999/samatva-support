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

`npm run eval -- --suite risk` runs the risk suite against real Jev (needs `TYPESAFE_API_KEY`).

## eval results

Risk gate, 2026-10-26, `jev-1.14.0`, 60 synthetic cases (English and Hinglish, with hard negatives and two prompt-injection attempts). R is recall, P is precision. Full output: `evals/results/latest-risk.json`.

| reading | imminent R / P | elevated R / P | none R / P | any risk R / P |
|---|---|---|---|---|
| final (keyword floor + Jev) | 100% / 100% | 100% / 90% | 91% / 100% | 100% / 95% |
| keyword floor alone | 40% / 100% | 28% / 83% | 100% / 48% | 37% / 100% |
| Jev alone | 100% / 100% | 100% / 90% | 91% / 100% | 100% / 95% |

Being-harmed recall: 100%. The two misses are Hinglish exaggerations read as `elevated` ("kaam itna hai ki mar jaunga", "mummy maar dalegi"), which only adds crisis lines to the screen. The suite is small and written by the same person who wrote the gate, so treat it as a smoke test, not a benchmark.

With `LLM_LOCAL_CLI=1` in `.env.development.local`, local chat goes through the Claude CLI on Haiku instead of OpenRouter, and without Supabase keys sessions are kept in memory. Neither path exists in a production build.
