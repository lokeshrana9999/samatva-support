// AuditLog over `audit_events`. Written after the response (D15), so a failed
// write is logged and dropped rather than failing the turn.
import type { AuditLog } from "@/core/ports";
import { supabase } from "./client";

export class SupabaseAuditLog implements AuditLog {
  async record(e: Parameters<AuditLog["record"]>[0]) {
    const { error } = await supabase().from("audit_events").insert({
      session_id: e.sessionId,
      reviewer_hash: e.reviewerHash,
      turn: e.turn,
      stage_in: e.stageIn,
      stage_out: e.stageOut,
      risk_keyword: e.riskKeyword,
      keyword_pattern: e.keywordPattern,
      risk_jev: e.riskJev,
      risk_jev_p: e.riskJevP,
      risk_final: e.riskFinal,
      filter_violations: e.filterViolations,
      regenerated: e.regenerated,
      stock_fallback: e.stockFallback,
      tools: e.tools,
      tool_rejected: e.toolRejected,
      provider: e.provider,
      model: e.model,
      jev_model: e.jevModel,
      tokens_in: e.tokensIn,
      tokens_out: e.tokensOut,
      cost_usd: e.costUsd,
      latency_ms: e.latencyMs,
      outcome: e.outcome,
    });
    if (error) console.error("[audit] write failed:", error.message);
  }
}
