import { cookies } from "next/headers";
import { deps } from "@/composition";
import { SID_COOKIE, requireReviewer } from "@/app/lib/reviewer";

// "Delete my conversation": removes any consented transcript and the session
// row, and clears `ss_sid`. 204 whether or not anything was stored.
export async function DELETE() {
  if (!(await requireReviewer())) return Response.json({ error: "login_required" }, { status: 401 });
  const jar = await cookies();
  const sid = jar.get(SID_COOKIE)?.value;
  if (sid) {
    try {
      const d = await deps();
      await d.transcripts.deleteSession(sid);
      await d.sessions.delete(sid);
    } catch {
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
  }
  jar.delete(SID_COOKIE);
  return new Response(null, { status: 204 });
}
