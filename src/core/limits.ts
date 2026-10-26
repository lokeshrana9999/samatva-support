// Limit windows, shared by every RateLimiter adapter. The day boundary is IST
// midnight because the users are in India (design, limits).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDayStart(now: number): Date {
  const ist = now + IST_OFFSET_MS;
  return new Date(ist - (ist % 86_400_000) - IST_OFFSET_MS);
}

export function windowStart(now: number, minutes: number): Date {
  const size = minutes * 60_000;
  return new Date(now - (now % size));
}

// The IST calendar date, folded into the IP hash so it rotates daily (D35).
export function istDate(now: number): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type LimitCaps = { conversationsPerDay: number; turnsPerHour: number; spendPerDayUsd: number };

export const buckets = {
  convIp: (h: string) => `conv:ip:${h}`,
  convReviewer: (h: string) => `conv:r:${h}`,
  turnIp: (h: string) => `turn:ip:${h}`,
  turnReviewer: (h: string) => `turn:r:${h}`,
  spend: "spend:global",
  login: (h: string) => `login:${h}`,
};
