// Eval runner: drives the core through its ports with no web layer (design,
// evals through the ports). Run with:
//   npm run eval -- --suite risk
// The risk suite calls the risk gate per message with real Jev; the chat
// model is unused. Results land in evals/results/ (git-ignored except
// latest-*.json, which the README and /evals read).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "@config";
import { JevDecisionModel } from "@/adapters/decision/jev";
import { JsonCatalogue, services, therapists } from "@/adapters/catalogue/json";
import { ProviderChain } from "@/adapters/chat/chain";
import { OpenAICompatibleProvider } from "@/adapters/chat/openai-compatible";
import { MemorySessionStore } from "@/adapters/memory/sessions";
import { compileFloor } from "@/core/gates/keyword-floor";
import { assessRisk } from "@/core/gates/risk";
import { HELP_TYPE_LABEL } from "@/core/needs";
import type { ChatModel } from "@/core/ports";
import { runTurn } from "@/core/turn";
import type { Final, Msg, Tier } from "@/core/types";

type RiskCase = { id: string; lang: "en" | "hi"; label: Tier; text: string; beingHarmed?: boolean };

const ROOT = path.resolve(__dirname, "..");
const TIERS: Tier[] = ["none", "elevated", "imminent"];
// Stays well under the org's 80 requests/s so a run can't starve the demo.
const CONCURRENCY = 8;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type Row = { id: string; lang: string; label: Tier; floor: Tier; jev: Tier | "error"; final: Tier; beingHarmed: boolean; expectedHarmed: boolean };

type Stat = { recall: number | null; precision: number | null; n: number };

function metrics(rows: Row[], pick: (r: Row) => Tier | "error"): Record<Tier | "anyRisk", Stat> {
  const per = {} as Record<Tier, Stat>;
  for (const t of TIERS) {
    const actual = rows.filter((r) => r.label === t);
    const predicted = rows.filter((r) => pick(r) === t);
    const tp = actual.filter((r) => pick(r) === t).length;
    per[t] = {
      recall: actual.length ? tp / actual.length : null,
      precision: predicted.length ? tp / predicted.length : null,
      n: actual.length,
    };
  }
  // "Any risk": elevated or imminent, the line between listening and handing off.
  const atRisk = (t: Tier | "error") => t === "elevated" || t === "imminent" || t === "error";
  const actualRisk = rows.filter((r) => r.label !== "none");
  const predRisk = rows.filter((r) => atRisk(pick(r)));
  const tpRisk = actualRisk.filter((r) => atRisk(pick(r))).length;
  return {
    ...per,
    anyRisk: {
      recall: actualRisk.length ? tpRisk / actualRisk.length : null,
      precision: predRisk.length ? tpRisk / predRisk.length : null,
      n: actualRisk.length,
    },
  };
}

async function runRisk() {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY must be set for the risk suite");
  const { cases } = JSON.parse(readFileSync(path.join(ROOT, "evals/cases/risk.json"), "utf8")) as { cases: RiskCase[] };
  const floor = compileFloor(config.riskKeywords);
  const t = config.thresholds;
  const decision = new JevDecisionModel(config.providers.jev.model, {
    timeoutMs: 5000,
    maxRetries: 2,
    deadlineMs: 20000,
  });

  const started = Date.now();
  let jevModel = "";
  let usd = 0;
  const rows = await pool(cases, CONCURRENCY, async (c): Promise<Row> => {
    const f = floor(c.text);
    const r = await assessRisk({
      decision,
      userTurns: [c.text],
      floor: f,
      sticky: "none",
      thresholds: t.risk,
      signal: AbortSignal.timeout(30000),
    });
    usd += r.usage.usd;
    if (r.jev !== "error") jevModel = r.jev.model;
    return {
      id: c.id,
      lang: c.lang,
      label: c.label,
      floor: f.tier ?? "none",
      jev: r.jev === "error" ? "error" : r.jev.tier,
      final: r.tier,
      beingHarmed: r.beingHarmed,
      expectedHarmed: c.beingHarmed === true,
    };
  });

  const misses = rows.filter((r) => r.final !== r.label);
  const harmed = rows.filter((r) => r.expectedHarmed);
  const result = {
    suite: "risk",
    runAt: new Date().toISOString(),
    jevModel,
    thresholds: t.risk,
    cases: rows.length,
    jevErrors: rows.filter((r) => r.jev === "error").length,
    costUsd: Number(usd.toFixed(6)),
    seconds: Math.round((Date.now() - started) / 1000),
    metrics: {
      final: metrics(rows, (r) => r.final),
      keywordFloor: metrics(rows, (r) => r.floor),
      jev: metrics(rows, (r) => r.jev),
      byLang: {
        en: metrics(rows.filter((r) => r.lang === "en"), (r) => r.final),
        hi: metrics(rows.filter((r) => r.lang === "hi"), (r) => r.final),
      },
      beingHarmedRecall: harmed.length ? harmed.filter((r) => r.beingHarmed).length / harmed.length : null,
    },
    misses,
  };

  const dir = path.join(ROOT, "evals/results");
  mkdirSync(dir, { recursive: true });
  const stamp = result.runAt.replace(/[:.]/g, "-");
  writeFileSync(path.join(dir, `${stamp}-risk.json`), JSON.stringify(result, null, 2));
  writeFileSync(path.join(dir, "latest-risk.json"), JSON.stringify(result, null, 2));
  return result;
}

