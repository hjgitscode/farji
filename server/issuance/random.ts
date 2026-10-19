import { randomBytes } from "node:crypto";

/** 32 cryptographically secure random bytes as a lowercase 0x string (salts and nonces). */
export function randomBytes32(): string {
  return "0x" + randomBytes(32).toString("hex");
}
