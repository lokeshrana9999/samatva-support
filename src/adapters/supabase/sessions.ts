// SessionStore over the `sessions` table, with an optimistic version check so
// two concurrent turns on one conversation can't both write.
import { randomUUID } from "node:crypto";
import type { SessionStore } from "@/core/ports";
import type { SessionState } from "@/core/types";
import { supabase } from "./client";

type Row = {
  id: string;
  stage: SessionState["stage"];
  risk_floor: SessionState["riskFloor"];
  user_turns: number;
  understand_turns: number;
  being_harmed: boolean;
  transcript_consent: boolean;
  history_mac: string | null;
  version: number;
};

const COLUMNS =
  "id, stage, risk_floor, user_turns, understand_turns, being_harmed, transcript_consent, history_mac, version";

function fromRow(r: Row): SessionState {
  return {
    id: r.id,
    stage: r.stage,
    riskFloor: r.risk_floor,
    userTurns: r.user_turns,
    understandTurns: r.understand_turns,
    beingHarmed: r.being_harmed,
    transcriptConsent: r.transcript_consent,
    historyMac: r.history_mac,
    version: r.version,
  };
}

export class SupabaseSessionStore implements SessionStore {
  async create(init: { adult: true; consent: boolean }): Promise<SessionState> {
    const { data, error } = await supabase()
      .from("sessions")
      .insert({ id: randomUUID(), stage: "intake", transcript_consent: init.consent })
      .select(COLUMNS)
      .single<Row>();
    if (error) throw new Error(`sessions.create: ${error.message}`);
    return fromRow(data);
  }

  async load(id: string) {
    const { data, error } = await supabase().from("sessions").select(COLUMNS).eq("id", id).maybeSingle<Row>();
    if (error) throw new Error(`sessions.load: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async save(s: SessionState): Promise<"ok" | "conflict"> {
    const { data, error } = await supabase()
      .from("sessions")
      .update({
        stage: s.stage,
        risk_floor: s.riskFloor,
        user_turns: s.userTurns,
        understand_turns: s.understandTurns,
        being_harmed: s.beingHarmed,
        history_mac: s.historyMac,
        version: s.version + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", s.id)
      .eq("version", s.version)
      .select("id");
    if (error) throw new Error(`sessions.save: ${error.message}`);
    return data && data.length === 1 ? "ok" : "conflict";
  }

  async delete(id: string) {
    const { error } = await supabase().from("sessions").delete().eq("id", id);
    if (error) throw new Error(`sessions.delete: ${error.message}`);
  }
}
