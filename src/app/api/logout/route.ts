import { cookies } from "next/headers";
import { AUTH_COOKIE, SID_COOKIE } from "@/app/lib/reviewer";

// Needs no valid cookie, so a stale one can always be cleared (D6).
export async function POST() {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
  jar.delete(SID_COOKIE);
  return new Response(null, { status: 204 });
}
