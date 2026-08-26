import { issuerKeyHistory } from "@/lib/mock-data/issuerKeys";
import { credentials } from "@/lib/mock-data/credentials";
import type { IssuerKeyRecord, Credential } from "@/lib/mock-data/types";

export function getIssuerKeyHistory(organisationId?: string): IssuerKeyRecord[] {
  if (!organisationId) return issuerKeyHistory;
  return issuerKeyHistory.filter((r) => r.organisationId === organisationId);
}

/**
 * Mirrors the on-chain `isIssuerValidAt` view the Solidity contract will
 * expose from Phase 7 onward: was this wallet an authorised issuer at the
 * given point in time? This is what lets a credential signed before a key
 * rotation stay valid even after that key is later revoked.
 */
export function isIssuerValidAt(wallet: string, atDate: string): boolean {
  const record = issuerKeyHistory.find((r) => r.wallet === wallet);
  if (!record) return false;
  const at = new Date(atDate).getTime();
  const from = new Date(record.validFrom).getTime();
  const until = record.validUntil ? new Date(record.validUntil).getTime() : null;
  if (at < from) return false;
  if (until !== null && at >= until) return false;
  return true;
}

export function getPendingCredentials(): Credential[] {
  return credentials.filter((c) => c.state === "PENDING");
}

/** The wallet currently authorised to sign on behalf of an organisation, if any. */
export function getActiveIssuerWallet(organisationId: string): IssuerKeyRecord | undefined {
  return issuerKeyHistory.find((r) => r.organisationId === organisationId && r.status === "ACTIVE");
}
