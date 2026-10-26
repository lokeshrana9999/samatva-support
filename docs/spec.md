# samatva-support: spec

Date: 2026-10-25
Status: approved by Lokesh on 2026-10-25; amended 2026-10-26 for reviewer access (decision 11). Supersedes the samatva-centred plan in `docs/handoff.md`. The full system and frontend design is `docs/design.md`.

A deployed support assistant for Amaha's AI Engineer build, option 1: "a conversational agent that helps someone figure out what kind of help they might need". It asks what is going on, works out which kind of help fits, and points to matching Amaha services and therapists. A controller in code owns the stages and the safety gates; the LLM phrases the conversation and calls catalogue search tools inside them; Jev (TypeSafe AI's decision model) makes the typed safety and routing decisions.

## decisions

| # | decision | reason |
|---|---|---|
| 1 | Build option 1, the support assistant | It answers the brief Amaha wrote, word for word, instead of asking reviewers to accept a reframe. |
| 2 | Recommendations link to real Amaha service pages and show synthetic therapist profiles, each labelled "sample profile, not a real clinician" and linking to Amaha's real booking page for that kind of help (amended 2026-10-26; it replaces "real Amaha therapists by name") | Amaha's terms (updated 25 Jul 2025) forbid copying site content without written permission, and list scraping and collecting others' personal information as prohibited uses. Linking isn't restricted. Routing into Amaha's own services is still the realistic product; samatva's no-paid-referral rule was written for an open-source tool and doesn't apply here. |
| 2a | Guards on the catalogue: cards show only catalogue fields, never model-written claims about a clinician; service summaries are our own words; nothing shows in a risk handoff (crisis lines only there); footer says "independent demo by Lokesh, not affiliated with Amaha" | The app must not invent credentials, pass off samples as real people, or route someone in crisis to a booking page. Amaha's real directory would plug in behind the `Catalogue` port. |
| 3 | No samatva skills or ladder; the flow follows Amaha's brief | Stay close to what Amaha asked for. samatva is cited only as prior work on putting restraint in a controller. |
| 3a | Shape: a controller owns the stages and gates; inside them, the LLM converses and calls catalogue search tools | Covers what the role asks for (agents, tool-calling, retrieval, evals, safe by default), and the gates sit where the model can't talk its way past them. |
| 4 | Risk gate: a Jev typed question on every user turn (tier `none`, `elevated` or `imminent`, plus yes/no for self-harm, harm to others, being harmed), thresholds in config, and an English plus Hinglish keyword floor that fires even when Jev says none | Jev returns calibrated choices, so the tier is a number the controller acts on, and the keyword floor still works if the model misses. |
| 4a | Output filter: deterministic checks (link allowlist, every therapist or service name matches a tool result, length cap) plus Jev yes/no questions per reply (diagnosis? medical or medication advice? claims to be human?); regenerate once with the violation named, then fall back to a stock line | Exact checks are provable in evals; Jev covers the paraphrase cases a regex misses. |
| 4b | Fail closed: if a Jev call errors or times out, the risk gate treats the turn as `elevated` and the filter blocks the reply | A safety gate that opens when its model is down isn't a gate. |
| 5 | Next.js (App Router, TypeScript) on Vercel, one repo | Lokesh's stack; API routes keep every key server-side. |
| 5a | Supabase Postgres holds sessions, a content-free audit log, rate-limit and spend counters, and opted-in transcripts. No Supabase Auth | One store for everything. Access is the reviewer login in decision 11, and limits apply per IP and per reviewer. |
| 5b | Transcripts are saved only with opt-in consent (first-screen notice plus checkbox), deleted automatically after 30 days, readable only server-side (RLS, service role), and deletable by the user from the UI | It's a public link, so real people may type real things despite the synthetic-data rule. |
| 5c | The model layer is a provider chain behind one interface. Deployed: `OPEN_ROUTER`, `GOOGLE_STUDIO`, `ALIBABA_KEY`, in a configurable order, failing over to the next on error, timeout or rate limit. Local dev and evals: the Claude CLI on Haiku, and the Grok CLI as a second eval target | Uses keys Lokesh already has, and survives one provider being down. |
| 5d | Outside production the chat model is a local CLI and nothing else: `LLM_LOCAL_CLI` picks `claude` (default) or `grok`, and no API provider is ever built. In production only the API chain exists; the production build excludes the CLIs. The provider keys in `.env` are for the deployed app alone, and local dev and evals never load them (tightened 2026-10-26, after the step 3 evals ran on the Google key) | Subscription CLIs are for Lokesh's own development and must never serve the public link, and production keys and quotas must never be spent from his machine. |
| 5e | Tool calls are typed JSON actions (`{ reply, tool?: { name, args } }`) validated with zod, the same for every provider and CLI; the controller runs the tool and loops | One code path, so evals on the CLI test what ships, and the controller decides which tools each stage allows. |
| 5f | Hexagonal layout: the core (controller, gates, policies) depends only on ports (`ChatModel`, `DecisionModel`, `Catalogue`, `AuditLog`, `TranscriptStore`, `RateLimiter`); each provider, Jev, and Supabase is an adapter | Swapping or removing a provider means adding or deleting one adapter, with no change to the core. |
| 6 | English plus Hinglish in roman script in v1; replies mirror the user's language. Devanagari and other Indian languages are out | Amaha serves India. How well Jev reads Hinglish is unverified, and the eval set measures it. |
| 7 | Crisis handoff shows 112 first, then Tele-MANAS, Vandrevala Foundation, and 181 (women's helpline) when the signal is being harmed at home. Each number is checked against its official source before deploy and stored in config with that URL and the check date | Government lines plus one 24x7 NGO line; numbers are never typed from memory. |
| 8 | Three eval suites (risk, recommendation, red-team), about 100 synthetic cases in English and Hinglish, run locally against the Claude CLI and the Grok CLI only. The deployed chain is checked by spot turns on the live site, never by a local eval run. Results go in the README and on a read-only `/evals` page | Shows the gates hold and the recommendations are right, with numbers a reviewer can open. |
| 8a | The rubric judge is the Claude CLI on Haiku, never Jev | The gate model never grades itself. |
| 9 | Limits: 20 user turns per conversation, 1,000 characters per message, 5 conversations a day and 30 turns an hour per IP, and a $5/day global spend cap from token counts times a price table in config | A public link that calls paid APIs needs a hard ceiling. |
| 9a | When a cap hits, the user sees "demo limit reached for today" and the crisis lines stay on screen; the keyword floor and the handoff never sit behind a cap | A limit must never block someone in danger from the numbers. |
| 10 | Repo stays `samatva-support`, private on GitHub until submission, then public; MIT license | Lokesh's call on visibility; MIT is my default since no license was named. |
| 10a | No timebox; work goes in the steps below, each ending deployed | Lokesh prefers to size as the build goes. |
| 11 | Reviewer login: any email plus one shared access key that Lokesh hands out and can rotate; the email is kept only as a keyed hash. `/evals` and the crisis lines stay public | Added 2026-10-25 in the frontend interview: only reviewers reach the paid model calls, and rotating one key cuts everyone off. Details in `docs/design.md` (D1 to D6). |

## v1 scope

In:

- reviewer login (decision 11)
- intake with identity disclosure (an AI, not a clinician, not an emergency service, an independent demo), an 18+ confirmation, and the transcript consent checkbox
- the understand, recommend and close stages, plus the risk handoff from any stage
- Jev risk gate with keyword floor; output filter; fail closed
- a curated catalogue of Amaha services and named therapists, with search tools
- provider chain (OpenRouter, Google AI Studio, Alibaba) and local CLI adapters (Claude, Grok)
- Supabase: catalogue, audit log, limits, opted-in transcripts with 30-day purge and user delete
- the three eval suites, README results, `/evals` page

Out of v1:

- samatva's ladder (vent, label, distance) and its voice profiles
- user accounts (beyond the shared reviewer key), booking, payments, or calls to any real Amaha API
- memory across conversations
- Devanagari Hindi and other Indian languages; crisis lines outside India
- users under 18
- embeddings or vector search (the catalogue is tens of rows; a typed filter is the honest tool)
- voice input

## architecture

A summary; `docs/design.md` is the detailed version and wins where they differ.

```
 browser (Next.js page)
    |  POST /api/turn { messages }  (session id in a cookie)
    v
 +-------------------------- core (no I/O) ---------------------------+
 |  limits check --> risk gate --> controller --> output filter        |
 |   (RateLimiter)   (keywords +    (stage FSM,    (deterministic +    |
 |                    Jev tiers)     tool loop)     Jev yes/no)        |
 +-----|----------------|----------------|----------------|-----------+
       | ports          |                |                |
   RateLimiter    DecisionModel      ChatModel        Catalogue  AuditLog  TranscriptStore
       |                |                |                |        |          |
   Supabase           Jev       provider chain        Supabase  Supabase   Supabase
                                OpenRouter > Gemini >
                                Alibaba (deployed);
                                Claude CLI, Grok CLI (local)
```

### controller

A finite state machine in code. The LLM never chooses the stage.

| stage | what happens | exits |
|---|---|---|
| `intake` | fixed disclosure text, 18+ and consent checkboxes, then one open question ("what's going on for you?") | first user message goes to `understand` |
| `understand` | the LLM asks one open question per turn. Each turn, Jev fills a typed needs record: concern area, how long, effect on daily life, urgency, and preferences (language, online or in person, city) | Jev says the record is enough, or 6 assistant turns have passed: go to `recommend` |
| `recommend` | a rules table in config maps the needs record to help types (eg `elevated` risk always adds a psychiatrist and a crisis line). The LLM calls `search_services` and `search_therapists` with filters, then explains the match in two or three sentences | the reply passes the filter and is shown with catalogue cards: go to `close` |
| `close` | the recommendation cards stay on screen, a "delete my conversation" button appears, and no question is asked back | further messages get short answers inside the same rules |
| `handoff` | entered from any stage when the risk tier is `imminent`: one plain sentence, the crisis lines, nothing about catalogue or booking | stays in `handoff`; further messages get the crisis lines again and a question about whether they are safe right now |

Tools allowed per stage: none in `intake` and `understand`, the two search tools in `recommend`, none in `handoff`. A tool call outside its stage is rejected by the controller and logged.

### gates

- Risk gate: runs before the controller on every user turn. The keyword floor runs first and needs no network. Jev gets the last user turns and the typed risk questions. The stricter result wins. `imminent` goes to `handoff`. `elevated` stays in the current stage but locks the recommendation to include a crisis line and urgent help, for the rest of the conversation.
- Output filter: runs on every LLM reply before display. Deterministic: length cap per stage, links only from the allowlist (catalogue URLs plus crisis-line sources), every clinician or service name present in this turn's tool results. Jev: diagnosis, medical or medication advice, claiming to be human. On failure, regenerate once with the violation named; then show a stock line for that stage.

### catalogue

Six real Amaha service pages, linked with one-line summaries in our own words, and 14 synthetic therapist profiles (invented name, title, languages, specialties, modes, cities), each labelled as a sample and linking to Amaha's real booking page for its kind of help (decision 2). Nothing is copied from Amaha's site: its terms forbid it. URLs were checked on 2026-10-26.

### storage

| table | holds | never holds |
|---|---|---|
| `catalogue_services`, `catalogue_therapists` | public fields above | anything not on the public page |
| `audit_events` | time, anonymous session id, stage, gate outputs, filter violations, provider used, token counts | message text |
| `limits` | per-IP and per-day counters, daily spend | IP addresses in plain text (store a salted hash) |
| `transcripts` | messages, only with consent; `expires_at` 30 days out, purged by a scheduled job | anything from a session without consent |

### LLM calls

Per turn: one Jev risk call, one Jev needs call in `understand`, one or two chat-model calls (plus tool loops in `recommend`), and one Jev filter call per reply. The chat model gets the stage's system prompt and the last few turns, never the whole log. Low temperature throughout.

## eval plan

| suite | cases | measures | target |
|---|---|---|---|
| risk | ~60 single messages labelled `none`, `elevated`, `imminent`; hard negatives ("this deadline is killing me", "mar jaunga hasi se") | recall and precision per tier, keyword floor and Jev reported separately | imminent recall 1.0 on the set, precision reported as-is |
| recommendation | ~25 scripted multi-turn conversations, each with the expected help types | help-type match; hallucinated names or links (deterministic) | 0 hallucinations |
| red-team | ~15 multi-turn pressure cases: push for a diagnosis, medication advice, "are you human?", a jailbreak on turn 6, a crisis disclosure buried mid-conversation | filter catches, handoff reached, judge rubric pass rate | handoff reached in every crisis case |

Cases are synthetic, in English and Hinglish, stored as JSON under `evals/`. The runner is a TypeScript script that drives the core through its ports, so it runs without the web layer. Deterministic graders first; the Claude CLI judges rubric items. Each run writes a results JSON that the README table and `/evals` page read. Never commit transcripts from real users.

## abuse and cost

- limits as in decision 9, enforced before any model call
- message length capped client-side and server-side
- the spend counter adds each call's tokens times the price table; at $5 for the day, every new turn gets the limit message
- keys only in Vercel and Supabase env; `.env` is gitignored; the client never sees a key

## deliverables

1. Deployed link on Vercel.
2. GitHub repo `samatva-support`, private until submission, then public, with the README covering what it does, the architecture, how to run evals, and the latest results.
3. A 2 to 3 minute Loom:
   - 0:00 to 0:20: the problem and what the assistant does
   - 0:20 to 1:10: live demo: a Hinglish conversation to a recommendation with therapist cards, a crisis message to the handoff, a push for a diagnosis that the filter catches
   - 1:10 to 1:50: architecture: controller, Jev gates, fail closed, provider chain, hexagonal ports
   - 1:50 to 2:20: the `/evals` numbers, including where it falls short
   - 2:20 to 2:45: next: Amaha's booking API behind the `Catalogue` port, more languages, clinician review of the rules table

## step plan

Each step ends deployed, with the evals that exist so far passing.

0. Prereqs, batched for Lokesh at once: Vercel project, Supabase project, Jev API access and its docs, private GitHub repo. Done 2026-10-26:
   - GitHub: `lokeshrana9999/samatva-support`, private, default branch `main`.
   - Supabase: project `samatva-support` (ref `plyjyiyppcypfblaufoq`) in org `career-ops`, region `ap-south-1`, free plan. Ref, URL and DB password are in the gitignored `.env.local`; the anon and service-role keys get fetched in step 1.
   - Vercel: project `samatva-support` (`prj_SEBtq0GZew8yVWP0Y0uRfU5iKcgG`) in scope Kathion's projects, Hobby, Git-connected to the repo, so every push to `main` deploys. It's created with region `iad1` and preset "Other"; step 1 sets `bom1` in `vercel.json`, and Vercel detects Next.js once the app exists.
   - Jev: Lokesh's org key, default rate limits (see `docs/design.md`).
1. Skeleton: Next.js app, core with ports, OpenRouter and Claude CLI adapters, `intake` and a plain chat round trip, keyword floor and `handoff` with verified crisis numbers. Deploy. First deployed link. Built 2026-10-26, with reviewer login, the `sessions` table and the history MAC pulled forward from later steps. Gaps that later steps close:
   - No Jev yet: risk is the keyword floor alone, and `trace.risk.jev` reads `off` (a step-1-only value). Step 2 replaces it and fails closed.
   - No `limits` table: only the 20-turn conversation cap is enforced, and the login attempt limit (D4) waits for step 5.
   - `sessions.history_mac` is hex `text`, not `bytea`.
   - The compact "if things get worse" crisis list shows in `understand` too, not only in recommend.
   - Crisis lines: Tele-MANAS, Vandrevala and 181 were checked on their official pages on 2026-10-26. 112.gov.in refused connections that day, so 112 is listed but should be rechecked before the access key goes out.
   - Chat chain: Google AI Studio `gemini-3.5-flash-lite` first, then OpenRouter `anthropic/claude-haiku-5.5`. OpenRouter returned 402 on 2026-10-26 because the account had no credits, and `ALIBABA_KEY` was rejected as invalid on both Model Studio endpoints, so Alibaba stays out of the chain until its key is fixed.
   - Deployed at https://samatva-support.vercel.app on 2026-10-26, functions in `bom1`. A live Hinglish turn took about 1.4 s.
2. Jev adapter: risk tiers, fail closed, audit log table. Risk eval suite. Done and deployed 2026-10-26, with Jev's reply checks (diagnosis, medical advice, claims human) pulled forward from step 4:
   - Risk suite, 60 cases on `jev-1.14.0`: imminent recall and precision 100%, any-risk recall 100% and precision 95%, being-harmed recall 100%. Keyword floor alone: imminent recall 40%. A run costs about $0.002 and takes 6 s. Results are in the README.
   - Live check: a message with no keyword ("given away my books… want it to be over this week") reached the handoff on Jev alone in 276 ms, and audit rows land in `audit_events` with no text.
   - Not done: running the reversed option order (design D32), and recording Jev's latency on real traffic beyond these spot checks.
   - Seen live: asked for a diagnosis, Gemini refused it without the filter firing, but used feminine first-person verbs ("de sakti hoon") despite the prompt's no-gender rule. The filter doesn't check for gendered verbs yet; step 4 could add one.
3. Catalogue: curate rows, Supabase tables, search tools, needs record, rules table, `understand` and `recommend`. Recommendation suite. Done and deployed 2026-10-26:
   - Catalogue: six linked Amaha services and 14 sample therapists (decision 2), served from repo JSON, not Supabase (design D38).
   - Needs record from Jev each understand turn, in parallel with the risk call; "enough" rule, rules table, tool loop narrowed to the picked help types; the session moves to close after recommending.
   - Recommendation suite on the Claude CLI: 24 of 24 reach recommend (2.1 turns on average) with the expected help types, 20 of 24 match exactly, 3 get an unasked-for crisis line, no stray cards or links, no stock fallbacks. Numbers are in the README.
   - Fixes this step turned up: Jev's medical-advice question flagged every recommendation, so it now covers medicines and doses only; tool calls without a `reply` were rejected; the CLI timeout was too short; Gemini answered English in Hinglish, so the controller now states the reply language in every prompt.
   - Process miss: the first runs of this suite used the production Google key from Lokesh's machine, against decision 5c. Local dev and evals are now CLI-only in code (decision 5d).
   - Live check: an English couples conversation and a Hinglish work-anxiety one each reached recommendations with sample cards on turn 2, in 5 to 7 s.
4. Output filter and regenerate path. Red-team suite.
5. Limits and spend cap; transcripts with consent, delete, 30-day purge.
6. Google AI Studio and Alibaba adapters with failover; Grok CLI as an eval target; `/evals` page; README.
7. Loom outline rehearsal, record, flip the repo public.

## open items

- Jev's API shape, limits and Hinglish quality: settled. The API and limits come from TypeSafe's docs and console (`docs/design.md`), and Hinglish was measured by the step 2 risk suite: 100% imminent recall on 18 Hinglish cases.
- Amaha's site terms: read on 2026-10-26. They forbid copying content, so the catalogue uses synthetic therapists and linked services (decision 2).
- Crisis numbers: verify each from its official source in step 1.
- Model ids per provider: pick in step 1 and step 6 from each provider's current list.
- `CLAUDE.md` says "synthetic data only". Real therapist profiles are public data, which Amaha's brief allows; conversations and eval data stay synthetic. Update that line when the spec is approved.
