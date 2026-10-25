# samatva-support: architecture

Date: 2026-10-25
Status: approved by Lokesh on 2026-10-25, including reviewer access and the `/api/turn` contract added the same day. `docs/spec.md` is the source of truth; this doc fills in what the spec leaves open. The one override is reviewer access, which replaces spec 5a's "the demo is open" (Lokesh, frontend-spec interview, 2026-10-25).

A pure TypeScript core runs one turn as a fixed pipeline (keyword floor, limits, Jev risk gate, stage controller, output filter) and touches the world only through seven ports; Next.js routes, Supabase, Jev and the model providers are adapters you can swap without editing the core.

## the shape

```
   +---------------- src/app: Next.js shell --------------------+
   | page.tsx  /api/login  /api/turn (SSE)  /api/conversation   |
   | requireReviewer() on every API route except /api/login     |
   +-------------------------------|----------------------------+
                                   | src/composition wires
                                   v adapters into ports
   +---------------- src/core: no I/O -------------------------+
   | keyword floor > limits > risk gate > controller > filter  |
   |                                     (stage FSM, rules,    |
   |                                      tool loop)           |
   +----|---------|--------|--------|--------|-------|------|--+
        |         |        |        |        |       |      |
     Session    Rate    Decision  Chat   Catalogue Audit Transcript
     Store      Limiter Model     Model            Log   Store
        |         |        |        |        |       |      |
     Supabase  Supabase   Jev    chain    Supabase Supa- Supabase
                                 OR >              base
                                 Google >
                                 Alibaba
                                 (CLIs: local only)
```

The core imports only `zod` and its own files. An ESLint `no-restricted-imports` rule on `src/core/**` bans `next`, `@supabase/*`, `node:child_process` and `src/adapters/**`, so the boundary is checked on every commit rather than kept by habit.

The spec lists six ports. Q1 of the interview (session state on the server) adds a seventh, `SessionStore`.

## reviewer access

Only reviewers holding the shared access key can chat. Lokesh can cut everyone off by rotating one env var. Access is a shell concern: the core never sees an email or a key, only a reviewer hash it passes to limits and audit.

```
 login screen (crisis lines + footer, no auth)
   | POST /api/login { email, accessKey }
   v
 limit: 10 attempts / 15 min per IP hash --over--> 429
   | ok
 timingSafeEqual(HMAC(k, accessKey), HMAC(k, DEMO_ACCESS_KEY))
   |--no--> 401, same body and timing as any failure
   | yes
 reviewerHash = HMAC(EMAIL_HASH_SECRET, lower(trim(email)))
 set cookie ss_auth = payload.signature  (7 days)
   v
 intake --> POST /api/turn, DELETE /api/conversation
            each calls requireReviewer() first --none/bad--> 401
```

1. `POST /api/login` takes `{ email, accessKey }` (zod: an email shape, at most 254 chars; key at most 200 chars). Any email is accepted.
2. The attempt counts against `login:<iphash>` in `limits` before the key is checked, success or not, so the key can't be brute-forced from one IP. Over 10 in 15 minutes returns 429.
3. The key comparison HMACs both sides with a per-process random key, then uses `crypto.timingSafeEqual`. Hashing first makes the inputs equal length, so neither the key's value nor its length leaks through timing.
4. On success the route sets `ss_auth`: `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` 7 days. The value is `base64url(payload) + "." + base64url(HMAC-SHA256(signingKey, payload))`, with `payload = { rh: reviewerHash, exp }`.
5. `signingKey = HMAC(AUTH_COOKIE_SECRET, DEMO_ACCESS_KEY)`. Rotating `DEMO_ACCESS_KEY` changes the signing key, so every existing cookie fails its signature check at once, with no session list to clear.
6. `requireReviewer(req)` in `src/app/lib/reviewer.ts` checks the signature (constant time) and `exp`, and returns the reviewer hash or a 401. Every protected route calls it as its first line. It's an explicit call rather than Next middleware, so it runs in the Node runtime with the routes and has unit tests.

`/evals` stays public: it's read-only and calls no model. The login screen shows the crisis lines and footer without auth, so 9a still holds for anyone who reaches the link. There's no logout endpoint in v1; the cookie expires after 7 days, or on rotation.

The email is personal data, so it's never stored, logged, shown or emailed. Only `reviewerHash` is kept: an HMAC with the server secret `EMAIL_HASH_SECRET`, the same keyed-salt approach as the IP hash, so the hash can't be reversed with a list of guessed emails without the secret. Unlike the IP hash, it doesn't fold in the date. Per-reviewer limits and the audit log need one reviewer to look the same across days, and the email was given knowingly for exactly that, unlike an IP.

## one turn, end to end

```
browser   /api/turn         core.runTurn              ports
  |  POST    |                   |                       |
  |--------->| zod body, cookie, |                       |
  |          | ip hash           |                       |
  |          |------------------>| keyword floor (pure)  |
  |          |                   |--load + MAC check---->| SessionStore
  |          |                   |--startTurn----------->| RateLimiter
  |          |                   |   (these two parallel)|
  |          |                   |--assessRisk---------->| DecisionModel
  |          |                   |--extractNeeds-------->| (parallel,
  |          |                   |                       |  understand)
  |          |                   | tier = max(floor, Jev,|
  |          |                   |   sticky); imminent:  |
  |          |                   |   handoff text, stop  |
  |          |                   | controller: stage,    |
  |          |                   |   prompt, help types  |
  |          |                   |--complete------------>| ChatModel
  |          |                   |--search_*------------>| Catalogue
  |          |                   |   (loop, max 3 calls) |
  |          |                   | filter: exact checks  |
  |          |                   |--checkReply---------->| DecisionModel
  |          |                   |--save (version)------>| SessionStore
  |<-status--|<-- emit(phase) ---| (reading, thinking,    |
  |          |                   |  searching, checking, |
  |          |                   |  failover)            |
  |          |<-- final, effects |                       |
  |<-final---| SSE, then close   |                       |
  |          | after(): audit, transcript, spend         |
```

