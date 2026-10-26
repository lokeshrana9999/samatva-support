// The caller's IP, hashed with the IST date folded in, so no plain IP is ever
// stored and today's hash can't be linked to yesterday's (D35).
import "server-only";
import { createHmac } from "node:crypto";
import { istDate } from "@/core/limits";

export function clientIp(headers: Headers): string {
  // Vercel puts the client first in x-forwarded-for.
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

export function ipHash(ip: string, now = Date.now()): string {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error("IP_HASH_SECRET must be set");
  return createHmac("sha256", secret).update(`${ip}:${istDate(now)}`).digest("hex");
}
