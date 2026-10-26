import { describe, expect, it } from "vitest";
import { filterReply } from "@/core/gates/output-filter";
import { codePoints, detectLang } from "@/core/text";
import { parseAction } from "@/core/action";

const base = { lengthCap: 400, allowedUrls: new Set<string>(), knownNames: new Set<string>() };

describe("output filter", () => {
  it("passes a plain reflection", () => {
    expect(filterReply({ ...base, reply: "That sounds like a lot. What has been hardest this week?" }).violation).toBeNull();
  });

  it("blocks a reply over the cap, counted in code points", () => {
    expect(filterReply({ ...base, lengthCap: 3, reply: "😀😀😀" }).violation).toBeNull();
    expect(filterReply({ ...base, lengthCap: 3, reply: "😀😀😀😀" }).violation).toBe("length");
  });

  it("blocks a link or bare domain not on the allowlist", () => {
    expect(filterReply({ ...base, reply: "Try https://example.com/help" }).violation).toBe("link");
    expect(filterReply({ ...base, reply: "see betterhelp.com" }).violation).toBe("link");
    expect(
      filterReply({ ...base, allowedUrls: new Set(["https://www.amahahealth.com/x"]), reply: "amahahealth.com/x" }).violation,
    ).toBeNull();
  });

  it("blocks an honorific with a name not in the catalogue", () => {
    expect(filterReply({ ...base, reply: "You could see Dr. Mehta." }).violation).toBe("name");
    expect(filterReply({ ...base, knownNames: new Set(["Dr. Asha Mehta"]), reply: "Dr. Mehta" }).violation).toBeNull();
  });
});

describe("text helpers", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePoints("नमस्ते")).toBe(6);
    expect(codePoints("😀")).toBe(1);
  });

  it("detects Hinglish from two marker words", () => {
    expect(detectLang("mujhe bahut stress ho raha hai")).toBe("hi-Latn");
    expect(detectLang("I have been very stressed at work")).toBe("en-IN");
  });
});

describe("action parsing", () => {
  it("takes the JSON object out of fenced or chatty output", () => {
    const r = parseAction('Sure!\n```json\n{"reply": "What happened?"}\n```');
    expect(r).toEqual({ ok: true, action: { reply: "What happened?" } });
  });

  it("rejects extra keys and non-JSON", () => {
    expect(parseAction('{"reply": "x", "stage": "recommend"}').ok).toBe(false);
    expect(parseAction("no json here").ok).toBe(false);
  });
});

describe("action shape", () => {
  it("accepts a tool call with no reply, and rejects an empty reply without a tool", () => {
    const tool = parseAction('{"tool": {"name": "search_services", "args": {"helpTypes": ["therapist"]}}}');
    expect(tool.ok).toBe(true);
    expect(parseAction('{"reply": "  "}').ok).toBe(false);
    expect(parseAction("{}").ok).toBe(false);
  });
});
