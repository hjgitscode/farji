"use server";

import { revalidatePath } from "next/cache";
import { requireIssuer } from "@/lib/auth/guards";
import type { TxPurpose } from "@/lib/database/generated/client";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { ISSUER_PURPOSES, type ActionParams } from "@/server/chain/actions";
import { getChain } from "@/server/chain/context";
import { toFail, str, type Fail } from "@/server/chain/results";
import { syncTransaction } from "@/server/chain/sync";
import { buildTransaction, recordSubmittedTransaction } from "@/server/chain/transactions";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import { acceptWalletBinding, prepareWalletBinding } from "@/server/issuance/wallet-binding";
import { sealCohortBatch } from "@/server/merkle/cohort";
import { enqueuePendingForOrganisation } from "@/server/merkle/enqueue";

// Issuer Server Actions for wallet flows (Phase 9). Every action authenticates with requireIssuer; the
// organisation, member and wallet authority come from the guard and the database, never from the
// browser. The browser supplies only: a target id the actor must own, a signature, `issuedAt` and
// `nonce` echoed from the prepare step, a transaction hash, and a few free parameters (a reason, a
// date). Salts, digests, roots, sequence numbers and calldata are all server-side.

const REVOKE_REASONS = ["ISSUED_IN_ERROR", "FRAUD", "RECORD_CORRECTED", "OTHER"] as const;

type Prepared = Fail | { ok: true; walletTypedData: unknown; issuedAt: string; nonce: string; effectiveAt?: string };
type Done = Fail | { ok: true; message: string };

// The connected account is not needed here (the server builds the message from the credential);
// the wallet component passes it to every prepare step uniformly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function prepareSigningAction(credentialRowId: string, _account: string): Promise<Prepared> {
  const actor = await requireIssuer("/issuer/credentials");
  try {
    const prep = await prepareCredentialSigning(getDb(), actor, str(credentialRowId, 40));
    return { ok: true, walletTypedData: prep.walletTypedData, issuedAt: prep.issuedAt, nonce: prep.nonce };
  } catch (e) {
    return toFail(e);
  }
}

export async function acceptSigningAction(credentialRowId: string, signature: string, echo: { issuedAt: string; nonce: string }): Promise<Done> {
  const actor = await requireIssuer("/issuer/credentials");
  try {
    const res = await acceptCredentialSignature(getDb(), actor, str(credentialRowId, 40), { signature: str(signature, 140), issuedAt: str(echo?.issuedAt, 20), nonce: str(echo?.nonce, 70) });
    revalidatePath("/issuer/credentials");
    return { ok: true, message: res.queued ? "Signed and queued for anchoring." : `Signed.${res.queueError ? ` Queuing is pending: ${res.queueError}` : ""}` };
  } catch (e) {
    return toFail(e);
  }
}

export async function prepareBindingAction(account: string): Promise<Prepared> {
  const actor = await requireIssuer("/issuer/wallet");
  try {
    const prep = await prepareWalletBinding(getDb(), actor, str(account, 66));
    return { ok: true, walletTypedData: prep.walletTypedData, issuedAt: prep.issuedAt, nonce: prep.nonce };
  } catch (e) {
    return toFail(e);
  }
}

export async function acceptBindingAction(signature: string, echo: { account: string; issuedAt: string; nonce: string }): Promise<Done> {
  const actor = await requireIssuer("/issuer/wallet");
  try {
    const res = await acceptWalletBinding(getDb(), actor, { wallet: str(echo?.account, 66), signature: str(signature, 140), issuedAt: str(echo?.issuedAt, 20), nonce: str(echo?.nonce, 70) });
    revalidatePath("/issuer/wallet");
    return { ok: true, message: res.alreadyBound ? "This wallet is already bound to you." : "Wallet bound to your account." };
  } catch (e) {
    return toFail(e);
  }
}

/** `endDate` is a calendar date (YYYY-MM-DD); the relationship ends at the start of that day (UTC). */
export async function prepareEndAction(credentialRowId: string, endDate: string): Promise<Prepared> {
  const actor = await requireIssuer("/issuer/pulse");
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
      throw new DomainError("VALIDATION", "Enter a valid end date.", { endDate: "Enter a valid end date." });
    }
    const prep = await prepareEndRelationship(getDb(), actor, str(credentialRowId, 40), { effectiveAt: new Date(`${endDate}T00:00:00Z`) });
    return { ok: true, walletTypedData: prep.walletTypedData, issuedAt: prep.issuedAt, nonce: prep.nonce, effectiveAt: prep.effectiveAt };
  } catch (e) {
    return toFail(e);
  }
}

