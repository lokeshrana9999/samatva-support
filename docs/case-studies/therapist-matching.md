# Case study: matching people to sample therapist profiles

**Status: case study only. This is not part of the deployed app.** It was in the app's recommend step until 2026-11-14. Lokesh then decided to "keep therapist suggestion as case study only, not part of deployed product". The deployed app now suggests kinds of help (talking therapy, a psychiatrist, couples therapy, self-help, peer support, free counselling and referral, crisis lines), each linked to a free public resource, and never a particular therapist.

The code, data and tests live in [`case-studies/therapist-matching/`](../../case-studies/therapist-matching/):

| file | what it is |
|---|---|
| `therapists.json` | the 14 invented sample profiles, moved unchanged from `catalogue/therapists.json` apart from the note at the top |
| `matching.ts` | the matching filter and the card shape, lifted out of the JSON catalogue adapter |
| `matching.test.ts` | the matching tests, moved from `test/recommend.test.ts`; `npm test` still runs them |
| `eval-cases.json` | the eval checks that depended on therapist cards, kept as a record |

## What was built

**Data.** 14 synthetic profiles. Each one has an invented name, a title (counselling or clinical psychologist, couples therapist, psychiatrist), languages, specialties, online or in-person modes, cities, one help type (`therapist`, `psychiatrist` or `couples_therapist`) and the concern areas it covers. Together they cover the help types the rules table can pick, every named language in the needs record (English and nine Indian languages), and its four named cities. No real clinician's details were collected.

**Matching** (`matchTherapists` in `matching.ts`). This is a typed filter, not embeddings, since with 14 rows a filter is the honest search:

1. Hard filters: the help type the rules picked, the mode if one was asked for, and the city if in person was asked for.
2. Language is a soft filter. It narrows to profiles that speak the language only when at least one does, so a rare language never leaves the person with nobody.
3. Rank by how many of the person's concern areas a profile covers, then by id, so results are stable.

**In the turn.** On a recommend turn the rules table (`config/help-rules.json`) picked the help types from Jev's needs record, as it still does. The model was then offered two tools: `search_services`, which still ships, and `search_therapists`, whose arguments the core checked against the help types the rules had picked that turn. A call for any other help type was rejected and logged. The model picked up to three therapist ids and two service ids from the results. If it picked none, the controller showed its own top matches (two per help type when the rules picked more than one).

**Safety around the profiles.**

- Every card was labelled "THERAPIST · SAMPLE PROFILE", with the caption "Sample profile, not a real clinician, so they can't be booked."
- The link went to Tele-MANAS, the free government line that can connect someone with real help of that kind. It never went to a profile or a booking page. An earlier "Book through…" label read as booking the invented person, so it became "Find real help like this".
- The output filter let a reply name a clinician only if that name was on a card shown in the same turn. The prompt told the model never to say a sample was available or recommended.
- Cards were catalogue fields only, never model text.

## Why it was built

The brief asked for an agent that helps someone work out what kind of help they might need. Matching to people showed the full path, from a needs record to a filtered and ranked list, with the language and in-person preferences the understand stage collects actually doing something. It also exercised the typed tool loop: the core validated tool arguments against what the rules picked, and the filter checked names against tool results.

## Why it's not in the deployed app

The decision is Lokesh's (quoted above). The reasoning behind the change, as built:

- A named profile, even one labelled "sample", can read as a referral to someone in distress. A kind of help linked to a free public service can't.
- Without profiles, the deployed app links only to public resources. That matches samatva's no-paid-referral rule without needing a caption to explain it.
- It shrinks what the model can do. With no therapist search and no names in the catalogue, the output filter blocks every "Dr. X" outright, rather than checking names against cards.

## What changed in the app

- The `Card` type is service-only. `TherapistQuery` and `searchTherapists` are gone from the `Catalogue` port and the JSON adapter.
- The action schema accepts only `search_services`. A `search_therapists` call from a model fails to parse: the API provider gets one repair attempt, and otherwise it counts as a provider failure.
- In the turn pipeline, the recommend loop has one tool and shows up to three service cards. The name check runs with an empty list of known names.
- The prompts mention no therapist search. Every stage says never to name or suggest a specific practitioner.
- In the UI, `TherapistCard` is gone, and the intro and "About this demo" copy say the app doesn't suggest individual therapists.
- Guards: an ESLint rule stops anything under `src/` or `config/` from importing `case-studies/`. `scripts/check-bundle.mjs` runs after every build, Vercel's included, and fails the build if any of the 14 sample names, `search_therapists`/`searchTherapists`, or the sample-profile card text shows up in `.next/server` or `.next/static`.
- Unchanged: the safety gates, crisis handling, thresholds, rules table, help types and service catalogue.

## Eval cases that moved

See `case-studies/therapist-matching/eval-cases.json`.

- **`rec-flow-en-01`, the `"language": "Tamil"` check.** It required at least one shown therapist card to speak Tamil. Only the check moved: the case stays in `evals/cases/recommendation.json` as a transition case (preferences stated late, first recommend at turn 3 or later). `matching.test.ts` keeps a filter-level version of the check.
- **The "cards outside the catalogue" metric** used to accept the therapist ids `t-01` to `t-14`. It now accepts service ids only.
- **The red-team `unknown_name` check** used to let a reply name a catalogue therapist. Now no name passes.

The committed results in `evals/results/latest-recommendation-*.json` (2026-10-26) are the last runs with therapist cards. In both, the Tamil check passed and no card fell outside the catalogue. Those runs need repeating against the current app, which needs `TYPESAFE_API_KEY` and the Claude or Grok CLI. Until then, `/evals` and the README say the recommendation numbers predate this change.

## Running it

```
npx vitest run case-studies
```

The tests import `allowlisted` from the app's catalogue adapter, so the case study still checks its links against the same allowlist. Imports go only from the case study into the app, never the other way.

## Bringing it back

It would need a real, consented directory behind the `Catalogue` port, with verified clinicians and their own words, not invented samples. It would also need a clinician to review the matching rules and the decision to show named people at all. The code here shows the shape: a typed filter, core-validated tool arguments, and names checked against what's on screen.
