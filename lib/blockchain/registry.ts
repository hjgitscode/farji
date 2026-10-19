import { Interface, keccak256, toUtf8Bytes } from "ethers";
import abi from "./farji-registry.abi.json";

// FarjiRegistry call encoding and event decoding (pure: no I/O, no clock). The ABI is exported
// from the compiled contract by `npm run chain:abi`, so the app can never drift from the contract.

export const registryInterface = new Interface(abi as never);

/** Solidity `OrgStatus` (NONE = 0 is never sent). */
export const ORG_STATUS_CODE = { ACTIVE: 1, SUSPENDED: 2 } as const;
export type OrgStatusName = keyof typeof ORG_STATUS_CODE;
export const ORG_STATUS_FROM_CODE: Record<number, OrgStatusName> = { 1: "ACTIVE", 2: "SUSPENDED" };

/** Solidity revocation `reasonCode` (matches the Prisma `RevocationReason` enum). */
export const REVOCATION_REASON_CODE = { ISSUED_IN_ERROR: 1, FRAUD: 2, RECORD_CORRECTED: 3, OTHER: 4 } as const;
export type RevocationReasonName = keyof typeof REVOCATION_REASON_CODE;
export const REVOCATION_REASON_FROM_CODE: Record<number, RevocationReasonName> = {
  1: "ISSUED_IN_ERROR",
  2: "FRAUD",
  3: "RECORD_CORRECTED",
  4: "OTHER",
};

/** keccak256(utf8(slug)): public, personal-data-free metadata fingerprint of an Organisation. */
export const metadataHashOf = (slug: string): string => keccak256(toUtf8Bytes(slug));

// ───────────────────────────── calldata encoders ─────────────────────────────

const enc = (fn: string, args: unknown[]) => registryInterface.encodeFunctionData(fn, args);

export const encodeRegisterOrganisation = (orgId: string, metadataHash: string) => enc("registerOrganisation", [orgId, metadataHash]);
export const encodeSetOrganisationStatus = (orgId: string, status: OrgStatusName) => enc("setOrganisationStatus", [orgId, ORG_STATUS_CODE[status]]);
export const encodeAuthoriseIssuerWallet = (orgId: string, wallet: string) => enc("authoriseIssuerWallet", [orgId, wallet]);
export const encodeRetireIssuerWallet = (wallet: string) => enc("retireIssuerWallet", [wallet]);
export const encodeRotateIssuerWallet = (orgId: string, oldWallet: string, newWallet: string) => enc("rotateIssuerWallet", [orgId, oldWallet, newWallet]);
export const encodeMarkCompromised = (wallet: string, compromisedAt: bigint) => enc("markIssuerWalletCompromised", [wallet, compromisedAt]);
export const encodeAnchorCohortRoot = (orgId: string, batchRoot: string, leafCount: number, schemaId: string, expectedPreviousChainRoot: string) =>
  enc("anchorCohortRoot", [orgId, batchRoot, leafCount, schemaId, expectedPreviousChainRoot]);
export const encodeAnchorProofPulseEpoch = (orgId: string, batchRoot: string, rootSeq: bigint, leafCount: number, expectedPreviousChainRoot: string) =>
  enc("anchorProofPulseEpoch", [orgId, batchRoot, rootSeq, leafCount, expectedPreviousChainRoot]);
export const encodeRevokeCredential = (orgId: string, credentialSalt: string, reason: RevocationReasonName) =>
  enc("revokeCredential", [orgId, credentialSalt, REVOCATION_REASON_CODE[reason]]);

// ───────────────────────────── decoding ─────────────────────────────

export type DecodedCall = { name: string; args: Record<string, unknown> };

const norm = (v: unknown): unknown => {
  if (typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v)) return v.toLowerCase();
  return v;
};

function namedArgs(inputs: readonly { name: string }[], values: readonly unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  inputs.forEach((input, i) => {
    out[input.name] = norm(values[i]);
  });
  return out;
}

/** Decodes transaction calldata against the registry ABI; null if it is not a registry function. */
export function decodeRegistryCall(data: string): DecodedCall | null {
  try {
    const parsed = registryInterface.parseTransaction({ data });
    if (!parsed) return null;
    return { name: parsed.name, args: namedArgs(parsed.fragment.inputs, [...parsed.args]) };
  } catch {
    return null;
  }
}

export type LogLike = { address: string; topics: readonly string[]; data: string; index?: number; logIndex?: number };

export type RegistryEvent = { name: string; args: Record<string, unknown>; logIndex: number };

/**
 * Decodes ONLY logs emitted by the configured registry address. Logs from any other contract, and
 * registry logs that are not part of the ABI, are ignored: a chain fact is never taken from an
 * address we did not configure.
 */
export function decodeRegistryLogs(logs: readonly LogLike[], registryAddress: string): RegistryEvent[] {
  const registry = registryAddress.toLowerCase();
  const out: RegistryEvent[] = [];
  logs.forEach((log, i) => {
    if (log.address.toLowerCase() !== registry) return;
    try {
      const parsed = registryInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) return;
      out.push({ name: parsed.name, args: namedArgs(parsed.fragment.inputs, [...parsed.args]), logIndex: log.index ?? log.logIndex ?? i });
    } catch {
      // not a registry event
    }
  });
  return out;
}

export const argStr = (e: { args: Record<string, unknown> }, key: string): string => String(e.args[key]).toLowerCase();
export const argBig = (e: { args: Record<string, unknown> }, key: string): bigint => BigInt(e.args[key] as bigint | number | string);