1. The route calls `requireReviewer()` (401 without a valid `ss_auth`), parses the body with zod (at most 40 messages, user text at most 1,000 characters), and computes the IP hash. If the body has `start`, it creates a new session (counting a conversation against the limits) and sets `ss_sid`; otherwise it reads the session id from `ss_sid`.
2. The keyword floor runs first because it needs no network. If it returns `imminent`, the turn goes to `handoff` even when every later step fails or a cap is hit (spec 9a).
3. The session row loads and the limit check runs in parallel. The route verifies the client's message history against the stored HMAC chain; a mismatch returns 409 and the client starts over.
4. If a cap is hit, the reply is "demo limit reached for today" with the crisis lines, and no model is called.
5. Jev's risk call runs; in `understand`, Jev's needs call runs beside it. The chat model waits for the risk result because the tier changes the prompt and the stage.
6. The controller picks the stage, builds the prompt, and runs the chat model and tool loop. The output filter checks the reply; on a violation it regenerates once, then falls back to a stock line.
7. The session row saves with an optimistic version check before the response, so the next turn sees it. Audit, transcript and spend writes run after the response in Next's `after()`, so they add no user-facing latency.

### the /api/turn contract

The response streams progress, not tokens: zero or more `status` events, then one `final` event. The filter has to pass the whole reply before any of it is shown, so the reply arrives only in `final` (contract from the frontend spec, approved by Lokesh 2026-10-25).

```
POST /api/turn
cookies: ss_auth (always), ss_sid (after the first turn)
body: { start?: { adult: true; consent: boolean },
        messages: { role: 'user' | 'assistant'; text: string }[] }

200 text/event-stream
event: status  data: {"phase":"reading"}
event: status  data: {"phase":"thinking"}
event: final   data: { ...Final }
```

The browser keeps the conversation in `sessionStorage` and sends it every turn. It sends `start` when its history is empty; `start` always opens a new session and replaces any old `ss_sid`, so a new tab never collides with an old conversation. The session id itself never reaches page scripts (A3).

| phase | emitted when |
|---|---|
| `reading` | the risk gate (and needs call) starts |
| `thinking` | a chat call starts |
| `searching` | the controller runs a catalogue tool |
| `checking` | the output filter starts |
| `failover` | the chain moves to the next provider |

```ts
type Final = {
  reply: string;
  stage: Stage;
  turnsUsed: number;
  turnsLimit: number;
  replaced: null | { reason: 'diagnosis' | 'medical' | 'claims_human'
                     | 'link' | 'name' | 'length' | 'error' };
  helpTypes: string[];        // labels from the rules table
  cards: Card[];
  crisisLines: CrisisLine[];  // always; 181 only if beingHarmed
  limit: null | { kind: 'conversation_turns' | 'daily_conversations'
                  | 'hourly_turns' | 'spend' };
  trace: Trace;
};

type Card = {                 // catalogue fields only (spec 2a)
  id: string; kind: 'therapist' | 'service';
  name: string; title: string; languages: string[];
  specialties: string[]; modes: string[]; cities: string[];
  profileUrl: string; sourceUrl: string; copiedAt: string;
};

type CrisisLine = {           // from config/crisis-lines.json
  id: string; label: string; number: string; telHref: string;
  note: string; sourceUrl: string; checkedAt: string;
};

type Trace = {                // content-free: no text, no needs values
  stageIn: Stage; stageOut: Stage;
  risk: {
    keyword: Tier | null;
    jev: { tier: Tier; score: number } | 'error';
    final: Tier;
  };
  checks: { name: string; pass: boolean }[];
  regenerated: boolean;
  provider: string | null;
  providersTried: string[];
  latencyMs: number;
};
```

`replaced.reason = 'error'` covers every stock line not caused by a filter check: a Jev error that blocks the reply (4b), all providers failing, the tool-loop cap, or the turn deadline. `trace.risk.jev.score` is `p(elevated) + p(imminent)`, the risk mass the tier threshold reads. `trace` mirrors the audit event, so it shows the reviewer nothing the audit log doesn't already hold.

A hit cap is not an error: the route returns 200 and a `final` with `limit` set, the limit message as `reply`, and the crisis lines. Errors before the stream starts return JSON `{ error, crisisLines }`:

| status | `error` | UI does |
|---|---|---|
| 400 | `bad_request` | error state |
| 401 | `login_required` | back to the login screen |
| 409 | `history_mismatch` or `stale_session` | starts a new conversation |
| 503 | `unavailable` (Supabase down) | error state; crisis lines stay |

A failure after the first event ends the stream with a `final` holding the stage's stock line and `replaced.reason = 'error'`. A dropped stream is the UI's error state. The keyword floor's `imminent` handoff still returns 200 with a `final` even when Supabase is down, because it needs no stored state.

`DELETE /api/conversation` deletes the transcript rows (if consent was given) and the session row, clears `ss_sid`, and returns 204 either way. The crisis-line list is baked into the page at build from `config/crisis-lines.json`, so the login and intake screens need no request.

### latency budget

Guesses until step 1 measures them on the deployed chain. The Jev rows lean on TypeSafe's published timing (see the Jev adapter section).

| step | p50 target | timeout |
|---|---|---|
| parse, cookie, IP hash, keyword floor | 5 ms | none |
| session load and limit check, parallel | 60 ms | 2 s |
| Jev risk, plus needs in `understand`, parallel | 400 ms | 4 s (1.5 s per attempt, 1 retry) |
| chat call (`understand`, `close`) | 1.5 s | 8 s per provider |
| tool loop (`recommend`: up to 3 chat calls, 2 searches) | 4.5 s | 8 s per call |
| filter: exact checks, then Jev `checkReply` | 400 ms | 3 s |
| session save | 30 ms | 2 s |

Targets: about 3 s per turn in `understand`, about 6 s in `recommend`. One `AbortController` carries a 25 s deadline through every port call; each provider gets `min(8 s, time left)`. When the deadline passes, the turn returns the stage's stock line. Vercel `maxDuration` is 30 s.

## the controller

