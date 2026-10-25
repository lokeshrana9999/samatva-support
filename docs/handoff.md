# Handoff: samatva-support

Date: 2026-10-25
Status: superseded on 2026-10-25. The build no longer follows samatva's ladder; read `docs/spec.md` and `docs/design.md` instead. Kept as the starting brief for the record.

samatva-support will be a small deployed web app: a support assistant that listens first and then helps someone work out what kind of help they need. It runs the restraint design from samatva (`C:\Users\lokes\Documents\Projects\personal\samatva`) inside a real controller. It is Lokesh's build submission for Amaha's AI Engineer role.

## why this exists

Amaha (Indian mental-health company, extended Series A, March 2026) is hiring its "first AI hire" as an AI Engineer: https://www.amahahealth.com/careers/ai-engineer/ (checked 2026-10-25). The company skips résumé screening. Candidates pick one build and submit:

1. a deployed link Amaha can use,
2. the GitHub repo,
3. a 2–3 minute Loom covering what was built, the choices made, and where it goes next.

The page offers four builds: a support assistant that helps someone figure out what kind of help they might need, a Notes Copilot (session transcript to summary and follow-ups), an end-to-end automation, or the candidate's own idea. The data must be synthetic, sample or public. No deadline is stated.

The interviews after that are an architecture and trade-offs walkthrough, a live idea-to-deployment exercise, and a fit conversation about responsible AI. The role asks for LLM work (RAG, agents, tool-calling, MCP, evals), Python and/or JavaScript, and design for privacy, security, evaluation and safety. The page names no location and no pay band.

The application itself goes through a Google Form, and Lokesh submits it himself. This project only produces the three artefacts.

## why samatva is the reference

samatva is a set of agent skills for de-escalation. Its README has a section called "The honest limit": a skill is text a model reads, so a sycophantic host model can ignore every rule in it. The design it comes from puts restraint in a controller outside the model, and the skills had no controller.

A deployed app can have that controller. So the pitch is "samatva with its controller": the same ladder (listen, label, distance, close), with gates the model cannot talk its way past, plus an eval harness that shows the gates hold. Most candidates will submit a chatbot with a system prompt. This submission argues the opposite.

Note: samatva's checkout points at `samatva-staging`, and the public repo is `github.com/lokeshrana9999/samatva`.

## what to read in samatva

| Path (in the samatva checkout) | What it gives this project |
|---|---|
| `docs/architecture.md` | The design: state machine (§4.1), arousal gate (§4.2), risk gate (§4.3), output policy filter with regenerate-then-stock fallback (§4.4), LLM layer rules (§4.5), memory policy (§4.6), state prompt spec (§5), session limits (§6), metrics (§7), deployment constraints (§8), minimal first build (§10). Read it first. |
| `README.md` ("What every skill holds to") | The seven principles: listening before influence, no characterising third parties, honest identity, no retention hooks, crisis handoff, no memory writes, restraint beats voice. |
| `plugins/samatva/skills/*/SKILL.md` | Per-state behaviour to turn into state prompts: `samatva` (router and tie-break order), `vent`, `think-it-through`, `cool-down-close`. `cold-read-check` and `before-you-send` are out of scope unless the interview says otherwise. |
| `plugins/samatva/skills/_shared/` | `risk-handoff.md`, `no-memory.md`, `arousal-check.md`: the shared rules every state carries. |
| `plugins/samatva/scripts/arousal.py` | A rules-only arousal scorer, standard library only, with Hinglish absolutes and accusations. Port it or wrap it as the arousal gate. |
| `plugins/samatva/docs/sources/` | The research behind each skill, for the Loom and the architecture round. |
| `evals/samatva/` and `docs/evals.md` | Prompt-and-grader eval cases (route, vent, close, risk, Hinglish). Use them to seed the app's red-team set. |

## known constraints

- Lokesh's stack is React, TypeScript, Node and PostgreSQL, plus Python. The role accepts Python and/or JavaScript.
- samatva's deployment rules (§8) apply: adults only, identity disclosed at every session start, no analytics on message content, data stays with the user, crisis-referral rules set in config rather than inferred, no upsell.
- A public deployed link that calls a paid LLM API needs a cost cap and rate limit. The API key never reaches the client.
- Only synthetic data, including for evals and the Loom demo.
- Commits are Lokesh's own repo work. Never commit secrets or `.env`.

## questions for the spec interview

Ask one at a time, with a recommendation each, and record each answer in `docs/spec.md`.

1. **Which build.** The support assistant (recommended: samatva's ladder, then a "what kind of help" step at close), or "your own idea" framed as a de-escalation companion.
2. **The referral tension.** Amaha asks for "what kind of help they might need", while samatva §8 forbids referrals to paid services inside a session. Options: neutral help categories (someone you trust, a counsellor, a psychiatrist, a crisis line, self-care) with no provider names; or a mock Amaha-style service catalogue shown only at close, clearly labelled.
3. **Scope of states.** Vent and close only, as in architecture §10, or the full ladder (intake, vent, label, distance, close, handoff).
4. **Gates.** Arousal gate: TS port of `arousal.py`, or call it as Python. Risk gate: keywords plus a separate cheaper model call, imminent tier only or both tiers. Policy filter: which checks are deterministic and which use a model.
5. **Stack and hosting.** For example Next.js on Vercel, or React plus a Node API. Which LLM provider and model, and whether to use a second model for the gates. Whether any database is needed, given session-only memory (the audit log has no message content).
6. **Language.** Is Hinglish in roman script in v1 (samatva treats it as first-class, and Amaha serves India)?
7. **India crisis resources.** Which lines to configure. Verify each number from the official source before it ships.
8. **Evals.** How many multi-turn red-team cases, which metrics from §7 to show (sycophancy, third-party leakage, crisis recall and precision, retention hooks), and whether results show in the app or the README.
9. **Abuse and cost.** Session caps (§6), rate limits, spend cap, and what a user sees when a cap is hit.
10. **Repo and Loom.** Repo name and visibility, license, the Loom outline, and the timebox for the build.

## done for the interview session

`docs/spec.md` holds the answers above, a scope list for v1 and what is out, the architecture with the controller and gates, the eval plan, and a step plan sized so a deployed v1 can land early. Lokesh has approved it in chat. No app code has been written.