export async function acceptEndAction(credentialRowId: string, signature: string, echo: { issuedAt: string; nonce: string; effectiveAt?: string }): Promise<Done> {
  const actor = await requireIssuer("/issuer/pulse");
  try {
    const res = await acceptStatusChange(getDb(), actor, str(credentialRowId, 40), {
      signature: str(signature, 140),
      issuedAt: str(echo?.issuedAt, 20),
      nonce: str(echo?.nonce, 70),
      effectiveAt: str(echo?.effectiveAt, 20),
    });
    revalidatePath("/issuer/pulse");
    return { ok: true, message: `Relationship ended (status #${res.statusSeq}). This is not a revocation.` };
  } catch (e) {
    return toFail(e);
  }
}

export async function sealBatchAction(): Promise<Done> {
  const actor = await requireIssuer("/issuer/cohort");
  try {
    const sealed = await sealCohortBatch(getDb(), actor);
    revalidatePath("/issuer/cohort");
    return { ok: true, message: `Sealed a batch of ${sealed.leafCount} credential(s). It can no longer change.` };
  } catch (e) {
    return toFail(e);
  }
}

export async function enqueuePendingAction(): Promise<Done> {
  const actor = await requireIssuer("/issuer/credentials");
  try {
    const results = await enqueuePendingForOrganisation(getDb(), actor);
    revalidatePath("/issuer/credentials");
    return { ok: true, message: `Queued ${results.filter((r) => r.queued).length} of ${results.length} signed credential(s).` };
  } catch (e) {
    return toFail(e);
  }
}

const issuerPurpose = (value: unknown): TxPurpose => {
  const p = str(value, 60) as TxPurpose;
  if (!ISSUER_PURPOSES.includes(p)) throw new DomainError("FORBIDDEN", "Not an issuer action.");
  return p;
};

export async function buildIssuerTxAction(
  purpose: string,
  targetId: string,
  raw: { reason?: string },
): Promise<Fail | { ok: true; to: string; data: string; chainId: string; warnings: string[] }> {
  const actor = await requireIssuer("/issuer/transactions");
  try {
    const params: ActionParams = {};
    if (raw.reason && (REVOKE_REASONS as readonly string[]).includes(raw.reason)) params.reason = raw.reason as (typeof REVOKE_REASONS)[number];
    const built = await buildTransaction(getDb(), getChain(), actor, issuerPurpose(purpose), str(targetId, 40), params);
    return { ok: true, to: built.to, data: built.data, chainId: built.chainId, warnings: built.warnings };
  } catch (e) {
    return toFail(e);
  }
}

export async function recordIssuerTxAction(purpose: string, targetId: string, txHash: string): Promise<Fail | { ok: true; id: string; status: string; message: string }> {
  const actor = await requireIssuer("/issuer/transactions");
  try {
    const rec = await recordSubmittedTransaction(getDb(), getChain(), actor, { purpose: issuerPurpose(purpose), targetId: str(targetId, 40), txHash: str(txHash, 70) });
    revalidatePath("/issuer/transactions");
    return { ok: true, id: rec.id, status: rec.status, message: "Transaction submitted. It is tracked until it is final; nothing is treated as confirmed before then." };
  } catch (e) {
    return toFail(e);
  }
}

/** Checks one of THIS organisation's transactions against the chain (idempotent). */
export async function syncIssuerTxAction(txId: string): Promise<Done> {
  const actor = await requireIssuer("/issuer/transactions");
  try {
    if (!actor.organisationId) throw new DomainError("FORBIDDEN", "Only an issuer can do this.");
    const row = await getDb().blockchainTransaction.findFirst({ where: { id: str(txId, 40), organisationId: actor.organisationId }, select: { id: true } });
    if (!row) throw new DomainError("NOT_FOUND", "Transaction not found.");
    const res = await syncTransaction(getDb(), getChain(), row.id);
    revalidatePath("/issuer/transactions");
    return { ok: true, message: `Status: ${res.status}.` };
  } catch (e) {
    return toFail(e);
  }
}
