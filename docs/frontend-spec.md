# samatva-support: frontend spec

Date: 2026-10-25
Status: approved by Lokesh on 2026-10-25. Follows `docs/spec.md` (approved 2026-10-25), which wins on any conflict except the reviewer login below, which Lokesh added in this interview and which changes spec decision 5a ("the demo is open").

The UI for v1: a reviewer login, an intake gate, one chat screen that carries the stages (understand, recommend, close) and the crisis handoff, and a public read-only `/evals` page. Mobile first, light and dark, WCAG 2.2 AA. The three Loom flows (Hinglish to a recommendation, a crisis message to the handoff, a diagnosis push the filter catches) are the main acceptance test.

## decisions

| # | decision | reason |
|---|---|---|
| F1 | Visual direction "calm paper": warm off-white, near-black ink, deep teal accent; Source Serif 4 headings, Inter body | Calm and deliberate on screen, and clear of Amaha's coral and dark green branding |
| F2 | Reviewer login: any email plus one shared access key | Lokesh hands the key to reviewers and rotates it to cut access. Email is stored only as a salted hash |
| F3 | Intake is a gate card on `/`; Start stays disabled until 18+ is ticked; the card then collapses into a one-line disclosure banner above the chat | Nobody types before confirming 18+, and the fixed text reads as fixed, not as model output |
| F4 | Chat is a quiet transcript: assistant text unboxed, user text in a tinted bubble, a 3-step stage stepper, a "Need help now?" button on every screen | The controller's stages are visible on the Loom without voice-over |
| F5 | Gate visibility: a note under any replaced reply, plus an opt-in "Under the hood" row per turn showing the content-free trace | The Loom can show the filter catch, the risk tier and provider failover live |
| F6 | No token streaming. `/api/turn` streams status events over SSE, then the whole filtered reply | The output filter must pass a reply before anyone sees it |
| F7 | Recommendation cards stacked full width, help-type chips first, catalogue fields only, no photos, link out in a new tab | Every card is legible by keyboard and screen reader, and nothing on a card is model-written |
| F8 | Crisis handoff is a panel pinned to the top of the transcript; the chat stays open; earlier cards are removed | Matches the spec's handoff stage (further messages get the lines again), without shutting the person out |
| F9 | Conversation kept in React state mirrored to `sessionStorage`; the server owns stage, turn count and the handoff and elevated locks | Survives a reload, is gone when the tab closes, and a client can't edit its way out of a handoff |
| F10 | Fixed texts have English and Hinglish variants, picked by the server from the last user message; UI chrome stays English | A Hinglish conversation stays Hinglish at the filter catch and the handoff |
| F11 | `/evals` is a scorecard per suite plus a collapsed "Where it falls short" list | The Loom's numbers segment fits one scroll |
| F12 | Tailwind CSS v4 with tokens as CSS variables, shadcn/ui (Radix) for Sheet, Checkbox, Collapsible, DropdownMenu, Button; `next/font` self-hosting; `next-themes` for the theme | Radix handles focus and ARIA for the few hard primitives |

## routes and flow

```
  /login --(key ok)--> /  intake card --(Start)--> chat
    ^                     |                          |
    | 401 anywhere        |                          v
    +---------------------+          understand -> recommend -> close
                                          \            |         /
                                           +---> handoff <------+
                                                 (any stage)
  /evals  public, no login, no model calls
```

| route | auth | renders |
|---|---|---|
| `/login` | none | LoginForm, crisis strip, footer |
| `/` | session cookie; middleware redirects to `/login` without it | IntakeCard, then the chat screen |
| `/evals` | none | the eval scorecard, read from the results JSON |

The crisis lines, the "Need help now?" button and the footer render on every route, signed in or not.

## design tokens

Defined as CSS variables on `:root`, redefined under `[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)` when no theme is forced. Theme follows the system; the header menu can force light or dark (stored in `localStorage` key `samatva:theme`, read by an inline script before paint so there is no flash).

### colour

