import { cookies } from "next/headers";
import { z } from "zod";
import { config } from "@config";
import { buckets, windowStart } from "@/core/limits";
import { consume } from "@/adapters/supabase/limiter";
import { clientIp, ipHash } from "@/app/lib/ip";
import {
  AUTH_COOKIE,
  accessKeyMatches,
  reviewerHash,
  secureCookies,
  signAuthCookie,
} from "@/app/lib/reviewer";

const Body = z.strictObject({
  email: z.email().max(254),
  accessKey: z.string().min(1).max(200),
});

// Local dev never touches the production limits table; an in-process counter
// stands in for it.
const localAttempts = new Map<string, number>();

async function countAttempt(bucket: string, window: Date, cap: number): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return consume(bucket, window, 1, cap);
  const key = `${bucket}@${window.toISOString()}`;
  const n = (localAttempts.get(key) ?? 0) + 1;
  localAttempts.set(key, n);
  return n <= cap;
}

// Every attempt counts against the IP before the key is checked, success or
// not, so the shared key can't be brute-forced from one IP (D4).
export async function POST(req: Request) {
  const { loginAttempts, loginWindowMinutes, loginDays } = config.limits;
  const now = Date.now();
  const window = windowStart(now, loginWindowMinutes);
  let allowed: boolean;
  try {
    allowed = await countAttempt(buckets.login(ipHash(clientIp(req.headers), now)), window, loginAttempts);
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!allowed) {
    const retryAfter = Math.ceil((window.getTime() + loginWindowMinutes * 60_000 - now) / 1000);
    return Response.json({ error: "too_many_tries", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!accessKeyMatches(parsed.data.accessKey)) {
    return Response.json({ error: "wrong_key" }, { status: 401 });
  }
  (await cookies()).set(AUTH_COOKIE, signAuthCookie(reviewerHash(parsed.data.email), loginDays), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: loginDays * 86_400,
  });
  return new Response(null, { status: 204 });
}
