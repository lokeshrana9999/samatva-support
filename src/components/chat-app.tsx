"use client";
// The signed-in app on `/`: intake gate, then one chat screen that carries the
// stages and the crisis handoff. The conversation lives in React state
// mirrored to sessionStorage; the server owns stage, turn count and the locks
// (design D50).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, CrisisLine, Final, Lang, Phase, ReplacedReason } from "@/core/types";
import { HelpTypeChips, RecommendationCards } from "./cards";
import { codePoints } from "@/core/text";
import { CrisisLineList, CrisisStrip, SourcesCaption } from "./crisis";
import { DemoFooter, Header } from "./shell";

const STORE_KEY = "samatva:conv";
const TRACE_KEY = "samatva:trace";
const MAX_CODE_POINTS = 1000;
const FIRST_LINE = "What's going on for you?";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  lang?: Lang;
  local?: boolean; // the fixed first line: shown, never sent
  failed?: boolean;
  replaced?: ReplacedReason | null;
  trace?: Final["trace"];
  cards?: Card[];
  helpTypes?: string[];
};

type Conv = { started: boolean; consent: boolean; messages: ChatMessage[]; last: Final | null };

type Notice =
  | null
  | "turn_failed"
  | "session_expired"
  | "out_of_sync"
  | "deleted"
  | "delete_failed"
  | "delete_failed_unsaved";

const EMPTY: Conv = { started: false, consent: false, messages: [], last: null };

const PHASE_TEXT: Record<Phase, string> = {
  reading: "Reading your message",
  thinking: "Thinking",
  searching: "Looking for matches",
  checking: "Checking the reply",
  failover: "Trying another provider",
};

const REPLACED_NOTE: Record<ReplacedReason, string> = {
  diagnosis: "Held back a reply that read like a diagnosis.",
  medical: "Held back a reply that gave medical or medication advice.",
  claims_human: "Held back a reply that claimed to be a person.",
  link: "Held back a reply with a link that isn't on the allowed list.",
  name: "Held back a reply that named someone not in the catalogue.",
  length: "Held back a reply that ran too long.",
  gendered: "Held back a reply that gave the assistant a gender.",
  safety_unavailable: "The safety check was unavailable, so a standard reply was shown.",
  providers_down: "The AI services behind this demo aren't responding, so a standard reply was shown.",
  error: "Something went wrong with this reply, so a standard reply was shown.",
};

const DELETE_NOTICE: Partial<Record<NonNullable<Notice>, string>> = {
  deleted: "Deleted. Only content-free counts, like which step you reached, are kept.",
  delete_failed:
    "Removed from this tab, but the server delete failed. Your saved messages are still deleted automatically after 30 days.",
  delete_failed_unsaved:
    "Removed from this tab. The server delete failed, but your messages were never saved there, and its short record is deleted within a day.",
};

const LIMIT_HEADING: Record<string, string> = {
  conversation_turns: "This conversation has reached its limit",
  daily_conversations: "Demo limit reached for today",
  hourly_turns: "Demo limit reached for now",
  spend: "Demo limit reached for today",
};

// The cap counts the user's messages; crisis replies still come after it.
function turnsLeft(n: number): string {
  if (n <= 0) return "No messages left in this conversation";
  return `${n} ${n === 1 ? "message" : "messages"} left in this conversation`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = window.sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Reads `event:`/`data:` pairs from the SSE body.
async function* readEvents(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>;
  const reader = body.pipeThrough(decoder).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) as unknown };
    }
  }
}

