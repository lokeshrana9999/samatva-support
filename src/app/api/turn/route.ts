// POST /api/turn: zero or more SSE `status` events, then one `final` (D12).
// Cookies can't be set once a stream starts, so `ss_sid` goes out as a header
// on the Response itself.
import { cookies } from "next/headers";
import { z } from "zod";
import { config } from "@config";
import { deps } from "@/composition";
import { crisisLinesFor, runTurn } from "@/core/turn";
import { codePoints, detectLang } from "@/core/text";
import type { Final, Msg, Phase, SessionState } from "@/core/types";
import { historyMac } from "@/app/lib/history-mac";
import { SID_COOKIE, requireReviewer, secureCookies } from "@/app/lib/reviewer";

export const maxDuration = 30;

const Body = z.strictObject({
  start: z.strictObject({ adult: z.literal(true), consent: z.boolean() }).optional(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(config.limits.maxMessages),
});

const jsonError = (status: number, error: string) =>
  Response.json({ error, crisisLines: crisisLinesFor(config, false) }, { status });

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function sidCookie(id: string): string {
  return `${SID_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureCookies ? "; Secure" : ""}`;
}

// The keyword floor's handoff needs no stored state, so it still answers when
// Supabase is down (design, /api/turn contract).
function storelessHandoff(messages: Msg[], floorBeingHarmed: boolean): Final {
  const lang = detectLang(messages.at(-1)!.text);
  return {
    reply: config.stockLines.handoffSentence[lang],
    lang,
    stage: "handoff",
    turnsUsed: 0,
    turnsLimit: config.limits.conversationTurns,
    replaced: null,
    helpTypes: [],
    cards: [],
    crisisLines: crisisLinesFor(config, floorBeingHarmed),
    limit: null,
    trace: {
      stageIn: "intake",
      stageOut: "handoff",
      risk: { keyword: "imminent", jev: "off", final: "imminent" },
      checks: [],
      regenerated: false,
      provider: null,
      providersTried: [],
      latencyMs: 0,
    },
  };
}

export async function POST(req: Request) {
  if (!(await requireReviewer())) return jsonError(401, "login_required");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_request");
  const { start, messages } = parsed.data;
  const last = messages.at(-1)!;
  if (last.role !== "user") return jsonError(400, "bad_request");
  if (messages.some((m) => m.role === "user" && codePoints(m.text) > config.limits.messageCodePoints)) {
    return jsonError(400, "bad_request");
  }

  const d = await deps();
  const jar = await cookies();
  let session: SessionState | null;
  let newSid: string | null = null;
  try {
    if (start) {
      session = await d.sessions.create({ adult: true, consent: start.consent });
      newSid = session.id;
    } else {
      const sid = jar.get(SID_COOKIE)?.value;
      session = sid ? await d.sessions.load(sid) : null;
      if (!session) return jsonError(409, "stale_session");
    }
  } catch (e) {
    console.error("[turn] session store unavailable:", (e as Error).message);
    const floor = d.keywordFloor(last.text);
    if (floor.tier !== "imminent") return jsonError(503, "unavailable");
    return new Response(sse("final", storelessHandoff(messages, floor.beingHarmed)), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  }

  const prior = messages.slice(0, -1);
  if (start ? prior.length > 0 : historyMac(prior) !== session.historyMac) {
    return jsonError(409, "history_mismatch");
  }

  const encoder = new TextEncoder();
  const turnSession = session;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      const emit = (phase: Phase) => send("status", { phase });
      try {
        const { final, session: next } = await runTurn(
          {
            chat: d.chat,
            config,
            keywordFloor: d.keywordFloor,
            emit,
            signal: AbortSignal.any([req.signal, AbortSignal.timeout(d.turnDeadlineMs)]),
            now: Date.now,
          },
          { session: turnSession, messages },
        );
        next.historyMac = historyMac([...messages, { role: "assistant", text: final.reply }]);
        const saved = await d.sessions.save(next);
        if (saved === "conflict") {
          send("final", {
            ...final,
            reply: config.stockLines.byStage.understand[final.lang],
            replaced: { reason: "error" },
          } satisfies Final);
        } else {
          send("final", final);
        }
      } catch (e) {
        console.error("[turn] failed", (e as Error).message);
        const lang = detectLang(last.text);
        send("final", {
          ...storelessHandoff(messages, false),
          reply: config.stockLines.byStage.understand[lang],
          stage: turnSession.stage,
          replaced: { reason: "error" },
        } satisfies Final);
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  if (newSid) headers.append("Set-Cookie", sidCookie(newSid));
  return new Response(stream, { headers });
}
