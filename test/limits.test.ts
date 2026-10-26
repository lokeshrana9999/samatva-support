import { describe, expect, it } from "vitest";
import { config } from "@config";
import { JsonCatalogue } from "@/adapters/catalogue/json";
import { MemoryRateLimiter } from "@/adapters/memory/limiter";
import { MemorySessionStore } from "@/adapters/memory/sessions";
import { MemoryTranscriptStore } from "@/adapters/memory/transcripts";
import { compileFloor } from "@/core/gates/keyword-floor";
import { istDate, istDayStart, windowStart } from "@/core/limits";
import { EMPTY_NEEDS } from "@/core/needs";
import type { ChatModel, DecisionModel, LimitResult, RateLimiter } from "@/core/ports";
import { runTurn } from "@/core/turn";
import type { SessionState } from "@/core/types";

const usage = { inputTokens: 1, outputTokens: 1, usd: 0 };
const who = { ipHash: "ip-1", reviewerHash: "rv-1" };
const caps = { conversationsPerDay: 5, turnsPerHour: 30, spendPerDayUsd: 5 };

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: "s1",
  stage: "intake",
  riskFloor: "none",
  userTurns: 0,
  understandTurns: 0,
  beingHarmed: false,
  transcriptConsent: false,
  historyMac: null,
  needs: null,
  version: 0,
  ...over,
});

const chat: ChatModel & { calls: number } = {
  calls: 0,
  async complete() {
    this.calls++;
    return { action: { reply: "What has been hardest?" }, provider: "fake", model: "fake", usage, providersTried: ["fake"] };
  },
};

const gate = (imminentP = 0.01): DecisionModel => ({
  async assessRisk() {
    return { p: { none: 1 - imminentP, elevated: 0, imminent: imminentP }, selfHarm: 0, harmToOthers: 0, beingHarmed: 0, model: "jev-test", usage };
  },
  async extractNeeds() {
    return { needs: EMPTY_NEEDS, model: "jev-test", usage };
  },
  async checkReply() {
    return { diagnosis: 0, medicalAdvice: 0, claimsHuman: 0, model: "jev-test", usage };
  },
});

const refusing = (kind: "daily_conversations" | "hourly_turns" | "spend"): RateLimiter => ({
  async startConversation(): Promise<LimitResult> {
    return kind === "daily_conversations" ? { ok: false, kind } : { ok: true };
  },
  async startTurn(): Promise<LimitResult> {
    return kind === "daily_conversations" ? { ok: true } : { ok: false, kind };
  },
  async addSpend() {},
});

const deps = (limiter: RateLimiter, decision = gate()) => ({
  chat,
  decision,
  catalogue: new JsonCatalogue(),
  limiter,
  config,
  keywordFloor: compileFloor(config.riskKeywords),
  emit: () => {},
  signal: new AbortController().signal,
  now: () => 0,
});

describe("limit windows", () => {
  it("starts the day at IST midnight", () => {
    // 2026-10-26 20:00 UTC is 01:30 IST on the 27th.
    const t = Date.UTC(2026, 9, 26, 20, 0);
    expect(istDayStart(t).toISOString()).toBe("2026-10-26T18:30:00.000Z");
    expect(istDate(t)).toBe("2026-10-27");
    expect(windowStart(Date.UTC(2026, 9, 26, 20, 47), 15).toISOString()).toBe("2026-10-26T20:45:00.000Z");
  });
});

describe("memory limiter", () => {
  it("caps conversations per day and turns per hour, per IP and per reviewer", async () => {
    const l = new MemoryRateLimiter(caps, () => Date.UTC(2026, 9, 26, 6));
    for (let i = 0; i < 5; i++) expect((await l.startConversation(who)).ok).toBe(true);
    expect(await l.startConversation(who)).toEqual({ ok: false, kind: "daily_conversations" });
    // Same reviewer from another IP is still capped.
    expect((await l.startConversation({ ipHash: "ip-2", reviewerHash: "rv-1" })).ok).toBe(false);
    for (let i = 0; i < 30; i++) expect((await l.startTurn(who)).ok).toBe(true);
    expect(await l.startTurn(who)).toEqual({ ok: false, kind: "hourly_turns" });
  });

  it("stops new turns once the day's spend passes the cap", async () => {
    const l = new MemoryRateLimiter(caps, () => Date.UTC(2026, 9, 26, 6));
    await l.addSpend(5.01);
    expect(await l.startTurn(who)).toEqual({ ok: false, kind: "spend" });
  });
});

describe("caps in the turn", () => {
  it("returns the limit reply without calling the chat model", async () => {
    chat.calls = 0;
    const { final } = await runTurn(deps(refusing("spend")), { session: session({ stage: "understand", userTurns: 2 }), messages: [{ role: "user", text: "hi" }], who });
    expect(final.limit).toEqual({ kind: "spend" });
    expect(final.reply).toBe(config.stockLines.limits.spend["en-IN"]);
    expect(final.crisisLines.length).toBeGreaterThan(0);
    expect(chat.calls).toBe(0);
  });

  it("counts a conversation only on its first turn", async () => {
    const { final } = await runTurn(deps(refusing("daily_conversations")), { session: session(), messages: [{ role: "user", text: "hi" }], who });
    expect(final.limit).toEqual({ kind: "daily_conversations" });
    const later = await runTurn(deps(refusing("daily_conversations")), { session: session({ stage: "understand", userTurns: 1 }), messages: [{ role: "user", text: "hi" }], who });
    expect(later.final.limit).toBeNull();
  });

  it("never caps the keyword handoff", async () => {
    const { final } = await runTurn(deps(refusing("spend")), { session: session(), messages: [{ role: "user", text: "I want to kill myself" }], who });
    expect(final.stage).toBe("handoff");
    expect(final.limit).toBeNull();
  });

  it("never caps a handoff Jev finds when the keywords miss", async () => {
    const { final } = await runTurn(deps(refusing("hourly_turns"), gate(0.9)), { session: session({ stage: "understand", userTurns: 3 }), messages: [{ role: "user", text: "I've written letters to everyone and it's time" }], who });
    expect(final.stage).toBe("handoff");
    expect(final.limit).toBeNull();
  });

  it("never caps a conversation already in handoff", async () => {
    const { final } = await runTurn(deps(refusing("spend")), { session: session({ stage: "handoff", userTurns: 4 }), messages: [{ role: "user", text: "ok" }], who });
    expect(final.stage).toBe("handoff");
    expect(final.limit).toBeNull();
  });
});

describe("transcripts", () => {
  it("stores rows only for a session that consented", async () => {
    const sessions = new MemorySessionStore();
    const yes = await sessions.create({ adult: true, consent: true });
    const no = await sessions.create({ adult: true, consent: false });
    const t = new MemoryTranscriptStore(async (id) => (await sessions.load(id))?.transcriptConsent === true);
    const rows = [{ seq: 0, role: "user" as const, text: "hi" }, { seq: 1, role: "assistant" as const, text: "hello" }];
    await t.append(yes.id, rows);
    await t.append(no.id, rows);
    expect(t.rows.get(yes.id)).toHaveLength(2);
    expect(t.rows.has(no.id)).toBe(false);
    await t.deleteSession(yes.id);
    expect(t.rows.has(yes.id)).toBe(false);
  });
});
