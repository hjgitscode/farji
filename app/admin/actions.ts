"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import type { TxPurpose } from "@/lib/database/generated/client";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { ADMIN_PURPOSES, assertAdmin, type ActionParams } from "@/server/chain/actions";
import { getChain } from "@/server/chain/context";
import { toFail, str, unixSeconds, type Fail } from "@/server/chain/results";
import { rescanRange, syncPending, syncTransaction } from "@/server/chain/sync";
import { buildTransaction, recordSubmittedTransaction } from "@/server/chain/transactions";
import { randomBytes32 } from "@/server/issuance/random";

// Admin Server Actions (Phase 9). Admins govern Organisations and issuer wallets through their OWN
// browser wallet; they never issue, end or revoke credentials. Each action authenticates with
// requireAdmin and reads an allowlist of fields. The browser provides a target id and a few free
// parameters; the server derives everything else (calldata) from its own database.

const purposeOf = (value: unknown): TxPurpose => {
  const p = str(value, 60) as TxPurpose;
  if (!ADMIN_PURPOSES.includes(p)) throw new DomainError("FORBIDDEN", "Not an administrator action.");
  return p;
};

export async function buildAdminTxAction(
  purpose: string,
  targetId: string,
  raw: { status?: string; wallet?: string; newWallet?: string; compromisedAt?: string },
): Promise<Fail | { ok: true; to: string; data: string; chainId: string; warnings: string[] }> {
  const actor = await requireAdmin("/admin");
  try {
    const params: ActionParams = {};
    if (raw.status === "ACTIVE" || raw.status === "SUSPENDED") params.status = raw.status;
    if (raw.wallet) params.wallet = str(raw.wallet, 66);
    if (raw.newWallet) params.newWallet = str(raw.newWallet, 66);
    if (raw.compromisedAt) params.compromisedAt = unixSeconds(raw.compromisedAt, "compromisedAt");
    const built = await buildTransaction(getDb(), getChain(), actor, purposeOf(purpose), str(targetId, 40), params);
    return { ok: true, to: built.to, data: built.data, chainId: built.chainId, warnings: built.warnings };
  } catch (e) {
    return toFail(e);
  }
}

export async function recordAdminTxAction(purpose: string, targetId: string, txHash: string): Promise<Fail | { ok: true; id: string; status: string; message: string }> {
  const actor = await requireAdmin("/admin");
  try {
    const rec = await recordSubmittedTransaction(getDb(), getChain(), actor, { purpose: purposeOf(purpose), targetId: str(targetId, 40), txHash: str(txHash, 70) });
    revalidatePath("/admin/transactions");
    return { ok: true, id: rec.id, status: rec.status, message: "Transaction submitted. It is tracked until it is final; nothing is treated as confirmed before then." };
  } catch (e) {
    return toFail(e);
  }
}

/** Checks one transaction against the chain (idempotent). */
export async function syncTransactionAction(txId: string): Promise<Fail | { ok: true; message: string }> {
  const actor = await requireAdmin("/admin");
  try {
    assertAdmin(actor);
    const res = await syncTransaction(getDb(), getChain(), str(txId, 40));
    revalidatePath("/admin/transactions");
    return { ok: true, message: `Status: ${res.status}.` };
  } catch (e) {
    return toFail(e);
  }
}

export async function syncAllAction(): Promise<Fail | { ok: true; message: string }> {
  const actor = await requireAdmin("/admin");
  try {
    assertAdmin(actor);
    const results = await syncPending(getDb(), getChain());
    revalidatePath("/admin/transactions");
    const failed = results.filter((r) => r.error).length;
    return { ok: true, message: `Checked ${results.length} transaction(s)${failed ? `; ${failed} will be retried` : ""}.` };
  } catch (e) {
    return toFail(e);
  }
}

export async function rescanAction(from: string, to: string): Promise<Fail | { ok: true; message: string }> {
  const actor = await requireAdmin("/admin");
  try {
    const res = await rescanRange(getDb(), getChain(), actor, { fromBlock: Number(from), toBlock: Number(to) });
    revalidatePath("/admin/transactions");
    return { ok: true, message: `Scanned ${res.scanned}; adopted ${res.adopted}; already known ${res.alreadyKnown}; unattributed ${res.unattributed.length}.` };
  } catch (e) {
    return toFail(e);
  }
}

/** Form wrapper for the rescan page (the page has no client component for it). */
export async function rescanFormAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/transactions");
  await rescanAction(str(formData.get("from"), 12), str(formData.get("to"), 12));
}

const KINDS = ["EMPLOYER", "EDUCATION", "LICENSING_BODY", "ASSOCIATION", "OTHER"] as const;

/** Creates an Organisation row (PENDING_ONBOARDING) with a random on-chain id. Registration on-chain is a separate wallet step. */
export async function createOrganisationAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin("/admin/organisations");
  let message = "";
  try {
    assertAdmin(actor);
    const legalName = str(formData.get("legalName"), 200).trim();
    const displayName = str(formData.get("displayName"), 200).trim();
    const slug = str(formData.get("slug"), 80).trim().toLowerCase();
    const kind = str(formData.get("kind"), 40) as (typeof KINDS)[number];
    if (!legalName || !displayName) throw new DomainError("VALIDATION", "Names are required.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new DomainError("VALIDATION", "The slug may contain lowercase letters, digits and single hyphens.");
    if (!KINDS.includes(kind)) throw new DomainError("VALIDATION", "Choose a valid kind.");
    const db = getDb();
    const org = await db.$transaction(async (tx) => {
      const created = await tx.organisation.create({ data: { orgId: randomBytes32(), slug, legalName, displayName, kind }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorUserId: actor.userId, actorRole: "ADMIN", organisationId: created.id, action: "ORGANISATION_CREATED", targetType: "Organisation", targetId: created.id } });
      return created;
    });
    revalidatePath("/admin/organisations");
    redirect(`/admin/organisations/${org.id}`);
  } catch (e) {
    if (typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    const code = (e as { code?: string }).code;
    message = e instanceof DomainError ? e.message : code === "P2002" ? "That slug is already in use." : "Could not create the organisation.";
  }
  redirect(`/admin/organisations?error=${encodeURIComponent(message)}`);
}