export function ChatApp({ defaultLines }: { defaultLines: CrisisLine[] }) {
  const router = useRouter();
  const [conv, setConv] = useState<Conv>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [traceOn, setTraceOn] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [focusComposer, setFocusComposer] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handoffRef = useRef<HTMLHeadingElement>(null);
  const intakeRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Restoring browser-only state after mount keeps the server render and the
    // first client render identical.
    /* eslint-disable react-hooks/set-state-in-effect */
    setConv(load(STORE_KEY, EMPTY));
    try {
      setTraceOn(window.localStorage.getItem(TRACE_KEY) === "1");
    } catch {}
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(conv));
    } catch {}
  }, [conv, hydrated]);

  const last = conv.last;
  const stage = last?.stage ?? (conv.started ? "understand" : "intake");
  const inHandoff = stage === "handoff";
  const lines = last?.crisisLines?.length ? last.crisisLines : defaultLines;

  useEffect(() => {
    if (inHandoff) handoffRef.current?.focus();
  }, [inHandoff, last]);

  const reset = useCallback((n: Notice = null) => {
    setConv(EMPTY);
    setDraft("");
    setPhase(null);
    setConfirmDelete(false);
    setNotice(n);
    setAdult(false);
    setConsent(false);
    requestAnimationFrame(() => intakeRef.current?.focus());
  }, []);

  function start() {
    setConv({
      started: true,
      consent,
      messages: [{ role: "assistant", text: FIRST_LINE, local: true, lang: "en-IN" }],
      last: null,
    });
    setFocusComposer(true);
  }

  // Focus moves after the composer has rendered, not in the click handler.
  useEffect(() => {
    if (!focusComposer) return;
    composerRef.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusComposer(false);
  }, [focusComposer]);

  async function send(text: string, base: ChatMessage[]) {
    const history = base.filter((m) => !m.local && !m.failed);
    const payload = {
      ...(history.length === 0 ? { start: { adult: true as const, consent: conv.consent } } : {}),
      messages: [...history.map(({ role, text }) => ({ role, text })), { role: "user" as const, text }],
    };
    const withUser: ChatMessage[] = [...base.filter((m) => !m.failed), { role: "user", text }];
    setConv((c) => ({ ...c, messages: withUser }));
    setNotice(null);
    setPhase("reading");

    const fail = (n: Notice) => {
      setPhase(null);
      setNotice(n);
      setConv((c) => ({
        ...c,
        messages: c.messages.map((m, i) => (i === c.messages.length - 1 && m.role === "user" ? { ...m, failed: true } : m)),
      }));
    };

    let res: Response;
    try {
      res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return fail("turn_failed");
    }
    if (res.status === 401) return fail("session_expired");
    if (res.status === 409) return fail("out_of_sync");
    if (!res.ok || !res.body) return fail("turn_failed");

    let final: Final | null = null;
    try {
      for await (const { event, data } of readEvents(res.body)) {
        if (event === "status") setPhase((data as { phase: Phase }).phase);
        if (event === "final") final = data as Final;
      }
    } catch {
      return fail("turn_failed");
    }
    if (!final) return fail("turn_failed");

    const f = final;
    setPhase(null);
    setConv((c) => ({
      ...c,
      last: f,
      messages: [
        ...c.messages,
        {
          role: "assistant",
          text: f.reply,
          lang: f.lang,
          replaced: f.replaced?.reason ?? null,
          trace: f.trace,
          ...(f.cards.length ? { cards: f.cards, helpTypes: f.helpTypes } : {}),
        },
      ],
    }));
    // The handoff moves focus to its heading instead, which reads the reply.
    if (f.stage !== "handoff") {
      const note = f.replaced ? ` ${REPLACED_NOTE[f.replaced.reason]}` : "";
      setAnnounce(`Assistant: ${f.reply}${note}`);
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text || phase || codePoints(text) > MAX_CODE_POINTS) return;
    setDraft("");
    void send(text, conv.messages);
  }

  function retry() {
    const failed = [...conv.messages].reverse().find((m) => m.failed);
    if (failed) void send(failed.text, conv.messages);
  }

  async function doDelete() {
    const saved = conv.consent;
    const res = await fetch("/api/conversation", { method: "DELETE" }).catch(() => null);
    reset(res?.status === 204 ? "deleted" : saved ? "delete_failed" : "delete_failed_unsaved");
  }

  async function signOut() {
    try {
      window.sessionStorage.removeItem(STORE_KEY);
    } catch {}
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  function toggleTrace() {
    setTraceOn((t) => {
      try {
        window.localStorage.setItem(TRACE_KEY, t ? "0" : "1");
      } catch {}
      return !t;
    });
  }

  useEffect(() => {
    if (notice !== "deleted" && notice !== "delete_failed" && notice !== "delete_failed_unsaved") return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (confirmDelete) cancelRef.current?.focus();
  }, [confirmDelete]);

  const cp = codePoints(draft);
  const turnsUsed = last?.turnsUsed ?? 0;
  const turnsLimit = last?.turnsLimit ?? 20;
  const limit = last?.limit && !inHandoff ? last.limit : null;

  return (
    <>
      <Header
        lines={lines}
        menu={{
          traceOn,
          onToggleTrace: toggleTrace,
          onDelete: () => setConfirmDelete(true),
          onStartOver: () => reset(),
          onSignOut: signOut,
        }}
      />
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      <main id="conversation" className="mx-auto flex max-w-[680px] flex-col gap-4 px-4 py-6 sm:px-6">
        {notice && DELETE_NOTICE[notice] && (
          <p role="status" className="rounded-lg border border-line bg-surface p-3 text-[14px]">
            {DELETE_NOTICE[notice]}
          </p>
        )}

        {confirmDelete && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p>
              {conv.consent
                ? "Delete this conversation? Your saved messages are deleted from the server and the conversation is removed from this tab. This can't be undone."
                : "Delete this conversation? It's removed from this tab, and the server's short record of it is deleted. Your messages were never saved there."}
            </p>
            <div className="mt-3 flex gap-2">
              <button className="min-h-11 rounded-lg bg-danger px-4 font-semibold text-white" onClick={doDelete}>
                Delete
              </button>
              <button
                ref={cancelRef}
                className="min-h-11 rounded-lg border border-input-border px-4"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!conv.started ? (
          <IntakeCard
            headingRef={intakeRef}
            adult={adult}
            consent={consent}
            onAdult={setAdult}
            onConsent={setConsent}
            onStart={start}
            lines={defaultLines}
          />
        ) : (
          <>
            {inHandoff ? (
              <p className="text-[14px] font-medium text-muted">Getting you to people who can help</p>
            ) : (
              <StageStepper stage={stage} />
            )}
            <DisclosureBanner />

            {inHandoff && (
              <section className="rounded-xl border-2 border-urgent-border bg-urgent-bg p-4 text-urgent-ink">
                <h2 ref={handoffRef} tabIndex={-1} className="font-serif text-[22px] leading-7 font-semibold outline-none">
                  {last?.reply}
                </h2>
                <div className="mt-4">
                  <CrisisLineList lines={lines} variant="panel" />
                </div>
                <SourcesCaption lines={lines} />
              </section>
            )}

            {last?.trace.risk.final === "elevated" && !inHandoff && (
              <div className="rounded-lg border border-line bg-surface p-3">
                <p className="text-[14px] font-medium">If things get worse, call:</p>
                <CrisisLineList lines={lines} variant="compact" />
              </div>
            )}

            <div role="log" aria-live="off" className="flex flex-col gap-4">
              {conv.messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex flex-col items-end gap-1">
                    <p
                      lang={m.lang}
                      className="fade-in max-w-[85%] rounded-2xl rounded-br-[4px] bg-user-bubble px-4 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
                    >
                      {m.text}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="fade-in">
                    <p lang={m.lang} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {m.text}
                    </p>
                    {m.replaced && (
                      <p className="mt-1 flex items-start gap-1 text-[14px] leading-5 text-muted">
                        <span aria-hidden className="text-warn">
                          ⓘ
                        </span>
                        {REPLACED_NOTE[m.replaced]}
                      </p>
                    )}
                    {traceOn && m.trace && <TraceRow trace={m.trace} />}
                    {/* Cards come out of the DOM in a handoff, not just hidden (D49). */}
                    {m.cards && !inHandoff && (
                      <div className="mt-4 flex flex-col gap-4">
                        <HelpTypeChips labels={m.helpTypes ?? []} />
                        {m.helpTypes?.includes("A crisis line, now") && (
                          <div className="rounded-lg border border-urgent-border bg-urgent-bg p-3 text-urgent-ink">
                            <p className="text-[14px] font-medium">Talk to a person now:</p>
                            <CrisisLineList lines={lines} variant="compact" />
                          </div>
                        )}
                        <RecommendationCards cards={m.cards} />
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>

            {(stage === "close" || stage === "recommend") && !limit && !phase && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <p>That&apos;s what I can suggest. You can open any of these, ask a short question, or delete this conversation.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="min-h-11 rounded-lg border border-danger px-4 font-medium text-danger" onClick={() => setConfirmDelete(true)}>
                    Delete my conversation
                  </button>
                  <button className="min-h-11 rounded-lg border border-input-border px-4" onClick={() => reset()}>
                    Start over
                  </button>
                </div>
              </section>
            )}

            {phase && (
              <p className="text-[14px] text-muted" aria-live="polite">
                <span aria-hidden={phase !== "thinking" && phase !== "failover"}>{PHASE_TEXT[phase]}…</span>
              </p>
            )}

            {notice === "turn_failed" && (
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
                <p role="alert">Couldn&apos;t get a reply just now. Your message is still here.</p>
                <button className="min-h-11 self-start rounded-lg bg-accent px-4 font-semibold text-on-accent" onClick={retry}>
                  Try again
                </button>
                <CrisisStrip lines={lines} />
              </div>
            )}
            {notice === "session_expired" && (
              <div className="rounded-xl border border-line bg-surface p-4">
                <p role="alert">
                  Your reviewer session has ended. Sign in again, then send your last message again. The conversation
                  so far stays in this tab.
                </p>
                <a className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-semibold text-on-accent" href="/login">
                  Sign in again
                </a>
              </div>
            )}
            {notice === "out_of_sync" && (
              <div className="rounded-xl border border-line bg-surface p-4">
                <p role="alert">
                  This conversation can&apos;t continue. Start a new one. The crisis lines are always under &quot;Need help
                  now?&quot; at the top.
                </p>
                <button className="mt-3 min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent" onClick={() => reset()}>
                  Start a new conversation
                </button>
              </div>
            )}

            {limit ? (
              <section className="rounded-xl border border-line bg-surface p-4">
                <h2 className="font-serif text-[22px] leading-7 font-semibold">{LIMIT_HEADING[limit.kind]}</h2>
                <p className="mt-2">{last?.reply}</p>
                <p className="mt-4 font-medium">If you need to talk to someone now:</p>
                <div className="mt-2">
                  <CrisisLineList lines={lines} variant="list" />
                </div>
                {limit.kind === "conversation_turns" && (
                  <button className="mt-4 min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent" onClick={() => reset()}>
                    Start a new conversation
                  </button>
                )}
              </section>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <label htmlFor="composer" className="sr-only">
                  Your message
                </label>
                <textarea
                  id="composer"
                  ref={composerRef}
                  rows={Math.min(6, Math.max(1, draft.split("\n").length))}
                  value={draft}
                  spellCheck={false}
                  autoCapitalize="sentences"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  aria-describedby="composer-meta"
                  className="min-h-11 w-full resize-none rounded-lg border border-input-border bg-surface px-3 py-2"
                />
                <div id="composer-meta" className="flex items-center justify-between gap-3 text-[14px] text-muted">
                  <span>
                    {turnsUsed >= 15 && turnsLeft(turnsLimit - turnsUsed)}
                    {cp > MAX_CODE_POINTS && <span className="text-danger"> Keep it under 1,000 characters.</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    {cp >= 800 && <span className={cp > MAX_CODE_POINTS ? "text-danger" : ""}>{cp}/1000</span>}
                    <button
                      type="submit"
                      disabled={!draft.trim() || !!phase || cp > MAX_CODE_POINTS}
                      className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-50"
                    >
                      Send
                    </button>
                  </span>
                </div>
              </form>
            )}
          </>
        )}
      </main>
      <DemoFooter />
    </>
  );
}

function IntakeCard({
  headingRef,
  ...props
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  adult: boolean;
  consent: boolean;
  onAdult: (v: boolean) => void;
  onConsent: (v: boolean) => void;
  onStart: () => void;
  lines: CrisisLine[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-[28px] leading-[34px] font-semibold outline-none md:text-[32px] md:leading-10"
      >
        Before we start
      </h1>
      <Disclosure />
      <label className="mt-5 flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[var(--accent)]"
          checked={props.adult}
          onChange={(e) => props.onAdult(e.target.checked)}
        />
        <span>I&apos;m 18 or older (required)</span>
      </label>
      <label className="mt-2 flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[var(--accent)]"
          checked={props.consent}
          onChange={(e) => props.onConsent(e.target.checked)}
          aria-describedby="consent-help"
        />
        <span>
          Save this conversation for 30 days so Lokesh can review how the demo works (optional)
          <span id="consent-help" className="mt-1 block text-[14px] leading-5 text-muted">
            If you tick this, your messages are saved and deleted automatically after 30 days. You can delete them
            sooner with &quot;Delete my conversation&quot;, until you start a new one. If you leave it unticked, your
            messages aren&apos;t saved. Either way, the server keeps content-free counts, like which step you reached,
            and until a day after your last message a short summary used to match suggestions, like the kind of concern
            and city.
          </span>
        </span>
      </label>
      <button
        className="mt-5 min-h-11 rounded-lg bg-accent px-6 font-semibold text-on-accent disabled:opacity-50"
        disabled={!props.adult}
        onClick={props.onStart}
        aria-describedby={props.adult ? undefined : "under-18"}
      >
        Start
      </button>
      {!props.adult && (
        <p id="under-18" className="mt-2 text-[14px] leading-5 text-muted">
          This demo is for adults. If you&apos;re under 18, please talk to an adult you trust, or call Tele-MANAS from
          the list below.
        </p>
      )}
      <div className="mt-6">
        <CrisisStrip lines={props.lines} />
      </div>
    </section>
  );
}

function Disclosure() {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <p>I&apos;m an AI assistant. I&apos;m not a therapist, doctor or counsellor, and I can&apos;t diagnose or prescribe.</p>
      <p>I&apos;m not an emergency service. If you might be in danger, call 112 now.</p>
      <p>
        What you type is sent to AI services to write and check replies: TypeSafe and the model providers named under{" "}
        <Link className="underline" href="/evals#about">
          About this demo
        </Link>
        . This happens whether or not you save the conversation.
      </p>
      <p>
        I&apos;ll ask a few questions about what&apos;s going on, then suggest kinds of help that may fit, with links to
        Amaha services and sample therapist profiles. What you do next is up to you.
      </p>
      <p>This is an independent demo by Lokesh, not affiliated with Amaha.</p>
    </div>
  );
}

function DisclosureBanner() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-5">
      <div className="flex items-center justify-between gap-2">
        <span>
          AI assistant · not a clinician · not an emergency service ·{" "}
          <a className="font-medium underline" href="tel:112">
            emergency: call 112
          </a>
        </span>
        <button className="min-h-11 shrink-0 px-2 underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Details<span className="sr-only"> about this assistant</span>
        </button>
      </div>
      {open && (
        <div className="pb-2 text-[15px]">
          <Disclosure />
        </div>
      )}
    </div>
  );
}

const STEPS = [
  { stage: "understand", label: "Talk" },
  { stage: "recommend", label: "Suggestions" },
  { stage: "close", label: "Wrap up" },
] as const;

function StageStepper({ stage }: { stage: string }) {
  const current = Math.max(0, STEPS.findIndex((s) => s.stage === stage));
  return (
    <ol className="flex gap-2 text-[14px]" aria-label="Conversation steps">
      {STEPS.map((s, i) => (
        <li
          key={s.stage}
          aria-current={i === current ? "step" : undefined}
          className={`flex-1 border-t-4 pt-1 ${i <= current ? "border-accent font-semibold" : "border-line text-muted"}`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function TraceRow({ trace }: { trace: Final["trace"] }) {
  const jev = trace.risk.jev;
  const rows: [string, string][] = [
    ["stage", `${trace.stageIn} → ${trace.stageOut}`],
    ["keyword floor", trace.risk.keyword ?? "none"],
    ["Jev", jev === null ? "not asked" : typeof jev === "string" ? jev : `${jev.tier} (${jev.score.toFixed(2)})`],
    ["final risk", trace.risk.final],
    ...trace.checks.map((c): [string, string] => [`check: ${c.name}`, c.pass ? "pass" : "fail"]),
    ["regenerated", trace.regenerated ? "yes" : "no"],
    ["provider", trace.provider ?? "none"],
    ["tried", trace.providersTried.join(", ") || "none"],
    ["latency", `${trace.latencyMs} ms`],
  ];
  return (
    <details className="mt-2 rounded-lg border border-line bg-surface px-3 py-1 text-[14px] leading-5">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">Under the hood</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
