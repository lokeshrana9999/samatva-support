import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DEMO_ACCESS_KEY = "test-access-key";
  process.env.AUTH_COOKIE_SECRET = "test-cookie-secret";
  process.env.EMAIL_HASH_SECRET = "test-email-secret";
  process.env.HISTORY_MAC_SECRET = "test-mac-secret";
});

describe("reviewer access", async () => {
  const r = await import("@/app/lib/reviewer");

  it("accepts only the exact key", () => {
    expect(r.accessKeyMatches("test-access-key")).toBe(true);
    expect(r.accessKeyMatches("test-access-ke")).toBe(false);
    expect(r.accessKeyMatches("")).toBe(false);
  });

  it("hashes the email case- and space-insensitively, never returning it", () => {
    const h = r.reviewerHash(" Asha@Example.com ");
    expect(h).toBe(r.reviewerHash("asha@example.com"));
    expect(h).not.toContain("asha");
  });

  it("round-trips a signed cookie and rejects tampering and expiry", () => {
    const now = 1_000_000;
    const c = r.signAuthCookie("abc", 7, now);
    expect(r.verifyAuthCookie(c, now)).toBe("abc");
    expect(r.verifyAuthCookie(c, now + 8 * 86_400_000)).toBeNull();
    const [payload, sig] = c.split(".");
    expect(r.verifyAuthCookie(`${payload}x.${sig}`, now)).toBeNull();
    expect(r.verifyAuthCookie(undefined, now)).toBeNull();
  });

  it("revokes every cookie when the access key rotates", () => {
    const c = r.signAuthCookie("abc", 7);
    process.env.DEMO_ACCESS_KEY = "rotated";
    expect(r.verifyAuthCookie(c)).toBeNull();
    process.env.DEMO_ACCESS_KEY = "test-access-key";
  });
});

describe("history MAC", async () => {
  const { historyMac } = await import("@/app/lib/history-mac");

  it("is null for no messages and changes with any edit", () => {
    expect(historyMac([])).toBeNull();
    const a = historyMac([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
    const b = historyMac([{ role: "user", text: "hi" }, { role: "assistant", text: "hello!" }]);
    const c = historyMac([{ role: "assistant", text: "hi" }, { role: "assistant", text: "hello" }]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