```
 intake --first msg--> understand --enough, or 6 turns--> recommend
                         |    ^                              |
                         '----' each turn: Jev fills         | reply
                                the needs record             v passes
                                                           close
 any stage --tier imminent--> handoff (stays there)
```

The stage lives in the `sessions` row and only code moves it. The model never sees a "change stage" option.

| stage | model calls | tools | reply length cap |
|---|---|---|---|
| `intake` | none: fixed text and checkboxes | none | fixed |
| `understand` | Jev risk, Jev needs, chat, Jev check | none | 400 chars |
| `recommend` | Jev risk, chat loop, Jev check | `search_therapists`, `search_services` | 700 chars |
| `close` | Jev risk, chat, Jev check | none | 300 chars |
| `handoff` | none: fixed text from config | none | fixed |

`handoff` runs no model at all. Its text and crisis lines come from config in English and Hinglish, picked by a small marker-word check on the last user message (default English). A crisis path with zero network calls can't fail on a provider outage.

`elevated` is sticky. Once any turn reaches it, `sessions.risk_floor` holds `elevated` for the rest of the conversation, and the rules table adds `crisis_line` and `psychiatrist` to the recommendation.

### the needs record

Jev fills it from all user turns so far (at most 6 in `understand`) and the controller replaces the stored record each turn. Every field is an enum plus a probability, so the record stores no free text and needs no content rules of its own.

```ts
const ConcernArea = z.enum([
  'stress_anxiety', 'low_mood', 'relationships', 'family',
  'work_study', 'sleep', 'grief_loss', 'trauma', 'substance_use',
  'eating_body', 'identity_sexuality', 'anger', 'other',
]);
const Field = <T extends z.ZodTypeAny>(v: T) => z.object({
  value: z.union([v, z.literal('unknown')]),
  p: z.number(),
});
const Concern = z.object({ area: ConcernArea, p: z.number() });

export const NeedsRecord = z.object({
  concerns: z.array(Concern).max(2),
  duration: Field(z.enum([
    'under_2_weeks', '2_weeks_to_3_months', 'over_3_months'])),
  impact:   Field(z.enum(['little', 'some', 'severe'])), // daily life
  urgency:  Field(z.enum(['can_wait', 'soon', 'now'])),
  forWhom:  Field(z.enum(['self', 'with_partner'])),
  prefs: z.object({
    language: Field(Language),     // session language, eg 'hindi'
    mode:     Field(z.enum(['online', 'in_person', 'either'])),
    city:     Field(City),         // catalogue cities + 'other'
  }),
});
```

"Enough" is a rule in code over Jev's probabilities, not a question to Jev: at least one concern with `p >= 0.6`, and `duration` and `impact` known with `p >= 0.6` (thresholds in `config/thresholds.json`). The spec's "Jev says the record is enough" is met by Jev's calibrated fields; the controller decides what to do with them.

### the rules table

`config/help-rules.json` maps the needs record and risk tier to help types. Every rule whose `when` matches adds its help types (fields AND, values inside a field OR); the union is capped at 3, with `crisis_line` first when present. The values below are examples for the shape, not clinical advice; the real table needs clinician review (spec, Loom close).

```json
[
  { "id": "elevated-risk", "when": { "risk": ["elevated"] },
    "add": ["crisis_line", "psychiatrist"] },
  { "id": "severe-long",
    "when": { "impact": ["severe"], "duration": ["over_3_months"] },
    "add": ["psychiatrist", "therapist"] },
  { "id": "sleep-substance",
    "when": { "concerns": ["sleep", "substance_use"] },
    "add": ["psychiatrist"] },
  { "id": "couples", "when": { "forWhom": ["with_partner"] },
    "add": ["couples_therapist"] },
  { "id": "mild-recent", "when": { "impact": ["little"],
    "duration": ["under_2_weeks"] }, "add": ["self_care"] },
  { "id": "default", "when": {}, "add": ["therapist"] }
]
```

`HelpType` is `self_care | therapist | psychiatrist | couples_therapist | crisis_line`. The rules' output narrows the tool arguments for that turn: the controller builds the `helpType` enum of `search_therapists` from it, so the model can't search for help the rules didn't pick. `crisis_line` is never a search; the controller adds the crisis-line card from config.

## typed actions and the tool loop

Every provider and CLI returns the same JSON action (spec 5e), plus `show` from Q4.

```ts
const SearchTherapists = z.object({
  helpType: z.enum(['therapist', 'psychiatrist', 'couples_therapist']),
  concerns: z.array(ConcernArea).max(2),
  language: Language.optional(),
  mode: z.enum(['online', 'in_person']).optional(),
  city: City.optional(),
  limit: z.number().int().min(1).max(5).default(3),
}).strict();

const SearchServices = z.object({
  helpTypes: z.array(HelpType).min(1).max(3),
  mode: z.enum(['online', 'in_person']).optional(),
}).strict();

const ToolCall = z.discriminatedUnion('name', [
  z.object({ name: z.literal('search_therapists'),
             args: SearchTherapists }),
  z.object({ name: z.literal('search_services'),
             args: SearchServices }),
]);

export const Action = z.object({
  reply: z.string().max(1200),
  tool: ToolCall.optional(),
  show: z.array(z.string()).max(5).optional(),  // catalogue ids
}).strict();
```

1. The controller sends the stage prompt, the typed needs summary, the allowed help types, and the last 6 messages. Never the whole log.
2. If the text fails JSON parse or zod, the adapter makes one repair call on the same provider with the zod error; a second failure fails over (see failover).
3. If `tool` is set and the stage allows it, the controller runs it through `Catalogue`, appends the result as a `tool` message, and calls the model again. `reply` is ignored on tool turns.
4. If `tool` is set in a stage without tools, the controller drops it, logs `tool_rejected` to the audit event, and uses `reply`.
5. The loop stops at 3 chat calls. If the model still asks for a tool, the turn takes the stock line plus the controller's own top results.
6. `show` is valid only in `recommend`; every id must come from this turn's tool results. At most 3 therapists and 2 services render as cards.

## the gates

