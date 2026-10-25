// Reviewer access (design D1 to D6): any email plus one shared key, a signed
// 7-day cookie whose signing key derives from the access key, and a keyed hash
// of the email in place of the email itself.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const AUTH_COOKIE = "ss_auth";
export const SID_COOKIE = "ss_sid";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

// A per-process random key, so both sides of the comparison are equal-length
// digests and neither the key nor its length leaks through timing.
const compareKey = randomBytes(32);

export function accessKeyMatches(given: string): boolean {
  return timingSafeEqual(hmac(compareKey, given), hmac(compareKey, env("DEMO_ACCESS_KEY")));
}

export function reviewerHash(email: string): string {
  return hmac(env("EMAIL_HASH_SECRET"), email.trim().toLowerCase()).toString("hex");
}

function signingKey(): Buffer {
  return hmac(env("AUTH_COOKIE_SECRET"), env("DEMO_ACCESS_KEY"));
}

export function signAuthCookie(rh: string, days: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ rh, exp: now + days * 86_400_000 })).toString("base64url");
  const sig = hmac(signingKey(), payload).toString("base64url");
  return `${payload}.${sig}`;
}

export function verifyAuthCookie(value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(signingKey(), payload);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { rh, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { rh?: unknown; exp?: unknown };
    if (typeof rh !== "string" || typeof exp !== "number" || exp < now) return null;
    return rh;
  } catch {
    return null;
  }
}

// The first line of every protected route and of the `/` page (D5).
export async function requireReviewer(): Promise<string | null> {
  return verifyAuthCookie((await cookies()).get(AUTH_COOKIE)?.value);
}

export const secureCookies = process.env.NODE_ENV === "production";