| token | light | dark | used for |
|---|---|---|---|
| `--bg` | `#FAF7F2` | `#14171A` | page |
| `--surface` | `#FFFFFF` | `#1C2024` | cards, panels, inputs |
| `--ink` | `#1F2328` | `#E8E6E1` | body text |
| `--muted` | `#5A6169` | `#A4ABB3` | secondary text, captions |
| `--line` | `#E4DFD6` | `#2C3238` | dividers, card borders (decorative) |
| `--input-border` | `#8A9199` | `#6B737C` | input and checkbox borders |
| `--accent` | `#0F6B66` | `#5CC2BA` | primary buttons, links, stepper, pass |
| `--on-accent` | `#FFFFFF` | `#0B1F1D` | text on accent |
| `--focus` | `#0F6B66` | `#5CC2BA` | 2px focus ring, 2px offset |
| `--user-bubble` | `#E6F0EE` | `#1D3331` | user message background |
| `--urgent-bg` | `#FCEFD9` | `#2B2213` | handoff panel, crisis strip |
| `--urgent-ink` | `#4A2E00` | `#F6DCAE` | text on urgent bg |
| `--urgent-border` | `#A35F00` | `#D99A3D` | handoff panel border |
| `--urgent-btn` | `#1F2328` | `#F6DCAE` | call buttons |
| `--on-urgent-btn` | `#FFFFFF` | `#14171A` | text on call buttons |
| `--warn` | `#8A4B00` | `#E8A951` | eval misses, replaced-reply note icon |
| `--danger` | `#B42318` | `#F97066` | delete confirm, field errors |

Contrast, computed 2026-10-25 with the WCAG 2 formula: ink on bg 14.8:1 light and 14.4:1 dark; muted on bg 5.9:1 and 7.8:1; muted on user bubble 5.4:1 and 5.8:1; accent on bg 5.9:1 and 8.5:1; on-accent on accent 6.3:1 and 8.1:1; urgent ink on urgent bg 11.0:1 and 11.8:1; warn on surface 6.8:1 and 8.0:1; danger on surface 6.6:1 and 5.9:1; urgent border on bg 4.7:1 and 7.4:1; input border on surface 3.2:1 and 3.4:1. `--line` is decorative only and never the only boundary of a control.

The handoff uses amber, not alarm red: urgent but calm. Colour is never the only signal; pass and miss also carry text and an icon.

### type

| role | font | size / line height | weight |
|---|---|---|---|
| h1 (screen titles) | Source Serif 4 | 28/34, 32/40 from 768px | 600 |
| h2 (panel titles) | Source Serif 4 | 22/28 | 600 |
| h3 (card names) | Inter | 17/24 | 600 |
| body, messages | Inter | 16/25 | 400 |
| small (meta, chips) | Inter | 14/20 | 500 |
| caption (source lines) | Inter | 13/18 | 400, minimum size anywhere |
| numbers on `/evals` | Inter, `font-variant-numeric: tabular-nums` | 15/22 | 500 |

Subsets: latin and latin-ext. Fallback stack ends in `system-ui, "Noto Sans Devanagari", sans-serif` so stray Devanagari input still renders, though v1 doesn't support it.

### space, shape, motion

- Spacing on a 4px scale: 4, 8, 12, 16, 24, 32, 48. Page gutter 16px under 640px, 24px above.
- Content column max 680px, centred. `/evals` max 960px.
- Radius: 8px cards and inputs, 12px panels, 16px user bubble with the bottom-right corner at 4px, 999px chips.
- No shadows; cards and panels use a 1px `--line` border on `--surface`.
- Motion: 150ms opacity fade for new messages and the intake collapse. Under `prefers-reduced-motion: reduce`, none.
- Breakpoints: base 360, `sm` 640, `md` 768, `lg` 1024. Layout reflows to 320px with no horizontal scroll.
- Tap targets at least 44x44px; call buttons 56px tall.

## screens and states

### shell (every route)