### risk gate

```
 keyword floor --tier or none--+
 Jev assessRisk --tier, p, y/n-+--> max(...) --> none | elevated
 sticky sessions.risk_floor ---+                  | imminent -> handoff
 Jev error or timeout = elevated (4b)
```

Each pattern in `config/risk-keywords.json` carries its own tier (Q3): explicit intent or plan phrases are `imminent`, softer ones `elevated`. An exclusion list ("deadline is killing me", "mar jaunga hasi se") runs first. The audit event stores the pattern id, never the matched text.

The controller applies thresholds to the tier Choice's `probabilities` rather than taking its `choice`: `imminent` when `p(imminent) >= 0.30`, `elevated` when `p(elevated) + p(imminent) >= 0.25`. Low thresholds trade precision for recall, and the risk suite tunes them. A Noul at `p >= 0.3` on self-harm or harm to others raises the tier to at least `elevated`; the same on being harmed adds 181 to the crisis lines.

### output filter

Runs in this order, cheapest first, on every model reply:

1. Length cap for the stage.
2. Links: every URL or bare domain in the reply must be in the allowlist (catalogue URLs plus crisis-line sources).
3. Names: any catalogue name in the reply must be in this turn's tool results and in `show`; an honorific pattern ("Dr. X", "Ms. X") with an unknown name is a violation. Known limit: an invented name with no honorific passes this check; the red-team suite measures how often.
4. Jev `checkReply`: diagnosis, medical or medication advice, claims to be human. A violation is `p(yes) >= 0.3`. A Jev error blocks the reply (4b).

On any violation the controller regenerates once with the violation named in the prompt, filters again, then shows the stage's stock line from `config/stock-lines.json`.

## ports

```ts
// src/core/ports.ts
export type Stage =
  'intake' | 'understand' | 'recommend' | 'close' | 'handoff';
export type Tier = 'none' | 'elevated' | 'imminent';
export type YesNo = { yes: boolean; p: number };
export type Usage =
  { inputTokens: number; outputTokens: number; usd: number };
export type ChatMsg =
  { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

// throws ChatError when every provider fails
export interface ChatModel {
  complete(req: {
    messages: ChatMsg[];
    temperature: number;     // 0.3 everywhere
    maxTokens: number;
    signal: AbortSignal;     // carries the turn deadline
  }): Promise<{
    action: Action; provider: string; model: string; usage: Usage;
    providersTried: string[];  // for the trace and audit event
  }>;
}

// throws DecisionError; the core fails closed
export interface DecisionModel {
  assessRisk(userTurns: string[], signal: AbortSignal): Promise<{
    tier: Tier; p: Record<Tier, number>;
    selfHarm: YesNo; harmToOthers: YesNo; beingHarmed: YesNo;
    usage: Usage;
  }>;
  extractNeeds(userTurns: string[], signal: AbortSignal):
    Promise<{ needs: NeedsRecord; usage: Usage }>;
  checkReply(reply: string, stage: Stage, signal: AbortSignal):
    Promise<{
      diagnosis: YesNo; medicalAdvice: YesNo; claimsHuman: YesNo;
      usage: Usage;
    }>;
}

export interface Catalogue {
  searchTherapists(q: SearchTherapists): Promise<TherapistCard[]>;
  searchServices(q: SearchServices): Promise<ServiceCard[]>;
  allowedUrls(): Promise<ReadonlySet<string>>;
}

export interface SessionStore {
  create(init: { adult: true; consent: boolean }):
    Promise<SessionState>;
  load(id: string): Promise<SessionState | null>;
  save(s: SessionState): Promise<'ok' | 'conflict'>; // s.version
  delete(id: string): Promise<void>;
}

export interface RateLimiter {
  startConversation(who: Who): Promise<LimitResult>;
  startTurn(who: Who): Promise<LimitResult>; // + spend check
  addSpend(usd: number): Promise<void>;
}
export type Who = { ipHash: string; reviewerHash: string };
export type LimitResult =
  | { ok: true }
  | { ok: false; reason: 'conversations' | 'turns' | 'spend' };

export interface AuditLog { record(e: TurnAudit): Promise<void> }

export type Msg =
  { seq: number; role: 'user' | 'assistant'; text: string };

export interface TranscriptStore {
  append(sessionId: string, msgs: Msg[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

`DecisionModel` speaks the domain (risk, needs, reply check), not Jev's wire format, so the core never learns Jev's API and the Jev adapter is the only file tied to TypeSafe's API. Per Q2 there is no stand-in model adapter in any environment: Jev-dependent steps wait for Jev access, and unit tests use scripted fakes that return fixed answers, not a model.

The core entry point:

```ts
export type Phase =
  'reading' | 'thinking' | 'searching' | 'checking' | 'failover';

export async function runTurn(
  deps: Ports & {
    config: Config; now: Date;
    emit: (phase: Phase) => void;  // the route writes SSE status
  },
  input: { session: SessionState; who: Who; messages: Msg[] },
): Promise<{
  final: Final;
  effects: {
    audit: TurnAudit; transcript: Msg[] | null; spendUsd: number;
  };
}>
```

Writes that can wait come back as `effects` and the route flushes them in `after()`. The eval runner reads the same `effects` to grade a turn, so production and evals see one shape.

## the Jev adapter

Every Jev fact here comes from TypeSafe's public docs at `docs.typesafe.ai`, read on 2026-10-25, cited per row. Only `src/adapters/decision/jev.ts` depends on them.

Jev has one endpoint, `POST https://api.typesafe.ai/v1/systemone`, with a Bearer key. A request carries `model`, `state` (a string, object or array: the content every question refers to) and named `questions`. The response returns `answers` under the same names, the `model` that answered, and `usage` ([System One API](https://docs.typesafe.ai/api/system-one)).

