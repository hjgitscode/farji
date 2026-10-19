import { DomainError } from "@/server/candidate/errors";

// Plain, JSON-safe results for the wallet Server Actions (no bigint, no internals).

export type Fail = { ok: false; error: string };

export function toFail(e: unknown): Fail {
  if (e instanceof DomainError) {
    const detail = Object.values(e.fieldErrors)[0];
    return { ok: false, error: detail && detail !== e.message ? `${e.message} ${detail}` : e.message };
  }
  const message = e instanceof Error ? e.message : "";
  // Missing configuration is an operator problem, not a user error; say so without leaking details.
  if (/FARJI_(CHAIN_ID|REGISTRY_ADDRESS|RPC_URL)|FARJI_FINALITY/.test(message)) {
    return { ok: false, error: "Blockchain features are not configured on this server." };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

export function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function unixSeconds(value: unknown, field: string): bigint {
  if (typeof value === "string" && /^[0-9]{1,15}$/.test(value)) return BigInt(value);
  throw new DomainError("VALIDATION", `${field} must be unix seconds.`, { [field]: `${field} must be unix seconds.` });
}
