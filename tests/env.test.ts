import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/lib/core/env";

describe("parseEnv", () => {
  it("falls back to the local default URL", () => {
    expect(parseEnv({}).appUrl).toBe("http://localhost:3000");
  });

  it("accepts a valid https URL", () => {
    expect(parseEnv({ NEXT_PUBLIC_APP_URL: "https://farji.example" }).appUrl).toBe(
      "https://farji.example",
    );
  });

  it("rejects an invalid URL", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).toThrow(EnvValidationError);
  });

  it("rejects non-http protocols", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: "ftp://x.example" })).toThrow(EnvValidationError);
  });
});
