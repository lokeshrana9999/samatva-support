// The tamper-evident history chain (design D8): mac_n = HMAC(secret,
// mac_{n-1} || role || text). The server stores only the latest MAC, never the
// text, and each turn checks the client's history against it.
import "server-only";
import { createHmac } from "node:crypto";
import type { Msg } from "@/core/types";

export function historyMac(messages: Msg[], secret = process.env.HISTORY_MAC_SECRET): string | null {
  if (!secret) throw new Error("HISTORY_MAC_SECRET must be set");
  let mac: string | null = null;
  for (const m of messages) {
    mac = createHmac("sha256", secret)
      .update(`${mac ?? ""}\u0000${m.role}\u0000${m.text}`)
      .digest("hex");
  }
  return mac;
}
