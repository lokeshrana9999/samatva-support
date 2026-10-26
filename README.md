# samatva-support

A support assistant that listens first, works out what kind of help might fit, and points to linked Amaha services and sample therapist profiles. A controller in code owns the conversation stages and the safety gates; the language model writes the wording inside them and calls catalogue search tools only where the controller allows. The restraint design comes from [samatva](https://github.com/lokeshrana9999/samatva).

Built by Lokesh as the build submission for Amaha's AI Engineer role (option 1: "a conversational agent that helps someone figure out what kind of help they might need"). It is an independent demo, not affiliated with Amaha. Therapist profiles are invented samples, and Amaha's service pages are linked, never copied.

- Live: https://samatva-support.vercel.app. Reviewers open the link Lokesh shares (`/join#k=…`) and enter only their email; signing in with an email and the access key on `/login` also works.
- Evals and "About this demo", public: https://samatva-support.vercel.app/evals
- Decisions: `docs/spec.md`. System and frontend design: `docs/design.md`.

## architecture

```
 browser: / (chat)  /login  /evals
    |  POST /api/turn -> SSE status events, then one final event
    v
 +------------------------- core (no I/O) --------------------------+
 | keyword floor -> Jev risk -> limits -> controller -> output      |
 | (local, no      (tiers,      (never    (stage FSM,   filter      |
 |  network)        fail         on a      typed tool   (code +     |
 |                  closed)      handoff)  loop)        Jev)        |
 +------|-------------|-------------|-------------|-----------------+
        |  ports: DecisionModel ChatModel Catalogue SessionStore
        |         AuditLog TranscriptStore RateLimiter
        v             v             v             v
       Jev      chat chain     repo JSON     Supabase, Mumbai
  jev-1.14.0    Google AI      catalogue     (sessions, audit,
                Studio >                      limits, consented
                OpenRouter                    transcripts)
                (local: Claude
                 or Grok CLI)
```

Stages are `intake`, `understand`, `recommend`, `close`, and `handoff`, which any stage can enter. The model never picks the stage. Each provider, Jev and Supabase is an adapter behind a port, and lint stops `src/core/**` from importing any of them. Next.js 16 on Vercel (`bom1`), TypeScript throughout.

## safety design

- Keyword floor: English and Hinglish patterns, each with its own tier and an exclusion list for hard negatives ("this deadline is killing me"). Runs first, needs no network, and still fires when Jev says `none`.
- Jev risk tiers: on every user turn, Jev answers typed questions (tier `none`, `elevated` or `imminent`, plus self-harm, harm to others, being harmed). Thresholds on its probabilities live in config; the stricter of floor and Jev wins. `imminent` goes to the handoff: fixed text and crisis lines (112 first), no model call, nothing about booking. `elevated` locks a crisis line into the recommendation for the rest of the conversation.
- Fail closed: if a Jev call errors or times out, the risk gate treats the turn as `elevated` and the output filter blocks the reply.
- Output filter on every reply: code checks (link allowlist, every name matches this turn's tool results, length cap, Hinglish gendered first-person verbs) plus Jev yes/no checks (diagnosis, medicine or dose advice, claims to be human). On a failure it regenerates once with the violation named, then shows a fixed stock line with a note.
- Caps never block the handoff: 20 turns a conversation, 5 conversations a day and 30 turns an hour per IP and per reviewer, and a $5 daily spend cap are checked after both crisis checks. A turn in handoff is never capped, and the crisis lines stay on screen when a limit hits.
- Data: message text is stored only with opt-in consent and purged after 30 days; the audit log holds gate results and token counts, no text. Emails and IPs are kept only as keyed hashes.

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

Reply checks, 2026-10-26: Jev's three output checks on 31 labelled synthetic replies, at the app's 0.3 threshold. Full output: `evals/results/latest-reply-checks.json`.

| check | recall | precision |
|---|---|---|
| diagnosis | 100% (7) | 88% |
| medical or medication advice | 100% (6) | 100% |
| claims to be human | 100% (5) | 100% |

All 13 clean near-misses pass every check, including reflections of the user's worry, suggesting a psychiatrist, and pointing medicine questions to a doctor. The one imprecise result is a dose-advice reply that was also flagged as a diagnosis.

Red team, 2026-10-26: 15 multi-turn pressure scripts (diagnosis, dose, "are you human", gender, a jailbreak, a role-play as a human psychiatrist, crises buried mid-conversation in English and Hinglish, an instruction aimed at the safety model, link and name bait, an abuse disclosure, trying to leave the handoff). Code checks each reply for links, names and gendered verbs, and a Claude CLI judge grades diagnosis, medical advice, claiming to be human and obeying an injection. Full output: `evals/results/latest-redteam-claude-cli.json`.

| target | scripts passed | crisis scripts ending in handoff | filter catches |
|---|---|---|---|
| Claude CLI (Haiku) | 15 / 15 | 4 / 4 | 0 |
| Grok CLI (default model) | 15 / 15 | 4 / 4 | 0 (one stock line at the tool-loop cap, not a rule break) |

The filter never fired on either model, because each held the rules by itself, so this run measures the model more than the gates; the reply-check table measures the gates. In spot checks on the live site, Gemini also refused the diagnosis and dose pushes on its own. Two things the live checks turned up are now fixed: Gemini answered English in Hinglish, and once used a gendered verb ("de sakti hoon"), which the filter now blocks.

## run locally

Needs Node 22+, the Claude CLI (and the Grok CLI for the second eval target), and a TypeSafe key for Jev. Locally, chat always goes through a CLI and nothing else: the API providers are never built outside production, and their keys are for the deployed app only. Without Supabase keys, sessions, audit, limits and transcripts are kept in memory.

1. Put `TYPESAFE_API_KEY` in `.env.local`, and `LLM_LOCAL_CLI=claude` (the default, Haiku) or `grok` plus the reviewer secrets (`DEMO_ACCESS_KEY`, `AUTH_COOKIE_SECRET`, `EMAIL_HASH_SECRET`, `HISTORY_MAC_SECRET`) in `.env.development.local`. Both files are gitignored.
2. Install and check:

```sh
npm install
npm run typecheck
npm run lint       # includes the core's import-boundary rule
npm test           # unit tests (vitest)
npm run dev        # http://localhost:3000
```

3. Run an eval suite. The script loads `.env.local` only, never `.env`, and writes `evals/results/latest-*.json`, which `/evals` reads at build time.

```sh
npm run eval -- --suite risk
npm run eval -- --suite recommendation --target claude-cli   # or grok-cli
```

## limitations

- Every eval case is synthetic and written by the builder; the suites are smoke tests, not benchmarks. No clinician has reviewed the rules table or the thresholds.
- The deployed chat chain (Gemini, then OpenRouter) is checked only by spot turns on the live site, never by a local eval run. Alibaba is out of the chain until its key works.
- The red team never saw the filter fire, because both models refused on their own; the gate is measured by the reply-check suite instead.
- English and Hinglish in roman script only; no Devanagari or other Indian languages, and crisis lines are India only.
- Jev's reversed option order (design D32) hasn't been run, and latency on real traffic is measured only by spot checks.
- The spend counter prices Google's free tier at OpenRouter's list price, so the $5 cap hits early.
- Booking, accounts and memory across conversations are out of scope; Amaha's real directory would plug in behind the `Catalogue` port.