- Header: wordmark "samatva support" (links to `/`), "Need help now?" button, menu button.
- "Need help now?" opens a Sheet (bottom on mobile, right on `md` up) with the full crisis line list. Works signed out and in every stage, including when a limit has hit.
- Menu (signed in only): Under the hood (toggle, off by default, stored in `localStorage` key `samatva:trace`), Theme (System, Light, Dark), Delete my conversation, Start over, Sign out, About this demo (links to `/evals` and the repo).
- Footer, small, on every route: "Independent demo by Lokesh, not affiliated with Amaha." plus links to `/evals` and the GitHub repo.

### login (`/login`)

Fields: Email (`type="email"`, `autocomplete="email"`), Access key (`type="password"`, `autocomplete="current-password"`, show/hide toggle). One Continue button. Below the form, the crisis strip.

| state | shows |
|---|---|
| idle | form; Continue enabled once both fields are non-empty |
| submitting | Continue shows "Checking…" and is disabled |
| wrong key | field error on Access key (copy below); focus moves to the key field |
| invalid email | field error on Email from native validation plus the copy below |
| too many tries | form-level error; Continue disabled for the wait the server returns |
| success | redirect to `/` |

### intake (`/`, stage `intake`)

A single card, h1 "Before we start", then the disclosure, then two checkboxes, then Start, then the crisis strip.

- 18+ checkbox: required. Start is disabled until it is ticked, with the hint visible under the button.
- Transcript consent checkbox: optional, unticked by default. Its value is sent with the first turn and shown later in the delete copy.
- Start: collapses the card into the disclosure banner, shows the first assistant line "What's going on for you?" (fixed, no model call) and focuses the composer. No request goes out yet.
- Session creation: whenever the sessionStorage history is empty, the next `POST /api/turn` carries `start: { adult: true, consent }` beside `messages`. The server creates the session and sets the httpOnly `ss_sid` cookie, which the UI never reads. `start` always opens a new session.
- The disclosure banner stays above the transcript for the whole conversation: "AI assistant · not a clinician · not an emergency service · 112", with "Details" expanding the full disclosure inline.

### chat (stages `understand`, `recommend`, `close`)

Layout top to bottom: header, stage stepper, disclosure banner, transcript, turn status, composer.

- Stage stepper: three steps, Talk (`understand`), Suggestions (`recommend`), Wrap up (`close`). The current step has `aria-current="step"`. The stage comes from the server's last `final` event, never from storage.
- Transcript: assistant messages unboxed, left, `--ink`. User messages in `--user-bubble`, right-aligned, max 85% width. Each message gets the `lang` the server returns for that turn. Text keeps line breaks (`white-space: pre-wrap`) and long roman-script words or URLs wrap (`overflow-wrap: anywhere`).
- Composer: auto-growing textarea, 1 to 6 lines, `spellcheck="false"` (Hinglish would be all red), `autocapitalize="sentences"`. Enter sends, Shift+Enter adds a line. The character counter appears from 800 and turns `--danger` above 1,000, and Send is disabled while over. Counting is by Unicode code points, the same function on client and server. From turn 15, a hint shows "N turns left in this conversation".
- While a turn is in flight the composer stays editable but Send is disabled, so one turn runs at a time.

| state | shows |
|---|---|
| in flight | a muted status line under the last user message, updated from SSE `status` events: Reading your message, Thinking, Looking for matches, Checking the reply, Trying another provider |
| reply | the whole reply fades in; the status line goes away |
| replaced | the stock line as the reply, then a note with an info icon in `--warn`: "Held back a reply that read like a diagnosis." (reason copy below) |
| under the hood on | a collapsed "Under the hood" row under each assistant message; expanded, a two-column list: stage before and after, risk (keyword floor tier, Jev tier and score, where score is p(elevated) + p(imminent), final tier), each filter check pass or fail, regenerated yes or no, provider used and providers tried, latency |
| elevated | from the turn the server reports `elevated`, a compact crisis line list sits above the cards in recommend: "If things get worse, call:" |
| recommend | the model's two or three sentences, then "Kinds of help that fit" chips, then service cards, then up to three therapist cards |
| close | cards stay; a wrap-up panel follows with "Delete my conversation" and "Start over". The composer stays for short follow-ups |

### recommendation cards

