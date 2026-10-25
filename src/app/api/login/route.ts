import { cookies } from "next/headers";
import { z } from "zod";
import { config } from "@config";
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

// Step 1 has no `limits` table yet, so the 10-per-15-minutes login cap (D4)
// lands in step 5. The access key is 32 random bytes, out of brute-force reach.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!accessKeyMatches(parsed.data.accessKey)) {
    return Response.json({ error: "wrong_key" }, { status: 401 });
  }
  const days = config.limits.loginDays;
  (await cookies()).set(AUTH_COOKIE, signAuthCookie(reviewerHash(parsed.data.email), days), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: days * 86_400,
  });
  return new Response(null, { status: 204 });
}
