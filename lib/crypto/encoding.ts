import { isIsoDate } from "@/lib/core/claims";

// Strict value normalisation. Everything that is hashed or signed passes through here, so the
// same input yields the same bytes on every machine. Pure.

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lowercase 0x + 64 hex characters only (no checksum casing, no short forms). */
export const isBytes32 = (v: unknown): v is string => typeof v === "string" && BYTES32.test(v);
export const isLowerAddress = (v: unknown): v is string => typeof v === "string" && ADDRESS.test(v);

/** The 16 raw bytes of an internal user UUID, as the ABI type `bytes16` (`0x` + 32 hex). */
export function uuidToBytes16(uuid: string): string {
  const u = uuid.toLowerCase();
  if (!UUID.test(u)) throw new Error("Invalid UUID");
  return "0x" + u.replaceAll("-", "");
}

/** Unix seconds (as bigint) of a Date. The Date must be a whole second: DB values are written that way. */
export function dateToUnixSeconds(date: Date): bigint {
  const ms = date.getTime();
  if (!Number.isFinite(ms) || ms < 0 || ms % 1000 !== 0) throw new Error("Timestamp must be a whole second");
  return BigInt(ms / 1000);
}

/** `now` truncated to whole seconds. */
export function nowSeconds(now: Date): bigint {
  return BigInt(Math.floor(now.getTime() / 1000));
}

export function unixSecondsToDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

/** Start of a strict `YYYY-MM-DD` calendar date (00:00:00 UTC) as unix seconds. */
export function isoDateToUnixSeconds(iso: string): bigint {
  if (!isIsoDate(iso)) throw new Error("Invalid ISO date");
  return BigInt(Date.parse(`${iso}T00:00:00.000Z`) / 1000);
}