`<article>` per card, `--surface`, 1px `--line` border, 16px padding. Fields come only from the `cards[]` the server returns; the UI adds no text about a clinician except the fixed labels below.

| part | service card | therapist card |
|---|---|---|
| eyebrow | SERVICE | THERAPIST |
| h3 | service name | therapist name |
| line 2 | modes, languages | title |
| line 3 | — | "Speaks " + languages |
| line 4 | — | first 3 specialties, then "+N" (expands in place) |
| line 5 | — | modes, then `cities` joined with commas, if any |
| link | "View on amahahealth.com" | "View profile" |
| caption | "From Amaha's public page, copied " + `copiedAt` | same |

- Links open in a new tab with `rel="noopener noreferrer"`, show an external-link icon, and carry an accessible name like "View Dr X's profile on amahahealth.com, opens in a new tab".
- No photos, ratings, prices, or availability.
- A missing field is omitted, never filled with a placeholder.
- Help-type chips are plain labels, not buttons.

### crisis handoff (stage `handoff`)

Entered from any stage when the server returns `stage: "handoff"`.

- The stepper is replaced by the line "Getting you to people who can help".
- A HandoffPanel pins to the top of the transcript area (`--urgent-bg`, 2px `--urgent-border`, 12px radius): h2 with the handoff sentence, then one call button per line in `crisisLines[]` order, 112 first and largest. Each button is a `tel:` link showing the name, the number, and its note ("Emergency", "24x7, free"). 181 appears only when the server includes it.
- Under the buttons, a caption: "Numbers checked " + `checkedAt` + ", sources" linking each `sourceUrl`.
- Any recommendation cards and the elevated list are removed from the DOM, not hidden.
- Focus moves to the panel's h2 (`tabindex="-1"`).
- The composer stays. Each further reply re-renders the panel at the top and shows the server's follow-up line ("Are you safe right now?").
- Handoff survives reload: sessionStorage holds the last `final`, and the server's lock decides the next turn.

### limit reached

When `final.limit` is set, the composer is replaced by a LimitNotice; the transcript stays readable.

- LimitNotice: h2 and body per limit kind (copy below), then "If you need to talk to someone now:" and the full crisis line list, always.
- `conversation_turns` offers "Start a new conversation". The other kinds offer nothing to click except the crisis lines and "Need help now?".
- A session in handoff is never capped: its turns call no model, so the server returns stage `handoff`, the crisis lines and `limit: null`. The LimitNotice never shows during a handoff.

### errors

| case | trigger | shows |
|---|---|---|
| turn failed | network error, 400 `bad_request`, 503 `unavailable`, or the connection drops before any event | an inline notice under the user's message: copy below, plus Try again, which resends the same messages. The user's message stays |
| safety check down | `replaced.reason = "safety_unavailable"` (Jev failed, so the filter blocked, spec 4b) | the stock line, with its note |
| providers down | `replaced.reason = "providers_down"` (every provider in the chain failed) | the stock line, with its note |
| other failure mid-turn | `replaced.reason = "error"` (tool-loop cap, the 25 s turn deadline, or a stream that fails after it started) | the stock line, with its note |
| session expired | 401 `login_required` | a notice with "Sign in again"; the conversation stays in this tab's storage and the turn can be retried after sign-in |
| conversation out of sync | 409 `history_mismatch` or `stale_session` | a notice with "Start a new conversation", which clears local state and returns to the intake card |
| offline | `navigator.onLine` false | a banner above the composer; Send disabled until back online |
| message too long | over 1,000 code points | counter in `--danger`, Send disabled, the hint copy below |

Non-200 replies arrive before the stream starts, as JSON `{ error, crisisLines }`. Caps are never errors: they come as a 200 with `final.limit` set. Every error notice keeps the crisis lines one tap away via "Need help now?". The turn-failed notice also shows the crisis strip inline.

### delete and start over

