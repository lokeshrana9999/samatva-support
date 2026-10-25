// One turn as a fixed pipeline: keyword floor, handoff and cap checks, stage
// controller, chat model, output filter. No I/O of its own; everything outside
// the core comes in through `deps`.
//
// Step 1 scope: no Jev (risk is the keyword floor alone, `trace.risk.jev` is
// 'off'), only the `understand` stage, and no limits table beyond the per-
// conversation turn cap. See docs/spec.md, step plan.
import type { Config } from "@config";
import { ChatError, type ChatModel, type ChatMsg } from "./ports";
import type { FloorResult } from "./gates/keyword-floor";
import { maxTier } from "./gates/keyword-floor";
import { filterReply } from "./gates/output-filter";
import { regeneratePrompt, understandPrompt } from "./controller/prompts";
import { detectLang } from "./text";
import type {
  CrisisLine,
  Final,
  Lang,
  Msg,
  Phase,
  ReplacedReason,
  SessionState,
  Stage,
  Tier,
  Trace,
} from "./types";

export type TurnDeps = {
  chat: ChatModel;
  config: Config;
  keywordFloor: (text: string) => FloorResult;
  emit: (phase: Phase) => void;
  signal: AbortSignal;
  now: () => number;
};

export type TurnInput = { session: SessionState; messages: Msg[] };
export type TurnOutput = { final: Final; session: SessionState };

export function crisisLinesFor(config: Config, beingHarmed: boolean): CrisisLine[] {
  return config.crisisLines
    .filter((l) => l.when === "always" || beingHarmed)
    .map(({ when: _when, ...line }) => line);
}

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutput> {
  const { config } = deps;
  const started = deps.now();
  const s: SessionState = { ...input.session };
  const last = input.messages.at(-1);
  if (!last || last.role !== "user") throw new Error("the last message must be the user's");

  const lang: Lang = detectLang(last.text);
  const stageIn: Stage = s.stage;
  const strings = config.stockLines;

  deps.emit("reading");
  const floor = deps.keywordFloor(last.text);
  if (floor.beingHarmed) s.beingHarmed = true;
  const tier: Tier = maxTier(floor.tier, s.riskFloor === "elevated" ? "elevated" : null);
  if (tier === "elevated") s.riskFloor = "elevated";

  const trace = (extra: Partial<Trace>): Trace => ({
    stageIn,
    stageOut: s.stage,
    risk: { keyword: floor.tier, jev: "off", final: tier },
    checks: [],
    regenerated: false,
    provider: null,
    providersTried: [],
    latencyMs: deps.now() - started,
    ...extra,
  });

  const final = (fields: Pick<Final, "reply"> & Partial<Final>): Final => ({
    lang,
    stage: s.stage,
    turnsUsed: s.userTurns,
    turnsLimit: config.limits.conversationTurns,
    replaced: null,
    helpTypes: [],
    cards: [],
    crisisLines: crisisLinesFor(config, s.beingHarmed),
    limit: null,
    trace: trace({}),
    ...fields,
  });

  // Handoff: fixed text, no model call, never capped (design D26, D27).
  if (s.stage === "handoff" || tier === "imminent") {
    const entering = s.stage !== "handoff";
    s.stage = "handoff";
    s.userTurns += 1;
    const reply = entering
      ? strings.handoffSentence[lang]
      : `${strings.handoffFollowUp[lang]} ${strings.handoffSentence[lang]}`;
    return { final: final({ reply, trace: trace({}) }), session: s };
  }

  if (s.userTurns >= config.limits.conversationTurns) {
    return {
      final: final({
        reply: strings.limits.conversation_turns[lang],
        limit: { kind: "conversation_turns" },
      }),
      session: s,
    };
  }

  s.userTurns += 1;
  if (s.stage === "intake") s.stage = "understand";

  // Only `understand` exists in step 1; recommend and close arrive in step 3.
  const cap = config.thresholds.lengthCaps.understand;
  const history: ChatMsg[] = input.messages
    .slice(-config.thresholds.historyWindow)
    .map((m) => ({ role: m.role, content: m.text }));
  const base: ChatMsg[] = [{ role: "system", content: understandPrompt(cap) }, ...history];

  const stock = (reason: ReplacedReason): string =>
    reason === "diagnosis" || reason === "medical" || reason === "claims_human"
      ? strings.byReason[reason][lang]
      : strings.byStage.understand[lang];

  let providersTried: string[] = [];
  let provider: string | null = null;
  const ask = async (messages: ChatMsg[]) => {
    deps.emit("thinking");
    const res = await deps.chat.complete({
      messages,
      temperature: 0.3,
      maxTokens: 400,
      signal: deps.signal,
      onFailover: () => deps.emit("failover"),
    });
    providersTried = [...new Set([...providersTried, ...res.providersTried])];
    provider = res.provider;
    return res.action.reply.trim();
  };

  const check = (reply: string) => {
    deps.emit("checking");
    return filterReply({ reply, lengthCap: cap, allowedUrls: new Set(), knownNames: new Set() });
  };

  try {
    const first = await ask(base);
    const firstCheck = check(first);
    if (!firstCheck.violation) {
      s.understandTurns += 1;
      return {
        final: final({
          reply: first,
          trace: trace({ checks: firstCheck.checks, provider, providersTried }),
        }),
        session: s,
      };
    }

    const second = await ask([
      ...base,
      { role: "assistant", content: JSON.stringify({ reply: first }) },
      { role: "user", content: regeneratePrompt(firstCheck.violation) },
    ]);
    const secondCheck = check(second);
    s.understandTurns += 1;
    if (!secondCheck.violation) {
      return {
        final: final({
          reply: second,
          trace: trace({ checks: secondCheck.checks, regenerated: true, provider, providersTried }),
        }),
        session: s,
      };
    }
    return {
      final: final({
        reply: stock(secondCheck.violation),
        replaced: { reason: secondCheck.violation },
        trace: trace({ checks: secondCheck.checks, regenerated: true, provider, providersTried }),
      }),
      session: s,
    };
  } catch (e) {
    const reason: ReplacedReason = e instanceof ChatError ? "providers_down" : "error";
    if (e instanceof ChatError) providersTried = e.providersTried;
    return {
      final: final({
        reply: stock(reason),
        replaced: { reason },
        trace: trace({ provider: null, providersTried }),
      }),
      session: s,
    };
  }
}
