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

`npm run eval -- --suite risk` runs the risk suite against real Jev (needs `TYPESAFE_API_KEY` in `.env.local`). `npm run eval -- --suite recommendation --target claude-cli` (or `grok-cli`) runs the recommendation suite through the full turn pipeline on a local CLI. The eval script loads `.env.local` only, never `.env`.

## eval results

Risk gate, 2026-10-26, `jev-1.14.0`, 60 synthetic cases (English and Hinglish, with hard negatives and two prompt-injection attempts). R is recall, P is precision. Full output: `evals/results/latest-risk.json`.

| reading | imminent R / P | elevated R / P | none R / P | any risk R / P |
|---|---|---|---|---|
| final (keyword floor + Jev) | 100% / 100% | 100% / 90% | 91% / 100% | 100% / 95% |
| keyword floor alone | 40% / 100% | 28% / 83% | 100% / 48% | 37% / 100% |
| Jev alone | 100% / 100% | 100% / 90% | 91% / 100% | 100% / 95% |

Being-harmed recall: 100%. The two misses are Hinglish exaggerations read as `elevated` ("kaam itna hai ki mar jaunga", "mummy maar dalegi"), which only adds crisis lines to the screen. The suite is small and written by the same person who wrote the gate, so treat it as a smoke test, not a benchmark.

Recommendation, 2026-10-26, 24 scripted conversations (12 English, 10 Hinglish, 2 that start vague), run through the full turn pipeline on the Claude CLI (Haiku) with real Jev. Full output: `evals/results/latest-recommendation-claude-cli.json`.

| measure | result |
|---|---|
| reached the recommend step | 24 / 24, after 2.1 user turns on average |
| expected kinds of help present | 24 / 24 (English 12 / 12, Hinglish 10 / 10) |
| exact match, ignoring the default "therapist" | 20 / 24 |
| crisis line added where the script had no risk | 3 (severe low mood, eating, drinking: Jev read severity as elevated risk) |
| cards pointing outside the catalogue | 0 |
| replies containing a link | 0 |
| turns that fell back to a stock line | 0 |

Same suite on the Grok CLI (its default model, run before the reply-language fix in `9ea4daf`): 24 / 24 reach recommend with the expected help types, 20 / 24 exact, 3 unasked-for crisis lines, no stray cards or links. 6 turns fell back to a stock line. In 5 of them Grok was still asking for searches at the 3-call cap, so the controller showed its own top cards with the stock line, as designed. In the sixth the CLI exited with "max turns reached". Full output: `evals/results/latest-recommendation-grok-cli.json`.

The rules table adds "therapist" to every recommendation by design, so a self-care case shows a therapist too. Help types come from Jev's needs record and the rules table, not the chat model, so the chat model mostly shapes the wording and which cards show.

Locally, chat always goes through a CLI: `LLM_LOCAL_CLI=claude` (the default, Haiku) or `LLM_LOCAL_CLI=grok` in `.env.development.local`. The API providers and their keys are for production only, and neither local dev nor the evals use them. Without Supabase keys, sessions are kept in memory. None of these local paths exist in a production build.