- "Delete my conversation" (close panel and header menu) expands an inline confirm, not a modal: copy below, then Delete (`--danger`) and Cancel. Focus moves to Cancel.
- Delete calls `DELETE /api/conversation` (the `ss_sid` cookie names the session), with or without consent. The server deletes the session row and any transcript and clears `ss_sid`. The UI then clears sessionStorage and React state, shows the "Deleted" confirmation for 4s, and returns to the intake card, so the next turn opens a new session. If the call fails, the local copy is still cleared and the "server delete failed" copy shows instead of "Deleted".
- "Start over" clears local state without calling the server (a consented transcript stays until its 30 days or a delete) and returns to the intake card; the next turn's `start` opens a new session.
- Sign out clears sessionStorage, calls `POST /api/logout` (clears both cookies, 204), and goes to `/login`.

### `/evals`

Reads the latest results JSON at build time; no model calls, no login.

- Header: h1 "Evals", then "Run " + date + " · commit " + short sha + " · " + N + " synthetic cases, English and Hinglish", and the model id per target.
- One section per suite (Risk, Recommendation, Red-team), each with a table: one row per metric, one column for the target and one per eval target (Claude CLI, Grok CLI, deployed chain). A cell that meets its target shows the number with a check in `--accent`; a miss shows the number, a warning icon in `--warn`, and the gap ("0.92, 0.08 short").
- Under each table, a Collapsible "Where it falls short (N)": each failed case's id, the synthetic input, expected, got, and which target.
- Empty state: "No eval run published yet."
- Tables scroll horizontally inside their own container on narrow screens, with the metric column sticky; the page itself never scrolls sideways.

## fixed copy

UI chrome is English only. Texts marked EN / HI have a Hinglish variant; the server picks one per turn and returns `lang` (`en-IN` or `hi-Latn`). Hinglish fixed texts avoid gendered first-person verbs ("sakta" or "sakti") by using passive or third-person forms, so the AI is never given a gender. The server owns which line is shown; this table is the wording. Crisis numbers are never written here: they come from config, verified against their official sources in step 1.

### login

- Heading: "Reviewer access"
- Lead: "This demo is open to reviewers. Enter your email and the access key Lokesh shared with you."
- Privacy line: "Your email is stored only as a one-way hash, to apply per-reviewer limits. It's never shown or used to contact you."
- Wrong key: "That key didn't work. Check it, or ask Lokesh for the current one."
- Invalid email: "Enter an email address, like name@example.com."
- Too many tries: "Too many tries. Wait 15 minutes, then try again."

### disclosure (intake card)

> I'm an AI assistant. I'm not a therapist, doctor or counsellor, and I can't diagnose or prescribe.
>
> I'm not an emergency service. If you might be in danger, call 112 now.
>
> I'll ask a few questions about what's going on, then suggest kinds of help and Amaha services and therapists that may fit. What you do next is up to you.
>
> This is an independent demo by Lokesh, not affiliated with Amaha.

- 18+ checkbox: "I'm 18 or older (required)"
- Under-18 hint, shown under Start while unticked: "This demo is for adults. If you're under 18, please talk to an adult you trust, or call Tele-MANAS from the list below."
- Consent checkbox: "Save this conversation for 30 days so Lokesh can review how the demo works (optional)"
- Consent help text: "Saved conversations are deleted automatically after 30 days, and you can delete yours any time. If you leave this unticked, nothing you type is stored; only content-free counts, like which step you reached, are logged."
- Start button: "Start"
- First assistant line (fixed): "What's going on for you?"
- Collapsed banner: "AI assistant · not a clinician · not an emergency service · 112"

### crisis strip and sheet

- Strip (login, intake, turn-failed notice): "In danger now? Call 112." then the next two lines by name and number, then "All helplines".
- Sheet title: "Talk to a person now"
- Sheet lead: "These are free helplines in India. If you're in immediate danger, call 112."

### handoff (EN / HI)

- Sentence, EN: "What you've shared sounds serious, and you deserve to talk to a person right now. Please call one of these."
- Sentence, HI: "Aapne jo bataya woh serious lagta hai. Abhi kisi insaan se baat karna zaroori hai. Please inme se kisi ek ko call karein."
- Follow-up, EN: "Are you safe right now?"
- Follow-up, HI: "Kya aap abhi safe hain?"
- Stepper replacement: "Getting you to people who can help"

