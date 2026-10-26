// In-memory RateLimiter for local dev, tests and evals. Same windows and caps
// as the Supabase adapter; `unlimited` turns it into a spend counter for evals.
import { buckets, istDayStart, windowStart, type LimitCaps } from "@/core/limits";
import type { LimitResult, RateLimiter, Who } from "@/core/ports";

export class MemoryRateLimiter implements RateLimiter {
  private readonly amounts = new Map<string, number>();
  spentUsd = 0;

  constructor(
    private readonly caps: LimitCaps,
    private readonly now: () => number = Date.now,
    private readonly unlimited = false,
  ) {}

  consume(bucket: string, window: Date, add: number, cap: number): boolean {
    const key = `${bucket}@${window.toISOString()}`;
    const next = (this.amounts.get(key) ?? 0) + add;
    if (!this.unlimited && next > cap) return false;
    this.amounts.set(key, next);
    return true;
  }

  async startConversation(who: Who): Promise<LimitResult> {
    const day = istDayStart(this.now());
    const ok =
      this.consume(buckets.convIp(who.ipHash), day, 1, this.caps.conversationsPerDay) &&
      this.consume(buckets.convReviewer(who.reviewerHash), day, 1, this.caps.conversationsPerDay);
    return ok ? { ok: true } : { ok: false, kind: "daily_conversations" };
  }

  async startTurn(who: Who): Promise<LimitResult> {
    if (!this.consume(buckets.spend, istDayStart(this.now()), 0, this.caps.spendPerDayUsd)) return { ok: false, kind: "spend" };
    const hour = windowStart(this.now(), 60);
    const ok =
      this.consume(buckets.turnIp(who.ipHash), hour, 1, this.caps.turnsPerHour) &&
      this.consume(buckets.turnReviewer(who.reviewerHash), hour, 1, this.caps.turnsPerHour);
    return ok ? { ok: true } : { ok: false, kind: "hourly_turns" };
  }

  async addSpend(usd: number) {
    this.spentUsd += usd;
    this.consume(buckets.spend, istDayStart(this.now()), usd, Number.MAX_SAFE_INTEGER);
  }
}