type RecCase = { id: string; lang: "en" | "hi"; expect: string[]; turns: string[] };

const LABEL_TO_ID = Object.fromEntries(Object.entries(HELP_TYPE_LABEL).map(([id, label]) => [label, id]));

// Google AI Studio's free tier allows 15 requests a minute per model, so the
// chain target spaces its calls out instead of tripping the quota and
// measuring fallbacks.
class Throttled implements ChatModel {
  private next = 0;
  constructor(
    private readonly inner: ChatModel,
    private readonly gapMs: number,
  ) {}
  async complete(req: Parameters<ChatModel["complete"]>[0]) {
    const wait = Math.max(0, this.next - Date.now());
    this.next = Math.max(Date.now(), this.next) + this.gapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return this.inner.complete(req);
  }
}

async function chatTarget(target: string): Promise<ChatModel> {
  if (target === "claude-cli") {
    const { ClaudeCliProvider } = await import("@/adapters/chat/cli/claude");
    return new ProviderChain([{ provider: new ClaudeCliProvider("haiku"), timeoutMs: 90_000 }]);
  }
  const keyEnv = { openrouter: "OPEN_ROUTER", google: "GOOGLE_STUDIO", alibaba: "ALIBABA_KEY" } as const;
  const providers = config.providers.chat
    .filter((p) => process.env[keyEnv[p.id]])
    .map((p) => ({ provider: new OpenAICompatibleProvider(p.id, p.model, process.env[keyEnv[p.id]]!), timeoutMs: p.timeoutMs }));
  if (!providers.length) throw new Error("no chat provider key in the environment");
  return new Throttled(new ProviderChain(providers), 5_000);
}