### stock lines (EN / HI)

| when | EN | HI |
|---|---|---|
| diagnosis | I can't diagnose, but I can help you find someone who can. | Yahan diagnosis nahi diya ja sakta, par aise expert tak pahunchne mein madad ho sakti hai jo de sakein. |
| medical or medication | I can't advise on medicines or doses. A psychiatrist or doctor can, and I can help you find one. | Dawaiyon ya dose par yahan salah nahi di ja sakti. Psychiatrist ya doctor yeh bata sakte hain, aur unhe dhoondhne mein madad ho sakti hai. |
| claims to be human | I'm an AI assistant, not a person. | Yeh ek AI assistant hai, koi insaan nahi. |
| other, in understand | I'd like to understand a bit more before suggesting anything. What's been weighing on you most? | Kuch suggest karne se pehle thoda aur samajhna hai. Sabse zyada kya pareshan kar raha hai? |
| other, in recommend | Here are some kinds of help that may fit, based on what you've shared. | Aapne jo bataya uske hisaab se, yeh kuch tarah ki madad fit ho sakti hai. |
| other, in close | Take your time with these. You can open any of them, or delete this conversation below. | Aaram se dekhiye. Inme se koi bhi khol sakte hain, ya neeche yeh conversation delete kar sakte hain. |

Replaced-reply notes (English chrome), by `replaced.reason`:

| reason | note |
|---|---|
| `diagnosis` | Held back a reply that read like a diagnosis. |
| `medical` | Held back a reply that gave medical or medication advice. |
| `claims_human` | Held back a reply that claimed to be a person. |
| `link` | Held back a reply with a link that isn't on the allowed list. |
| `name` | Held back a reply that named someone not in the catalogue. |
| `length` | Held back a reply that ran too long. |
| `safety_unavailable` | The safety check was unavailable, so a standard reply was shown. |
| `providers_down` | The AI services behind this demo aren't responding, so a standard reply was shown. |
| `error` | Something went wrong with this reply, so a standard reply was shown. |

### limits (EN / HI for the body)

| kind | heading | body EN | body HI |
|---|---|---|---|
| `conversation_turns` | This conversation has reached its limit | Each conversation is capped at 20 messages. You can start a new one. | Ek conversation mein 20 messages tak ki limit hai. Aap naya conversation shuru kar sakte hain. |
| `daily_conversations` | Demo limit reached for today | This demo allows 5 conversations a day, because it runs on paid AI services. Please come back tomorrow. | Yeh demo paid AI services par chalta hai, isliye din mein 5 conversations ki limit hai. Kal phir try karein. |
| `hourly_turns` | Demo limit reached for now | Too many messages in the last hour. Please try again in an hour. | Pichle ek ghante mein bahut messages ho gaye. Ek ghante baad phir try karein. |
| `spend` | Demo limit reached for today | The demo has used its budget for today, because it runs on paid AI services. Please come back tomorrow. | Aaj ka demo budget khatam ho gaya hai. Kal phir try karein. |

Always followed by: "If you need to talk to someone now:" and the crisis line list.

### errors, delete, close

- Turn failed: "Couldn't get a reply just now. Your message is still here." Button: "Try again"
- Session expired: "Your reviewer session has ended. Sign in again; this conversation stays in this tab." Button: "Sign in again"
- Out of sync: "This conversation can't continue. Start a new one; the crisis lines are always above." Button: "Start a new conversation"
- Offline: "You're offline. Messages send when you're back online."
- Too long: "Keep it under 1,000 characters."
- Wrap-up panel: "That's what I can suggest for now. You can open any of these, ask a short question, or delete this conversation."
- Delete confirm, consent given: "Delete this conversation? It's removed from this tab and from the server now. This can't be undone."
- Delete confirm, no consent: "Delete this conversation? It's removed from this tab now. Nothing from it was saved on the server."
- Deleted: "Deleted. Nothing from this conversation is kept."
- Server delete failed: "Removed from this tab, but the server delete failed. It will still be deleted automatically within 30 days."

## component inventory

