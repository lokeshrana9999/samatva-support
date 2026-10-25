// One turn as a fixed pipeline: keyword floor, handoff and cap checks, Jev
// risk gate, stage controller, chat model, output filter. No I/O of its own;
// everything outside the core comes in through `deps`.
//
// Scope so far (docs/spec.md, step plan): only the `understand` stage, and no
// limits table beyond the per-conversation turn cap.
import type { Config } from "@config";
import { ChatError, type ChatModel, type ChatMsg, type DecisionModel, type TurnAudit, type Usage } from "./ports";
import type { FloorResult } from "./gates/keyword-floor";
import { filterReply } from "./gates/output-filter";
import { assessRisk, type RiskResult } from "./gates/risk";
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
  decision: DecisionModel;
  config: Config;
  keywordFloor: (text: string) => FloorResult;
  emit: (phase: Phase) => void;
  signal: AbortSignal;
  now: () => number;
};

export type TurnInput = { session: SessionState; messages: Msg[] };
export type TurnOutput = { final: Final; session: SessionState; audit: TurnAudit };

export function crisisLinesFor(config: Config, beingHarmed: boolean): CrisisLine[] {
  return config.crisisLines
    .filter((l) => l.when === "always" || beingHarmed)
    .map(({ when: _when, ...line }) => line);
}