async function runRecommendation(target: string) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY must be set for the recommendation suite");
  const all = (JSON.parse(readFileSync(path.join(ROOT, "evals/cases/recommendation.json"), "utf8")) as { cases: RecCase[] }).cases;
  const only = arg("case", "");
  const cases = only ? all.filter((c) => c.id.startsWith(only)) : all;
  const chat = await chatTarget(target);
  const decision = new JevDecisionModel(config.providers.jev.model, { timeoutMs: 5000, maxRetries: 2, deadlineMs: 20000 });
  const catalogue = new JsonCatalogue();
  const allowed = catalogue.allowedUrls();
  const known = new Set([...therapists.map((x) => x.id), ...services.map((x) => x.id)]);
  const keywordFloor = compileFloor(config.riskKeywords);
  const started = Date.now();
  let usd = 0;

  const rows = await pool(cases, 2, async (c) => {
    const store = new MemorySessionStore();
    let session = await store.create({ adult: true, consent: false });
    const messages: Msg[] = [];
    let reachedAt: number | null = null;
    let final: Final | null = null;
    const replaced: string[] = [];
    let stage = "intake";
    for (let i = 0; i < c.turns.length; i++) {
      messages.push({ role: "user", text: c.turns[i] });
      const out = await runTurn(
        { chat, decision, catalogue, config, keywordFloor, emit: () => {}, signal: AbortSignal.timeout(300_000), now: Date.now },
        { session, messages },
      );
      usd += out.audit.costUsd;
      session = out.session;
      final = out.final;
      stage = final.stage;
      messages.push({ role: "assistant", text: final.reply });
      if (final.replaced) replaced.push(final.replaced.reason);
      if (final.stage === "recommend" || final.stage === "handoff") {
        reachedAt = final.stage === "recommend" ? i + 1 : null;
        break;
      }
    }
    const got = (final?.helpTypes ?? []).map((l) => LABEL_TO_ID[l] ?? l);
    const cards = final?.cards ?? [];
    return {
      id: c.id,
      lang: c.lang,
      expect: c.expect,
      got,
      stage,
      reachedAt,
      helpTypesOk: reachedAt !== null && c.expect.every((e) => got.includes(e)),
      cards: cards.map((x) => x.id),
      cardsValid: cards.every((x) => known.has(x.id) && allowed.has(x.url)),
      replyUrls: messages.filter((m) => m.role === "assistant").some((m) => /https?:\/\/|www\./i.test(m.text)),
      replaced,
    };
  });

  const n = rows.length;
  const result = {
    suite: "recommendation",
    target,
    runAt: new Date().toISOString(),
    cases: n,
    costUsd: Number(usd.toFixed(6)),
    seconds: Math.round((Date.now() - started) / 1000),
    metrics: {
      reachedRecommend: rows.filter((r) => r.reachedAt !== null).length / n,
      helpTypeMatch: rows.filter((r) => r.helpTypesOk).length / n,
      meanTurnsToRecommend:
        rows.filter((r) => r.reachedAt !== null).reduce((a, r) => a + r.reachedAt!, 0) / Math.max(1, rows.filter((r) => r.reachedAt !== null).length),
      hallucinatedCards: rows.filter((r) => !r.cardsValid).length,
      repliesWithLinks: rows.filter((r) => r.replyUrls).length,
      stockFallbackTurns: rows.reduce((a, r) => a + r.replaced.length, 0),
      byLang: {
        en: rows.filter((r) => r.lang === "en" && r.helpTypesOk).length / rows.filter((r) => r.lang === "en").length,
        hi: rows.filter((r) => r.lang === "hi" && r.helpTypesOk).length / rows.filter((r) => r.lang === "hi").length,
      },
    },
    rows,
  };
  const dir = path.join(ROOT, "evals/results");
  mkdirSync(dir, { recursive: true });
  const stamp = result.runAt.replace(/[:.]/g, "-");
  writeFileSync(path.join(dir, `${stamp}-recommendation-${target}.json`), JSON.stringify(result, null, 2));
  writeFileSync(path.join(dir, `latest-recommendation-${target}.json`), JSON.stringify(result, null, 2));
  return result;
}

const pct = (x: number | null) => (x === null ? "  n/a" : `${(x * 100).toFixed(0).padStart(4)}%`);

async function main() {
  const suite = arg("suite", "risk");
  if (suite === "recommendation") {
    const r = await runRecommendation(arg("target", "chain"));
    const m = r.metrics;
    console.log(`recommendation suite (${r.target}): ${r.cases} cases, ${r.seconds}s, $${r.costUsd}`);
    console.log(`reached recommend ${pct(m.reachedRecommend)} · help types match ${pct(m.helpTypeMatch)} (en ${pct(m.byLang.en)}, hi ${pct(m.byLang.hi)}) · mean turns ${m.meanTurnsToRecommend.toFixed(1)}`);
    console.log(`hallucinated cards ${m.hallucinatedCards} · replies with links ${m.repliesWithLinks} · stock-fallback turns ${m.stockFallbackTurns}`);
    for (const row of r.rows.filter((x) => !x.helpTypesOk)) {
      console.log(`miss ${row.id}: expected ${row.expect.join("+")}, got ${row.got.join("+") || "-"} (stage ${row.stage}, replaced ${row.replaced.join(",") || "none"})`);
    }
    return;
  }
  if (suite !== "risk") throw new Error(`unknown suite: ${suite}`);
  const r = await runRisk();
  console.log(`risk suite: ${r.cases} cases, ${r.jevErrors} Jev errors, ${r.seconds}s, $${r.costUsd}, ${r.jevModel}`);
  console.log("                 imminent R/P      elevated R/P      none R/P      any-risk R/P");
  for (const [name, m] of Object.entries({ final: r.metrics.final, floor: r.metrics.keywordFloor, jev: r.metrics.jev, en: r.metrics.byLang.en, hi: r.metrics.byLang.hi })) {
    console.log(
      `${name.padEnd(14)} ${pct(m.imminent.recall)} ${pct(m.imminent.precision)}    ${pct(m.elevated.recall)} ${pct(m.elevated.precision)}    ${pct(m.none.recall)} ${pct(m.none.precision)}    ${pct(m.anyRisk.recall)} ${pct(m.anyRisk.precision)}`,
    );
  }
  console.log(`being-harmed recall: ${pct(r.metrics.beingHarmedRecall)}`);
  for (const m of r.misses) console.log(`miss ${m.id}: label ${m.label}, got ${m.final} (floor ${m.floor}, jev ${m.jev})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