| component | where | notes |
|---|---|---|
| `AppShell` | all routes | header, main, footer; skip link "Skip to conversation" |
| `Header`, `Wordmark`, `HeaderMenu` | all | menu is shadcn DropdownMenu |
| `NeedHelpButton`, `CrisisLinesSheet` | all | Sheet; works signed out |
| `CrisisLineList` | sheet, strip, handoff, limit, elevated | variants `strip`, `list`, `panel`, `compact`; the list is baked in at build for login, intake and the sheet; handoff, limit and error states use the `crisisLines` the server returns, which add 181 when it applies |
| `DemoFooter` | all | not-affiliated line, links |
| `LoginForm` | `/login` | server action or POST `/api/login` |
| `IntakeCard`, `Disclosure`, `AgeCheckbox`, `ConsentCheckbox` | `/` | shadcn Checkbox |
| `DisclosureBanner` | chat | collapsed disclosure with Details |
| `StageStepper` | chat | three steps; replaced in handoff |
| `Transcript`, `AssistantMessage`, `UserMessage` | chat | `role="log"` |
| `ReplacedNote` | chat | per `replaced.reason` |
| `TraceRow` | chat | shadcn Collapsible; renders only when Under the hood is on |
| `TurnStatus` | chat | SSE phase line |
| `Composer`, `CharCounter`, `TurnsLeft` | chat | Enter to send |
| `HelpTypeChips`, `ServiceCard`, `TherapistCard`, `SourceCaption` | recommend, close | cards share a `CatalogueCard` base |
| `HandoffPanel` | handoff | focus target |
| `ClosePanel`, `DeleteConversation` | close, menu | inline confirm |
| `LimitNotice`, `ErrorNotice`, `OfflineBanner` | chat | |
| `EvalsHeader`, `SuiteTable`, `MissesList` | `/evals` | |
| `components/ui/*` | shared | shadcn: button, checkbox, sheet, collapsible, dropdown-menu |

## where state lives

| state | lives in | written by | cleared on |
|---|---|---|---|
| auth | httpOnly, Secure, SameSite=Lax signed cookie, 7 days | `/api/login` | sign out, expiry, key rotation |
| session id | httpOnly `ss_sid` cookie, never readable by page scripts | first `/api/turn` with `start` | delete, logout, a new `start` |
| conversation: messages (role, text, lang, ts), last cards, helpTypes, crisisLines, last trace per turn, consent | React reducer (`useConversation`), mirrored to `sessionStorage` key `samatva:conv` | client, from each `final` event | tab close, delete, start over, sign out |
| stage, turnsUsed, turnsLimit, handoff and elevated locks | server, per session; the client keeps an echo for rendering only | server | server-side |
| theme, Under the hood toggle | `localStorage` `samatva:theme`, `samatva:trace` | client | never (per-device preference) |

Each turn the client sends `{ messages }` to `POST /api/turn`, plus `start: { adult: true, consent }` when its history is empty; the server returns SSE `status` events, then one `final` event. The `final` payload the UI relies on: reply, lang, stage, turnsUsed, turnsLimit, replaced, helpTypes, cards, crisisLines, limit, trace. The exact schema lives in `docs/architecture.md`.

## accessibility

- Target WCAG 2.2 AA on every route.
- Keyboard: every control reachable in a logical order; visible 2px `--focus` ring; Esc closes the sheet and menu and returns focus to the trigger; no keyboard traps outside the sheet's own focus trap.
- Screen readers and replies: the transcript is `role="log"` with `aria-live="off"`; a separate visually hidden `aria-live="polite"` region announces each new assistant reply once, whole, prefixed "Assistant:". `TurnStatus` is `aria-live="polite"` but announces only "Thinking" and "Trying another provider", so it doesn't chatter. The handoff moves focus to its heading instead of announcing.
- Focus: after sending, focus stays in the composer. After Start, focus goes to the composer. After delete, focus goes to the intake heading.
- Forms: every input has a visible label; errors are linked with `aria-describedby` and announced; required is stated in text.
- Language: `<html lang="en-IN">`; each message and each Hinglish fixed text carries its `lang`. unverified: how NVDA, TalkBack and VoiceOver voice `hi-Latn`; if it reads worse than `en-IN`, drop the attribute for Hinglish and note it here.
- Reflow at 320px and text at 200% without horizontal page scroll; respects `prefers-reduced-motion`.
- Links that open a new tab say so in their accessible name.

