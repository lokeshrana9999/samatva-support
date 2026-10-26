// RateLimiter over the `limits` table and its consume_limit function: one
// atomic upsert per bucket that both checks the cap and adds (D36).
import { buckets, istDayStart, windowStart, type LimitCaps } from "@/core/limits";
import type { LimitResult, RateLimiter, Who } from "@/core/ports";
import { supabase } from "./client";

export async function consume(bucket: string, window: Date, add: number, cap: number): Promise<boolean> {
  const { data, error } = await supabase().rpc("consume_limit", {
    p_bucket: bucket,
    p_window: window.toISOString(),
    p_add: add,
    p_cap: cap,
  });
  if (error) throw new Error(`limits: ${error.message}`);
  return data === true;
}

export class SupabaseRateLimiter implements RateLimiter {
  constructor(
    private readonly caps: LimitCaps,
    private readonly now: () => number = Date.now,
  ) {}

  async startConversation(who: Who): Promise<LimitResult> {
    const day = istDayStart(this.now());
    const ip = await consume(buckets.convIp(who.ipHash), day, 1, this.caps.conversationsPerDay);
    const rv = ip && (await consume(buckets.convReviewer(who.reviewerHash), day, 1, this.caps.conversationsPerDay));
    return ip && rv ? { ok: true } : { ok: false, kind: "daily_conversations" };
  }

  async startTurn(who: Who): Promise<LimitResult> {
    // Spend is checked with a zero add, then counted after the turn, so a day
    // can overshoot by the turns in flight: a few cents at most.
    if (!(await consume(buckets.spend, istDayStart(this.now()), 0, this.caps.spendPerDayUsd))) {
      return { ok: false, kind: "spend" };
    }
    const hour = windowStart(this.now(), 60);
    const ip = await consume(buckets.turnIp(who.ipHash), hour, 1, this.caps.turnsPerHour);
    const rv = ip && (await consume(buckets.turnReviewer(who.reviewerHash), hour, 1, this.caps.turnsPerHour));
    return ip && rv ? { ok: true } : { ok: false, kind: "hourly_turns" };
  }

  async addSpend(usd: number) {
    if (usd > 0) await consume(buckets.spend, istDayStart(this.now()), usd, Number.MAX_SAFE_INTEGER);
  }
}
