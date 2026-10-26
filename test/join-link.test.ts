import { describe, expect, it } from "vitest";
import { keyFromHash, retryMinutes } from "@/app/join/link";

describe("magic link fragment", () => {
  it("reads k with or without the leading #", () => {
    expect(keyFromHash("#k=abc_DEF-123")).toBe("abc_DEF-123");
    expect(keyFromHash("k=abc")).toBe("abc");
  });

  it("finds k among other fragment params", () => {
    expect(keyFromHash("#utm=x&k=abc&y=1")).toBe("abc");
  });

  it("percent-decodes the key and keeps '+' literal", () => {
    expect(keyFromHash("#k=a%2Bb%2Fc%3D")).toBe("a+b/c=");
    expect(keyFromHash("#k=a+b")).toBe("a+b");
  });

  it("returns null when k is missing, empty or malformed", () => {
    expect(keyFromHash("")).toBeNull();
    expect(keyFromHash("#")).toBeNull();
    expect(keyFromHash("#key=abc")).toBeNull();
    expect(keyFromHash("#k")).toBeNull();
    expect(keyFromHash("#k=")).toBeNull();
    expect(keyFromHash("#k=%20")).toBeNull();
    expect(keyFromHash("#k=%E0%A4%A")).toBeNull();
  });

  it("rejects a key over the login route's 200-character limit", () => {
    expect(keyFromHash(`#k=${"a".repeat(200)}`)).toBe("a".repeat(200));
    expect(keyFromHash(`#k=${"a".repeat(201)}`)).toBeNull();
  });
});

describe("retry minutes", () => {
  it("rounds Retry-After seconds up to whole minutes, at least 1", () => {
    expect(retryMinutes("1")).toBe(1);
    expect(retryMinutes("60")).toBe(1);
    expect(retryMinutes("61")).toBe(2);
    expect(retryMinutes("900")).toBe(15);
  });

  it("falls back to the 15-minute window when the header is missing or junk", () => {
    expect(retryMinutes(null)).toBe(15);
    expect(retryMinutes("soon")).toBe(15);
    expect(retryMinutes("0")).toBe(15);
  });
});