## acceptance checks

Run each on a 360px phone viewport and on desktop, in light and dark.

### login

1. Signed out, `/` redirects to `/login`; `/evals` loads without a redirect.
2. A wrong key shows the wrong-key copy and focuses the key field; the right key lands on `/` with an httpOnly cookie set (visible in devtools, not in `document.cookie`).
3. The crisis strip, "Need help now?" and the footer show on `/login`.

### intake

4. Start is disabled until 18+ is ticked; the consent box starts unticked.
5. The disclosure copy matches this spec word for word.
6. After Start, the card collapses into the banner, the first line "What's going on for you?" shows, and the composer has focus.

### chat

7. Enter sends and Shift+Enter adds a line; Send is disabled while a turn is in flight and above 1,000 code points.
8. The status line shows at least "Thinking" during a turn, then disappears when the whole reply appears; the reply never appears in pieces.
9. A screen reader announces each reply once, whole (NVDA with Chrome, VoiceOver on iOS).
10. The stepper matches the server's stage on every turn.
11. With Under the hood on, each assistant turn has a trace row; with it off, none render.
12. From turn 15, the turns-left hint shows.

### recommendation and close

13. Every card field matches its catalogue row exactly; no card shows a photo, rating or model text.
14. Every card link opens the catalogue `profileUrl` in a new tab.
15. After recommend, the wrap-up panel shows Delete my conversation and Start over.
16. Delete calls `DELETE /api/conversation` with or without consent, clears `sessionStorage`, shows the matching confirm copy, and the next message sends `start`.

### handoff

17. A crisis message moves to the handoff: the panel pins on top, 112 is first, focus lands on the panel heading, and no card or catalogue link remains in the DOM.
18. 181 appears only when the server includes it.
19. Each call button is a `tel:` link with the number from config, and the caption links each source.
20. A reload keeps the handoff panel; a further message shows the panel again with the follow-up line.

### limits and errors

21. Each limit kind shows its copy, replaces the composer, and shows the crisis lines.
22. During a handoff, turns past any cap still get the handoff panel and no LimitNotice.
23. A dropped stream shows the turn-failed notice with Try again; Try again resends without duplicating the user message.
24. A 401 mid-conversation shows Sign in again, and after sign-in the conversation is still there. A 409 shows Start a new conversation.

### `/evals`

25. The page renders from the results JSON with no network call to any model.
26. Misses show the gap in text, not colour alone; "Where it falls short" lists every failed case.
27. At 360px, tables scroll inside their container and the page doesn't scroll sideways.

### the three Loom flows

28. Hinglish to recommendation: a Hinglish conversation stays Hinglish through understand and recommend, ends with help-type chips and at least one therapist card, and reads cleanly at 1080p and on a phone frame.
29. Crisis to handoff: one crisis message, in English or Hinglish, reaches the handoff panel within one turn, with the handoff sentence in the user's language.
30. Diagnosis push: "bas bata do mujhe depression hai kya" (or the English version) shows the stock diagnosis line in the matching language with the "Held back a reply that read like a diagnosis." note, and with Under the hood on, the trace shows the diagnosis check failing.

### whole app

31. axe DevTools reports no serious or critical issues on `/login`, `/` (intake, chat, handoff, limit) and `/evals`.
32. Keyboard only, a reviewer can sign in, finish a conversation, open a card link, open and close the crisis sheet, and delete the conversation.

## open items

- Crisis line names, numbers and notes come from config once verified in step 1; this spec holds none of them except 112.
- Hinglish fixed texts are Lokesh's or a fluent reviewer's to check before deploy; the wording above is a first draft.
- Screen reader handling of `hi-Latn` is unverified (see accessibility).
- The `final` event schema, the login endpoint, cookie signing, email hashing and server-side session locks are specified in `docs/architecture.md`.