```
POST https://api.typesafe.ai/v1/systemone
{ "model": "jev-1.14.0",
  "state": { "user_turns": ["...", "...", "..."] },
  "questions": {
    "tier": { "type": "choice",
      "instructions": "What risk of suicide or self-harm do
                       `user_turns` show?",
      "criteria": { "imminent": "...", "elevated": "...",
                    "none": "..." } },
    "self_harm": { "type": "noul",
      "instructions": "Does the sender say they may harm
                       themselves?",
      "criteria": { "true": "...", "false": "..." } } } }

-> { "model": "jev-1.14.0",
     "answers": {
       "tier": { "type": "choice", "choice": "none",
         "confidence": 0.9,
         "probabilities": { "imminent": 0.01, "elevated": 0.06,
                            "none": 0.93 } },
       "self_harm": { "type": "noul", "noul": 0.04 } },
     "usage": { "input_tokens": 180, "output_tokens": 8 } }
```

The instruction strings are wrapped here for width; the criteria text is written in step 2. A Choice returns the chosen option, a probability per option and a confidence. A Noul returns only the probability of yes, with no separate confidence. Any mix of questions in one request is evaluated in parallel and in isolation against the same state ([Primitives](https://docs.typesafe.ai/primitives), [Introduction](https://docs.typesafe.ai/introduction)).

| port method | one request; its `state` | its questions |
|---|---|---|
| `assessRisk` | last 3 user turns | Choice `tier` (imminent, elevated, none); a Noul each for self-harm, harm to others, being harmed |
| `extractNeeds` | all user turns so far (at most 6) | a Noul per concern area (13); a Choice each for duration, impact, urgency, for whom, language, mode, city, each with a `not_stated` option |
| `checkReply` | the reply and its stage | a Noul each for diagnosis, medical or medication advice, claims to be human |

Why these shapes:

- Concerns are one Noul each because a Choice picks exactly one option and a person can have two concerns. The docs advise one question per candidate, combined in code ([Jaggedness: counting](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). Code keeps the top 2 with `p >= 0.6`.
- Ordered fields use a Choice with `not_stated` rather than a Score, because the docs recommend an explicit "not stated" option so a missing value is reported rather than guessed ([Jaggedness: date and time](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). `not_stated` maps to `unknown` in the needs record.
- `imminent` is listed first in the tier Choice. Jev 1.13 leans toward the first option ([Jaggedness: option order](https://docs.typesafe.ai/model-jaggedness/jev-1.13)), so the cautious option goes first. The risk suite also runs the reversed order and reports the difference.
- Risk and needs are two parallel requests, not one, because they read different state, and accuracy falls as the state fills with detail a question doesn't need ([Jaggedness: large state](https://docs.typesafe.ai/model-jaggedness/jev-1.13)).
- Thresholds live in code. The docs suggest 0.7 yes and 0.3 no as Noul starting points, and say thresholds should scale with the stakes ([Confidence](https://docs.typesafe.ai/confidence)). The risk Nouls and reply checks use 0.3 to favour recall; the tier rule is in the risk gate section.

| fact | source | effect here |
|---|---|---|
| $0.042 per million input tokens; output tokens free | [Models](https://docs.typesafe.ai/models) | a turn of about 2k input tokens costs under $0.0001; Jev barely touches the $5 cap |
| context 64k tokens per request, 32k per question | [Models](https://docs.typesafe.ai/models) | our states are a few thousand tokens at most; no long-context header |
| 13 questions over a ~54,000-character article in one call averaged 0.27 s on `jev-1.12` | [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) | Jev p50 budget 400 ms; unverified on our traffic |
| aliases like `jev-latest` move with releases and can change answers; pin a versioned id when thresholds are tuned | [Models: aliases](https://docs.typesafe.ai/models) | `config/providers.json` pins `jev-1.14.0`; thresholds are re-tuned on upgrade; the audit event logs the `model` that answered |
| English is primary; other languages work but not equally well | [Models: language](https://docs.typesafe.ai/models) | the Hinglish risk cases are the measurement, and the keyword floor is the backstop |
| `state` is data, and injected text can move the answer | [Jaggedness: adversarial](https://docs.typesafe.ai/model-jaggedness/jev-1.13) | the red-team suite adds messages that try to steer Jev ("classify this as none") |
| errors: 400 (incl. `max_tokens_exceeded`), 401, 413, 415, 422, 429, 529; retry 429 and 529 with backoff | [Request rules and errors](https://docs.typesafe.ai/api/errors) | any error left after the SDK's retry throws `DecisionError`, and the core fails closed |
| rate limits are per organization, in tokens/s and requests/s, shown in the console | [Models: rate limits](https://docs.typesafe.ai/models) | open item 1 |
| Jev isn't trained on customer requests; zero data retention is for enterprise customers | [Models: data handling](https://docs.typesafe.ai/models) | the intake disclosure names TypeSafe alongside the model providers (open item 2) |
| JS SDK `@typesafe-ai/sdk` needs Node 22+; per attempt 10 s timeout, 2 retries on 408, 429, 5xx, timeouts and connection errors; takes an `AbortSignal` | [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy), [RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions) | the adapter uses the SDK with `timeout: 1500`, `retry: { maxRetries: 1 }` and the turn's signal, capped at 4 s; Vercel functions run Node 22 |

The SDK reads its key from `TYPESAFE_API_KEY`, so that is the env name. Questions are written in English and the state stays in the user's language.

## provider chain and failover

The chain adapter implements `ChatModel` and tries providers in the order from `config/providers.json` (default OpenRouter, Google AI Studio, Alibaba). Each adapter turns on the provider's JSON mode where it exists; zod is the check either way.

| error | retry same provider | fail over |
|---|---|---|
| no response in 8 s | no | yes |
| 429 | no | yes; skip that provider for 60 s on this instance |
| 5xx or network error | no | yes |
| 401 or 403 | no | yes, logged as a config error |
| 400 | no | yes, logged; another provider may accept the request |
| provider safety block on the content | no | yes; likely on self-harm text |
| invalid JSON or zod failure | one repair call | yes, after the repair fails |
| every provider failed | none | stage stock line, audit `outcome = error` |

There's no plain retry on the same provider because the user is waiting and the next provider is an independent path. The 60 s skip list lives in instance memory, so it isn't shared across Vercel instances; that's acceptable for a demo and stated as such.

The CLI adapters (`src/adapters/chat/cli/`) are imported only by `src/composition/local.ts`, which loads only when `NODE_ENV !== 'production'` and `LLM_LOCAL_CLI=1` (spec 5d). The production build aliases that folder to a stub that throws, and a CI check fails if the server bundle contains the CLI spawn code.

## data model

All tables live in Supabase Postgres, region `ap-south-1` (Mumbai), with Vercel functions pinned to `bom1` next to it. Status columns are `text` with `check` constraints rather than Postgres enums, so adding a value is a one-line migration.

### sessions (from Q1)

```sql
create table sessions (
  id                 uuid primary key,     -- random; the cookie
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  stage              text not null check (stage in ('intake',
                     'understand','recommend','close','handoff')),
  risk_floor         text not null default 'none'
                     check (risk_floor in ('none','elevated')),
  user_turns         int  not null default 0,  -- cap 20
  understand_turns   int  not null default 0,  -- cap 6
  needs              jsonb not null default '{}', -- enum-only
  history_mac        bytea,                -- HMAC chain, no text
  being_harmed       boolean not null default false, -- sticky; adds 181
  transcript_consent boolean not null,
  version            int  not null default 0   -- optimistic lock
);
create index on sessions (last_seen_at);
```

Messages stay in the browser unless the user consented. Each turn the server checks them against `history_mac`, where `mac_n = HMAC(HISTORY_MAC_SECRET, mac_n-1 || role || text)`. That stops a client from forging earlier assistant turns or replaying an old state to undo the `elevated` lock. The row holds no IP hash, so it can't be joined to the limits table, and it's purged 24 hours after `last_seen_at`.

The session id is created by the first `POST /api/turn` (the one carrying `start` with the 18+ and consent answers) and set as an `httpOnly`, `Secure`, `SameSite=Lax` cookie `ss_sid`. Stage, turn count, the `elevated` lock, `being_harmed` and `handoff` all live in this row, never in what the client sends, so editing `sessionStorage` can't clear a handoff. It moves out of the request body from the spec's sketch because it's the bearer secret for "delete my conversation", and page scripts shouldn't read it.

### audit_events

```sql
create table audit_events (
  id                bigint generated always as identity primary key,
  at                timestamptz not null default now(),
  session_id        uuid not null,             -- no FK: survives purges
  reviewer_hash     text not null,             -- HMAC of the email
  turn              int  not null,
  stage_in          text not null,
  stage_out         text not null,
  risk_keyword      text,               -- floor's tier, or null
  keyword_pattern   text,               -- pattern id, never text
  risk_jev          text,               -- tier, or 'error'
  risk_jev_p        jsonb,              -- p per tier
  risk_final        text not null,
  filter_violations text[] not null default '{}',
  regenerated       boolean not null default false,
  stock_fallback    boolean not null default false,
  tools             text[] not null default '{}', -- names only
  tool_rejected     boolean not null default false,
  provider          text,
  model             text,
  tokens_in         int,
  tokens_out        int,
  cost_usd          numeric(10,6),
  latency_ms        int,
  outcome           text not null
                    check (outcome in ('ok','handoff','limit','error'))
);
create index on audit_events (at);
create index on audit_events (session_id);
create index on audit_events (reviewer_hash, at);
```

No column can hold message text: every field is an enum, a number, an id or a name from a fixed list. Kept 90 days.

### limits

```sql
create table limits (
  bucket       text not null,        -- see the bucket table below
  window_start timestamptz not null, -- start of the bucket's window
  amount       numeric not null default 0,
  primary key (bucket, window_start)
);

create function consume_limit(p_bucket text, p_window timestamptz,
                              p_add numeric, p_cap numeric)
returns boolean language sql as $$
  insert into limits as l (bucket, window_start, amount)
  values (p_bucket, p_window, p_add)
  on conflict (bucket, window_start)
  do update set amount = l.amount + p_add
  where l.amount + p_add <= p_cap
  returning true;
$$;  -- null result = cap hit
```

| bucket | window | cap | checked by |
|---|---|---|---|
| `login:<iphash>` | 15 minutes | 10 attempts | `/api/login`, before the key check |
| `conv:ip:<iphash>`, `conv:r:<reviewerhash>` | IST day | 5 conversations each | `startConversation` |
| `turn:ip:<iphash>`, `turn:r:<reviewerhash>` | hour | 30 turns each | `startTurn` |
| `spend:global` | IST day | $5 | `startTurn`, `addSpend` |

Each turn and conversation counts against both the IP and the reviewer, so neither sharing one key across many IPs nor many reviewers behind one office IP gets past the caps.

One upsert both checks and increments, so two concurrent turns can't both slip under a cap. Spend is checked at turn start (`p_add = 0`, cap $5) and added after each turn, so the day can overshoot by the cost of the turns in flight, a few cents at most.

The IP hash is `HMAC-SHA256(IP_HASH_SECRET, ip || ':' || ist_date)`. Folding in the date rotates it daily by construction: today's hash can't be linked to yesterday's, and no plain IP is ever stored. The day boundary is IST midnight because the users are in India. Rows older than 2 days are purged.

### transcripts

```sql
create table transcripts (
  session_id uuid not null,
  seq        int  not null,
  role       text not null check (role in ('user','assistant')),
  text       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (session_id, seq)
);
create index on transcripts (expires_at);
```

Writes go through an `append_transcript` function that inserts only when `sessions.transcript_consent` is true for that id, so consent is enforced in the database as well as in the core. "Delete my conversation" (`DELETE /api/conversation`) removes the transcript rows and the session row, clears `ss_sid`, and returns 204 whether or not anything was stored.

### catalogue

```sql
create table catalogue_therapists (
  id            text primary key,     -- slug
  name          text not null,        -- shown: copied from public page
  title         text not null,        -- shown
  languages     text[] not null,      -- shown
  specialties   text[] not null,      -- shown, as listed
  modes         text[] not null,      -- shown
  cities        text[] not null default '{}',
  profile_url   text not null,        -- shown
  help_types    text[] not null,      -- internal index, never shown
  concern_areas text[] not null,      -- internal index, never shown
  source_url    text not null,
  copied_on     date not null,
  active        boolean not null default true
);
create index on catalogue_therapists using gin (concern_areas);
create index on catalogue_therapists using gin (help_types);
-- catalogue_services: same pattern with name, summary, modes, cities,
-- url, help_types, source_url, copied_on, active
```

`help_types` and `concern_areas` are Lokesh's mapping from the listed specialties to the enums; they drive search and never reach the screen (spec 2a). Search filters on `active`, help type, mode and city, then ranks by overlap between requested concerns and `concern_areas`, ties broken by id so results are repeatable.

The source of truth is `catalogue/therapists.json` and `catalogue/services.json` in the repo, zod-validated. `scripts/seed-catalogue.ts` upserts them into Supabase and marks missing ids inactive. Evals read the same JSON through the in-memory adapter, so a catalogue change shows up as a diff in review and in the eval results together.

### access and purge

```sql
-- every table above
alter table <t> enable row level security;   -- and no policies
revoke all on <t> from anon, authenticated;
revoke execute on function consume_limit, append_transcript
  from anon, authenticated;                  -- PostgREST exposes them
```

RLS on with zero policies means the anon key reads nothing. Only server code uses the service-role key, and the browser never talks to Supabase.

| pg_cron job | schedule | deletes |
|---|---|---|
| `purge-transcripts` | hourly | `transcripts` where `expires_at < now()` |
| `purge-sessions` | hourly | `sessions` idle more than 24 h |
| `purge-limits` | daily | `limits` older than 2 days |
| `purge-audit` | daily | `audit_events` older than 90 days |

Purges run inside the database, so there's no public endpoint to protect. Supabase's free tier pauses idle projects (unverified: I haven't checked the current policy); a paused project stops pg_cron and breaks the link, so step 0 checks it and a daily Vercel cron hitting a health route keeps the project awake if needed.

If Supabase is down, the turn can't load its stage or check limits. The core still runs the keyword floor (handoff on `imminent`) and otherwise returns "the demo is unavailable right now" with the crisis lines on screen.

## config

All JSON, parsed with zod by `config/index.ts` at module load, so a bad file fails `next build` and the eval run. JSON rather than TypeScript so the `/evals` page can show the files and a clinician can review the rules without reading code.

| file | holds |
|---|---|
| `config/crisis-lines.json` | `id`, `label`, `number`, `telHref`, `note`, `sourceUrl`, `checkedAt`, plus `when` (`always` or `being_harmed`); baked into the page at build |
| `config/risk-keywords.json` | patterns with id, language, tier; exclusion patterns |
| `config/thresholds.json` | Jev tier and yes/no thresholds, needs "enough" p, `understand` max turns, length caps per stage |
| `config/help-rules.json` | the rules table |
| `config/limits.json` | 20 turns, 1,000 chars, 5 conversations/day and 30 turns/hour per IP and per reviewer, 10 logins per 15 min per IP, 7-day login, $5/day |
| `config/prices.json` | USD per 1M input and output tokens per provider and model (Jev: $0.042 input, $0 output), source URL, check date |
| `config/providers.json` | chat order, model id per provider, per-call timeout; Jev model pinned to `jev-1.14.0` |
| `config/stock-lines.json` | stock line and handoff text per stage, English and Hinglish |
| `prompts/<stage>.md` | stage system prompts |

Secrets stay in env only, by name: `OPEN_ROUTER`, `GOOGLE_STUDIO`, `ALIBABA_KEY`, `TYPESAFE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SECRET`, `HISTORY_MAC_SECRET`, `DEMO_ACCESS_KEY`, `AUTH_COOKIE_SECRET`, `EMAIL_HASH_SECRET`, `LLM_LOCAL_CLI`. Rotating `DEMO_ACCESS_KEY` signs everyone out; rotating `EMAIL_HASH_SECRET` resets per-reviewer history, so it stays fixed unless it leaks.

## folder layout

```
src/
  core/                 no I/O; imports zod and core/* only
    ports.ts  types.ts  turn.ts
    controller/         stages.ts  prompts.ts  tool-loop.ts  rules.ts
    gates/              keyword-floor.ts  risk.ts  output-filter.ts
  adapters/
    chat/               openrouter.ts  google.ts  alibaba.ts  chain.ts
    chat/cli/           claude.ts  grok.ts       (never in prod build)
    decision/           jev.ts
    supabase/           sessions.ts  limiter.ts  catalogue.ts
                        audit.ts  transcripts.ts  client.ts
    memory/             in-memory versions of every store, for evals
  composition/          deployed.ts  local.ts
  app/                  page.tsx  login/page.tsx  evals/page.tsx
    api/                login/route.ts  turn/route.ts
                        conversation/route.ts
    lib/                reviewer.ts  (requireReviewer, cookie)
config/  prompts/  catalogue/  scripts/  supabase/migrations/
evals/
  cases/                risk.json  recommendation.json  redteam.json
  runner.ts  graders/  judge/claude-cli.ts  results/
```

## evals through the ports

```
evals/runner.ts --suite risk|recommendation|redteam
                --target claude-cli|grok-cli|chain
```

The runner imports `runTurn` and wires its own ports: the target as `ChatModel`, real Jev as `DecisionModel` (Q2), the in-memory adapters over `catalogue/*.json` for `Catalogue`, `SessionStore` and `AuditLog`, a no-op `TranscriptStore`, and a limiter that never blocks but totals spend for the report. No web layer, no Supabase.

| suite | how it drives the core | graders |
|---|---|---|
| risk | calls `gates/risk.ts` per message; target unused | per-tier recall and precision, floor and Jev reported apart |
| recommendation | feeds fixed user turns through `runTurn` | final help types vs expected; names and links in replies vs tool results |
| red-team | same, longer scripts | audit `filter_violations`, `stage_out = handoff` in crisis cases, rubric by the Claude CLI judge |

User turns are fixed scripts, not a simulated user, so two runs differ only by the system under test. The cost is that a script can't answer a follow-up question it didn't expect; the cases are written so the facts come out early anyway. The judge lives in `evals/judge/`, outside the core's ports, so Jev never grades itself (spec 8a). Each run writes `evals/results/<date>-<target>.json` and `latest.json`, which the README table and `/evals` page read at build time. The run also prints its cost from `config/prices.json` and runs the catalogue link check.

## decisions

| # | decision | reason |
|---|---|---|
| A1 | Typed session state in a server `sessions` row, purged after 24 h idle (Q1) | The client can't undo the `elevated` lock or the 20-turn cap. |
| A2 | Client-held messages checked against an HMAC chain | Tamper-evident history without storing text from users who didn't consent. |
| A3 | Session id in an `httpOnly` cookie, not the body | It authorizes "delete my conversation", so page scripts shouldn't read it. |
| A4 | Seventh port, `SessionStore` | Follows from A1; the core still does no I/O. |
| A5 | `DecisionModel` has domain methods; Jev only, no stand-in model (Q2) | The core never depends on Jev's wire format, and the gate model is the same in every environment. |
| A6 | Keyword patterns carry their own tier, with an exclusion list (Q3) | Explicit plans reach handoff even if Jev misses; hard negatives don't. |
| A7 | The action gains `show: id[]`, checked against tool results (Q4) | The reply and the cards always name the same people. |
| A8 | Thresholds on Jev's probabilities, applied in code | The controller tunes recall against precision; Jev's top choice doesn't decide. |
| A9 | "Enough" is a rule over the needs record's probabilities | Stage changes stay in code, as in spec 3a. |
| A10 | Additive JSON rules table; its output narrows the tool's `helpType` enum per turn | The model can't search outside what the rules picked. |
| A11 | SSE with `status` phases and one `final`; no token streaming | The filter must see the whole reply first, and the phases still show the turn is moving. |
| A12 | Jev risk and needs in parallel; chat waits for risk | Saves a round trip without letting the model run before the gate. |
| A13 | `handoff` is fixed config text, no model calls | The crisis path can't fail on a provider outage. |
| A14 | Fail over on every provider error; one JSON repair; no plain retry | The user is waiting, and the next provider is an independent path. |
| A15 | 25 s turn deadline, 8 s per chat call, 4 s per Jev call | Fits Vercel's 30 s limit with room for the stock line. |
| A16 | Audit, transcript and spend writes after the response | No user-facing latency; overshoot is bounded at cents. |
| A17 | RLS on, zero policies, functions revoked from `anon` | The browser can't reach any data even with the anon key. |
| A18 | IP hash = HMAC of IP plus IST date | No plain IPs, and hashes don't link across days. |
| A19 | Limits as one atomic upsert-with-cap function | Concurrent turns can't both pass a cap. |
| A20 | Purges as pg_cron jobs | No public purge endpoint to secure. |
| A21 | Catalogue source of truth is repo JSON, seeded to Supabase | Changes are reviewable diffs, and evals use the same rows. |
| A22 | Config as zod-validated JSON | Bad config fails the build, and reviewers can read it. |
| A23 | Supabase in Mumbai, Vercel functions in `bom1` | Users and data are in India. |
| A24 | Text plus `check` constraints, not Postgres enums | Adding a value is one line. |
| A25 | Evals wire in-memory stores, real Jev, the target model, fixed scripts | Runs without the web layer and compares like with like. |
| A26 | Audit events kept 90 days | Enough for eval and abuse review; holds no content. |
| A27 | Jev through `@typesafe-ai/sdk`, pinned to `jev-1.14.0` | Typed answers and retries come built in; a pinned version keeps tuned thresholds valid. |
| A28 | One Jev request per port method, all its questions batched | TypeSafe evaluates batched questions in parallel; per their cookbook, batching was 12x cheaper and 10x faster than one call per question. |
| A29 | Concerns as one Noul each; other fields as a Choice with `not_stated` | A person can have two concerns, and a missing fact is reported instead of guessed. |
| A30 | `imminent` first in the tier Choice; both orders run in the risk suite | Jev leans to the first option, so the order favours recall, and the suite shows by how much. |
| A31 | Reviewer login: any email plus one shared key in `DEMO_ACCESS_KEY` (Lokesh, overrides spec 5a) | Reviewers get in with no accounts, and Lokesh controls access with one secret. |
| A32 | Signed 7-day cookie whose signing key derives from the access key | Rotating the key revokes every cookie at once, with no session store. |
| A33 | Keyed HMAC of the email, not date-folded; the email itself never stored | Per-reviewer limits and audit work across days without holding personal data. |
| A34 | Login limited to 10 attempts per 15 min per IP, counted before the check | The shared key can't be brute-forced. |
| A35 | `requireReviewer()` called explicitly in each route, not middleware | Same runtime as the routes, visible in each handler, unit-testable. |
| A36 | The first `/api/turn` (with `start`) creates the session; no separate session endpoint | One fewer call for the UI, and the conversation limit is counted where the conversation begins. |
| A37 | `final.trace` mirrors the audit event | The "under the hood" row shows reviewers the gates working without exposing text or needs values. |
| A38 | `being_harmed` is sticky in the session row | Once disclosed, 181 stays on screen even if later turns don't repeat it. |
| A39 | Crisis lines baked in at build | The login and intake screens show them with no request that could fail. |

## open items

1. Jev: the API shape, price, context limits and SDK are now from TypeSafe's docs. Still open: the organization's rate limits (console page `console.typesafe.ai/rate-limits`, behind sign-in), latency on our own states, and Hinglish quality, which the risk suite measures.
2. Every chat provider and TypeSafe receive message text, and TypeSafe's zero data retention is enterprise-only. The intake disclosure should say so; flag for the frontend spec.
3. Supabase free-tier pause and pg_cron availability on the chosen plan, and Vercel region choice on Hobby: check in step 0.
4. Latency targets are guesses; measure in step 1 and update the budget table.
5. Rules table and thresholds are example values until the evals tune them and a clinician reviews them.