type ReplyCheck = { violation: ReplacedReason | null; checks: { name: string; pass: boolean }[] };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutput> {
  const { config } = deps;
  const started = deps.now();
  const s: SessionState = { ...input.session };
  const last = input.messages.at(-1);
  if (!last || last.role !== "user") throw new Error("the last message must be the user's");

  const lang: Lang = detectLang(last.text);
  const stageIn: Stage = s.stage;
  const strings = config.stockLines;
  const usage: Usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
  const addUsage = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.usd += u.usd;
  };

  deps.emit("reading");
  const floor = deps.keywordFloor(last.text);
  if (floor.beingHarmed) s.beingHarmed = true;
  let risk: RiskResult | null = null;
  let tier: Tier = floor.tier ?? "none";

  let provider: string | null = null;
  let model: string | null = null;
  let jevModel: string | null = null;
  let providersTried: string[] = [];
  let checks: { name: string; pass: boolean }[] = [];
  const violations: string[] = [];
  let regenerated = false;

  const trace = (): Trace => ({
    stageIn,
    stageOut: s.stage,
    risk: {
      keyword: floor.tier,
      jev: risk === null ? null : risk.jev === "error" ? "error" : { tier: risk.jev.tier, score: risk.jev.score },
      final: tier,
    },
    checks,
    regenerated,
    provider,
    providersTried,
    latencyMs: deps.now() - started,
  });

  const finish = (
    fields: Pick<Final, "reply"> & Partial<Final>,
    outcome: TurnAudit["outcome"],
  ): TurnOutput => {
    const final: Final = {
      lang,
      stage: s.stage,
      turnsUsed: s.userTurns,
      turnsLimit: config.limits.conversationTurns,
      replaced: null,
      helpTypes: [],
      cards: [],
      crisisLines: crisisLinesFor(config, s.beingHarmed),
      limit: null,
      trace: trace(),
      ...fields,
    };
    const audit: TurnAudit = {
      turn: s.userTurns,
      stageIn,
      stageOut: s.stage,
      riskKeyword: floor.tier,
      keywordPattern: floor.patternId,
      riskJev: risk === null ? null : risk.jev === "error" ? "error" : risk.jev.tier,
      riskJevP: risk && risk.jev !== "error" ? risk.jev.p : null,
      riskFinal: tier,
      filterViolations: violations,
      regenerated,
      stockFallback: final.replaced !== null,
      tools: [],
      toolRejected: false,
      provider,
      model,
      jevModel,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costUsd: usage.usd,
      latencyMs: final.trace.latencyMs,
      outcome,
    };
    return { final, session: s, audit };
  };

  const handoff = (): TurnOutput => {
    const entering = s.stage !== "handoff";
    s.stage = "handoff";
    s.userTurns += 1;
    const reply = entering
      ? strings.handoffSentence[lang]
      : `${strings.handoffFollowUp[lang]} ${strings.handoffSentence[lang]}`;
    return finish({ reply }, "handoff");
  };

  // Handoff: fixed text, no model call, never capped (D26, D27). The floor's
  // imminent goes straight there without waiting on Jev.
  if (s.stage === "handoff" || floor.tier === "imminent") {
    tier = s.stage === "handoff" ? tier : "imminent";
    return handoff();
  }

  if (s.userTurns >= config.limits.conversationTurns) {
    return finish(
      { reply: strings.limits.conversation_turns[lang], limit: { kind: "conversation_turns" } },
      "limit",
    );
  }

  const userTurns = input.messages.filter((m) => m.role === "user").map((m) => m.text);
  risk = await assessRisk({
    decision: deps.decision,
    userTurns: userTurns.slice(-config.thresholds.risk.riskTurns),
    floor,
    sticky: s.riskFloor === "elevated" ? "elevated" : "none",
    thresholds: config.thresholds.risk,
    signal: deps.signal,
  });
  addUsage(risk.usage);
  if (risk.jev !== "error") jevModel = risk.jev.model;
  tier = risk.tier;
  if (risk.beingHarmed) s.beingHarmed = true;
  if (tier === "imminent") return handoff();
  if (tier === "elevated") s.riskFloor = "elevated";

  s.userTurns += 1;
  if (s.stage === "intake") s.stage = "understand";

  // Only `understand` exists so far; recommend and close arrive in step 3.
  const cap = config.thresholds.lengthCaps.understand;
  const history: ChatMsg[] = input.messages
    .slice(-config.thresholds.historyWindow)
    .map((m) => ({ role: m.role, content: m.text }));
  const base: ChatMsg[] = [{ role: "system", content: understandPrompt(cap) }, ...history];

  const stock = (reason: ReplacedReason): string =>
    reason === "diagnosis" || reason === "medical" || reason === "claims_human"
      ? strings.byReason[reason][lang]
      : strings.byStage.understand[lang];

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
    model = res.model;
    addUsage(res.usage);
    return res.action.reply.trim();
  };

  // Cheapest first: the exact checks, then Jev. A Jev error blocks the reply
  // rather than letting it through unchecked (spec 4b).
  const check = async (reply: string): Promise<ReplyCheck> => {
    deps.emit("checking");
    const exact = filterReply({ reply, lengthCap: cap, allowedUrls: new Set(), knownNames: new Set() });
    if (exact.violation) return exact;
    try {
      const j = await deps.decision.checkReply(reply, s.stage, deps.signal);
      addUsage(j.usage);
      jevModel = j.model;
      const p = config.thresholds.replyCheckP;
      const jevChecks = [
        { name: "diagnosis", pass: j.diagnosis < p, reason: "diagnosis" as const },
        { name: "medical", pass: j.medicalAdvice < p, reason: "medical" as const },
        { name: "claims_human", pass: j.claimsHuman < p, reason: "claims_human" as const },
      ];
      const failed = jevChecks.find((c) => !c.pass);
      return {
        violation: failed?.reason ?? null,
        checks: [...exact.checks, ...jevChecks.map(({ name, pass }) => ({ name, pass }))],
      };
    } catch {
      return {
        violation: "safety_unavailable",
        checks: [...exact.checks, { name: "jev_check", pass: false }],
      };
    }
  };

  try {
    const first = await ask(base);
    const firstCheck = await check(first);
    checks = firstCheck.checks;
    if (!firstCheck.violation) {
      s.understandTurns += 1;
      return finish({ reply: first }, "ok");
    }
    violations.push(firstCheck.violation);
    if (firstCheck.violation === "safety_unavailable") {
      s.understandTurns += 1;
      return finish({ reply: stock("safety_unavailable"), replaced: { reason: "safety_unavailable" } }, "error");
    }

    regenerated = true;
    const second = await ask([
      ...base,
      { role: "assistant", content: JSON.stringify({ reply: first }) },
      { role: "user", content: regeneratePrompt(firstCheck.violation) },
    ]);
    const secondCheck = await check(second);
    checks = secondCheck.checks;
    s.understandTurns += 1;
    if (!secondCheck.violation) return finish({ reply: second }, "ok");
    violations.push(secondCheck.violation);
    return finish(
      { reply: stock(secondCheck.violation), replaced: { reason: secondCheck.violation } },
      secondCheck.violation === "safety_unavailable" ? "error" : "ok",
    );
  } catch (e) {
    const reason: ReplacedReason = e instanceof ChatError ? "providers_down" : "error";
    if (e instanceof ChatError) providersTried = e.providersTried;
    provider = null;
    return finish({ reply: stock(reason), replaced: { reason } }, "error");
  }
}
