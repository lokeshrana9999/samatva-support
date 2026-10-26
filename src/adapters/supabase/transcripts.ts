// TranscriptStore over `transcripts`. append_transcript inserts only when the
// session's consent is true, so consent holds in the database too.
import type { TranscriptRow, TranscriptStore } from "@/core/ports";
import { supabase } from "./client";

export class SupabaseTranscriptStore implements TranscriptStore {
  async append(sessionId: string, rows: TranscriptRow[]) {
    const { error } = await supabase().rpc("append_transcript", { p_session: sessionId, p_rows: rows });
    if (error) console.error("[transcripts] append failed:", error.message);
  }

  async deleteSession(sessionId: string) {
    const { error } = await supabase().from("transcripts").delete().eq("session_id", sessionId);
    if (error) throw new Error(`transcripts.delete: ${error.message}`);
  }
}
