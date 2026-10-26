// One turn as a fixed pipeline: keyword floor, handoff and cap checks, Jev
// risk gate (plus the needs record in `understand`), stage controller, chat
// model with the tool loop, output filter. No I/O of its own; everything
// outside the core comes in through `deps`.
//
// Scope so far (docs/spec.md, step plan): no limits table beyond the
// per-conversation turn cap.
import type { Config } from "@config";
import { z } from "zod";
import {
  ChatError,
  type Catalogue,
  type ChatModel,
  type ChatMsg,
  type DecisionModel,
  type TurnAudit,
  type Usage,
} from "./ports";
import type { FloorResult } from "./gates/keyword-floor";
import { filterReply } from "./gates/output-filter";
import { assessRisk, type RiskResult } from "./gates/risk";
import { closePrompt, languageLine, recommendPrompt, regeneratePrompt, understandPrompt } from "./controller/prompts";
import {
  ConcernArea,
  EMPTY_NEEDS,
  HELP_TYPE_LABEL,
  enough,
  helpTypesFor,
  type HelpType,
  type NeedsRecord,
} from "./needs";
import { detectLang } from "./text";
import type {
  Card,
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
  catalogue: Catalogue;
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

type Check = { violation: ReplacedReason | null; checks: { name: string; pass: boolean }[] };
type ReplyStage = "understand" | "recommend" | "close";

const THERAPIST_TYPES = ["therapist", "psychiatrist", "couples_therapist"] as const;
type TherapistType = (typeof THERAPIST_TYPES)[number];

// Tool arguments are validated here, in the core, against what the rules
// picked this turn (D25). Anything else is rejected and logged.
function toolSchemas(therapistTypes: TherapistType[], serviceTypes: HelpType[]) {
  return {
    search_therapists: z.strictObject({
      helpType: z.enum(therapistTypes.length ? (therapistTypes as [TherapistType, ...TherapistType[]]) : ["therapist"]),
      concerns: z.array(ConcernArea).max(2).default([]),
      language: z.string().max(20).optional(),
      mode: z.enum(["online", "in_person"]).optional(),
      city: z.string().max(20).optional(),
      limit: z.number().int().min(1).max(3).default(3),
    }),
    search_services: z.strictObject({
      helpTypes: z.array(z.enum(serviceTypes as [HelpType, ...HelpType[]])).min(1).max(3),
      mode: z.enum(["online", "in_person"]).optional(),
    }),
  };
}

function needsSummary(n: NeedsRecord): string {
  const parts = [
    `concerns: ${n.concerns.map((c) => c.area).join(", ") || "unknown"}`,
    `duration: ${n.duration.value}`,
    `impact on daily life: ${n.impact.value}`,
    `urgency: ${n.urgency.value}`,
    `for: ${n.forWhom.value}`,
    `language: ${n.language.value}`,
    `mode: ${n.mode.value}`,
    `city: ${n.city.value}`,
  ];
  return parts.join("; ");
}

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutput> {
  const { config } = deps;
  const t = config.thresholds;
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
  const tools: string[] = [];
  let toolRejected = false;
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

  const finish = (fields: Pick<Final, "reply"> & Partial<Final>, outcome: TurnAudit["outcome"]): TurnOutput => {
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
      tools,
      toolRejected,
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
    return finish({ reply: strings.limits.conversation_turns[lang], limit: { kind: "conversation_turns" } }, "limit");
  }

  // Risk and needs run in parallel; the chat model waits for both (D13).
  const userTurns = input.messages.filter((m) => m.role === "user").map((m) => m.text);
  const gathering = s.stage === "intake" || s.stage === "understand";
  const [riskResult, needsResult] = await Promise.all([
    assessRisk({
      decision: deps.decision,
      userTurns: userTurns.slice(-t.risk.riskTurns),
      floor,
      sticky: s.riskFloor === "elevated" ? "elevated" : "none",
      thresholds: t.risk,
      signal: deps.signal,
    }),
    gathering
      ? deps.decision.extractNeeds(userTurns.slice(-t.understandMaxTurns), deps.signal).catch(() => null)
      : Promise.resolve(null),
  ]);
  risk = riskResult;
  addUsage(risk.usage);
  if (risk.jev !== "error") jevModel = risk.jev.model;
  tier = risk.tier;
  if (risk.beingHarmed) s.beingHarmed = true;
  if (tier === "imminent") return handoff();
  if (tier === "elevated") s.riskFloor = "elevated";
  if (needsResult) {
    s.needs = needsResult.needs;
    addUsage(needsResult.usage);
  }

  s.userTurns += 1;
  if (s.stage === "intake") s.stage = "understand";
  let stage: ReplyStage = s.stage === "close" || s.stage === "recommend" ? "close" : "understand";
  if (stage === "understand") {
    s.understandTurns += 1;
    const needs = s.needs ?? EMPTY_NEEDS;
    if (enough(needs, t.needsP) || s.understandTurns >= t.understandMaxTurns) stage = "recommend";
  }
  s.stage = stage;

  const cap = t.lengthCaps[stage];
  const history: ChatMsg[] = input.messages.slice(-t.historyWindow).map((m) => ({ role: m.role, content: m.text }));
  const allowedUrls = deps.catalogue.allowedUrls();

  const stock = (reason: ReplacedReason): string =>
    reason === "diagnosis" || reason === "medical" || reason === "claims_human"
      ? strings.byReason[reason][lang]
      : strings.byStage[stage][lang];

  const ask = async (messages: ChatMsg[]) => {
    deps.emit("thinking");
    const res = await deps.chat.complete({
      messages,
      temperature: 0.3,
      maxTokens: 500,
      signal: deps.signal,
      onFailover: () => deps.emit("failover"),
    });
    providersTried = [...new Set([...providersTried, ...res.providersTried])];
    provider = res.provider;
    model = res.model;
    addUsage(res.usage);
    return res.action;
  };

  // Cheapest first: the exact checks, then Jev. A Jev error blocks the reply
  // rather than letting it through unchecked (spec 4b).
  const check = async (reply: string, knownNames: Set<string>): Promise<Check> => {
    deps.emit("checking");
    const exact = filterReply({ reply, lengthCap: cap, allowedUrls, knownNames });
    if (exact.violation) return exact;
    try {
      const j = await deps.decision.checkReply(reply, stage, deps.signal);
      addUsage(j.usage);
      jevModel = j.model;
      const p = t.replyCheckP;
      const jevChecks = [
        { name: "diagnosis", pass: j.diagnosis < p, reason: "diagnosis" as const },
        { name: "medical", pass: j.medicalAdvice < p, reason: "medical" as const },
        { name: "claims_human", pass: j.claimsHuman < p, reason: "claims_human" as const },
      ];
      const failed = jevChecks.find((c) => !c.pass);
      return { violation: failed?.reason ?? null, checks: [...exact.checks, ...jevChecks.map(({ name, pass }) => ({ name, pass }))] };
    } catch {
      return { violation: "safety_unavailable", checks: [...exact.checks, { name: "jev_check", pass: false }] };
    }
  };

  // Recommend-only state: what the rules picked and what the tools returned.
  const needs = s.needs ?? EMPTY_NEEDS;
  const helpTypes = stage === "recommend" ? helpTypesFor(config.helpRules, needs, tier) : [];
  const therapistTypes = helpTypes.filter((h): h is TherapistType => (THERAPIST_TYPES as readonly string[]).includes(h));
  const serviceTypes = helpTypes.filter((h) => h !== "crisis_line");
  const results = new Map<string, Card>();

  // The controller's own pick, used when the model searches for nothing or
  // shows ids it never got back.
  const defaultCards = async (): Promise<Card[]> => {
    const concerns = needs.concerns.map((c) => c.area);
    const mode = needs.mode.value === "online" || needs.mode.value === "in_person" ? needs.mode.value : undefined;
    const language = needs.language.value === "unknown" ? undefined : needs.language.value;
    const city = needs.city.value === "unknown" ? undefined : needs.city.value;
    const th: Card[] = [];
    for (const h of therapistTypes) {
      th.push(...(await deps.catalogue.searchTherapists({ helpType: h, concerns, language, mode, city, limit: therapistTypes.length > 1 ? 2 : 3 })));
    }
    const sv = serviceTypes.length ? await deps.catalogue.searchServices({ helpTypes: serviceTypes }) : [];
    for (const c of [...th, ...sv]) results.set(c.id, c);
    return [...th.slice(0, 3), ...sv.slice(0, 2)];
  };

  const pickCards = (show: string[] | undefined): Card[] => {
    const shown = (show ?? []).map((id) => results.get(id)).filter((c): c is Card => !!c);
    const th = shown.filter((c) => c.kind === "therapist").slice(0, 3);
    const sv = shown.filter((c) => c.kind === "service").slice(0, 2);
    return [...th, ...sv];
  };

  // The tool loop: at most `toolLoopMaxCalls` chat calls (design, typed
  // actions). Returns the final reply text and the cards it shows.
  const recommendLoop = async (base: ChatMsg[]): Promise<{ reply: string; cards: Card[] }> => {
    const schemas = toolSchemas(therapistTypes, serviceTypes.length ? serviceTypes : ["therapist"]);
    const msgs = [...base];
    for (let i = 0; i < t.toolLoopMaxCalls; i++) {
      const action = await ask(msgs);
      if (!action.tool) {
        let cards = pickCards(action.show);
        if (cards.length === 0) cards = await defaultCards();
        return { reply: action.reply.trim(), cards };
      }
      msgs.push({ role: "assistant", content: JSON.stringify(action) });
      const schema = schemas[action.tool.name];
      const args = schema.safeParse(action.tool.args);
      if (!args.success || (action.tool.name === "search_therapists" && therapistTypes.length === 0)) {
        toolRejected = true;
        msgs.push({ role: "user", content: `Tool call rejected: those arguments aren't allowed this turn. Use only the help types listed.` });
        continue;
      }
      deps.emit("searching");
      tools.push(action.tool.name);
      const found =
        action.tool.name === "search_therapists"
          ? await deps.catalogue.searchTherapists(args.data as z.infer<typeof schemas.search_therapists>)
          : await deps.catalogue.searchServices(args.data as z.infer<typeof schemas.search_services>);
      for (const c of found) results.set(c.id, c);
      const brief = found.map((c) => ({ id: c.id, name: c.name, title: c.title, languages: c.languages, specialties: c.specialties, modes: c.modes, cities: c.cities }));
      msgs.push({ role: "user", content: `Tool result (${action.tool.name}): ${JSON.stringify(brief)}` });
    }
    // Still asking for tools at the cap: the stock line plus the controller's
    // own top results.
    throw new LoopCapError();
  };

  const stagePrompt =
    stage === "understand"
      ? understandPrompt(cap)
      : stage === "recommend"
        ? recommendPrompt({
            lengthCap: cap,
            needs: needsSummary(needs),
            helpTypes: helpTypes.map((h) => h),
            therapistTypes,
          })
        : closePrompt(cap);
  const system = `${stagePrompt}\n\n${languageLine(lang)}`;
  const base: ChatMsg[] = [{ role: "system", content: system }, ...history];
  const labels = helpTypes.map((h) => HELP_TYPE_LABEL[h]);

  const produce = async (messages: ChatMsg[]): Promise<{ reply: string; cards: Card[] }> =>
    stage === "recommend" ? recommendLoop(messages) : { reply: (await ask(messages)).reply.trim(), cards: [] };

  // A recommend turn shows as `recommend` on screen; the session itself moves
  // on to `close`, so the next turn wraps up.
  const done = (reply: string, cards: Card[], replaced: ReplacedReason | null, outcome: TurnAudit["outcome"]) => {
    if (stage === "recommend") s.stage = "close";
    return finish(
      {
        reply,
        cards,
        helpTypes: labels,
        replaced: replaced ? { reason: replaced } : null,
        ...(stage === "recommend" ? { stage: "recommend" as const } : {}),
      },
      outcome,
    );
  };

  try {
    const first = await produce(base);
    const names = new Set(first.cards.filter((c) => c.kind === "therapist").map((c) => c.name));
    const firstCheck = await check(first.reply, names);
    checks = firstCheck.checks;
    if (!firstCheck.violation) return done(first.reply, first.cards, null, "ok");
    violations.push(firstCheck.violation);
    if (firstCheck.violation === "safety_unavailable") {
      return done(stock("safety_unavailable"), stage === "recommend" ? await defaultCards() : [], "safety_unavailable", "error");
    }

    regenerated = true;
    const second = await produce([
      ...base,
      { role: "assistant", content: JSON.stringify({ reply: first.reply }) },
      { role: "user", content: regeneratePrompt(firstCheck.violation) },
    ]);
    const secondNames = new Set(second.cards.filter((c) => c.kind === "therapist").map((c) => c.name));
    const secondCheck = await check(second.reply, secondNames);
    checks = secondCheck.checks;
    if (!secondCheck.violation) return done(second.reply, second.cards, null, "ok");
    violations.push(secondCheck.violation);
    // The stock line replaces the text, but the cards are catalogue fields
    // only, so they still show.
    return done(
      stock(secondCheck.violation),
      stage === "recommend" ? (second.cards.length ? second.cards : await defaultCards()) : [],
      secondCheck.violation,
      secondCheck.violation === "safety_unavailable" ? "error" : "ok",
    );
  } catch (e) {
    const reason: ReplacedReason = e instanceof ChatError ? "providers_down" : "error";
    if (e instanceof ChatError) providersTried = e.providersTried;
    provider = null;
    const cards = stage === "recommend" ? await defaultCards().catch(() => []) : [];
    return done(stock(reason), cards, reason, "error");
  }
}

class LoopCapError extends Error {
  constructor() {
    super("tool loop reached its cap");
    this.name = "LoopCapError";
  }
}
