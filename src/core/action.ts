// The typed JSON action every provider and CLI returns (spec 5e). Step 1 has
// no tool-using stage, so `tool` and `show` are parsed but unused until step 3.
import { z } from "zod";

const ToolCall = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("search_therapists"), args: z.record(z.string(), z.unknown()) }),
  z.strictObject({ name: z.literal("search_services"), args: z.record(z.string(), z.unknown()) }),
]);

export const Action = z.strictObject({
  reply: z.string().max(1200),
  tool: ToolCall.optional(),
  show: z.array(z.string()).max(5).optional(),
});

export type Action = z.infer<typeof Action>;

// Models wrap JSON in prose or code fences often enough that the parser takes
// the outermost {...} span before handing it to zod.
export function parseAction(text: string): { ok: true; action: Action } | { ok: false; error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "no JSON object in the reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  const parsed = Action.safeParse(raw);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  return { ok: true, action: parsed.data };
}
