import { describe, expect, it } from "vitest";
import { getHealthStatus } from "@/lib/core/health";

describe("health", () => {
  it("reports ok for the farji service", () => {
    expect(getHealthStatus()).toEqual({ status: "ok", service: "farji" });
  });
});
