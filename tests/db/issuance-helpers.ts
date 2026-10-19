import { randomUUID } from "node:crypto";
import type { Actor } from "@/lib/auth/authorize";
import { createClaim, submitVerificationRequest } from "@/server/candidate/claims";
import { acceptCredentialSignature, prepareCredentialSigning, type AcceptSigningOptions } from "@/server/issuance/signing";
import { approveVerificationRequest } from "@/server/issuer/review";
import { PERMISSIVE_CHAIN_VIEW, TEST_CONFIG, type TestWallet } from "../fixtures/test-wallets";
import { mkFinalizedTx, mkMember, mkOrg, mkUser, type Tx } from "./helpers";

// Shared fixtures for the Phase 6/7 database tests (all run in always-rolled-back transactions).

export const CLAIM_NOW = new Date("2026-10-15T12:00:00Z");
export const APPROVE_NOW = new Date("2026-10-16T09:00:00Z");
/** The "current time" for signing. issuedAt = this, in whole seconds. */
export const SIGN_NOW = new Date("2026-10-16T10:00:00Z");

export const PERMANENT = {
  category: "EXPERIENCE",
  lifecycleType: "PERMANENT",
  title: "Software Engineer",
  organisationName: "Acme Ltd",
  startDate: "2022-01-10",
  endDate: "2024-03-31",
};
export const CONTINUING = { ...PERMANENT, lifecycleType: "CONTINUING", endDate: "" };
export const EXPIRING = { ...PERMANENT, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "", expiryDate: "2027-03-31" };

export const candidateActor = (userId: string): Actor => ({
  userId,
  authUserId: randomUUID(),
  role: "CANDIDATE",
  organisationId: null,
  organisationStatus: null,
  memberId: null,
});

export async function issuerOf(tx: Tx, organisationId: string): Promise<Actor> {
  const { user, member } = await mkMember(tx, organisationId);
  return { userId: user.id, authUserId: randomUUID(), role: "ISSUER", organisationId, organisationStatus: "ACTIVE", memberId: member.id };
}

export type KeyOptions = {
  validFrom?: Date;
  validUntil?: Date | null;
  compromisedAt?: Date | null;
  operatorMemberId?: string | null;
  /** Skip the finalised authorisation transaction (a hand-made mirror row: D46 must refuse it). */
  withoutAuthoriseTx?: boolean;
  /** Leave the authorisation transaction short of FINALIZED. */
  authoriseTxStatus?: "PENDING" | "CONFIRMED";
};

/** An IssuerKey row for a wallet (the lowercase address). Defaults: open since 2026-01-01. */
export async function addKey(tx: Tx, organisationId: string, wallet: TestWallet, o: KeyOptions = {}) {
  // Phase 9 (D46): an issuer wallet has authority only through a FINALIZED authorisation transaction.
  let authoriseTransactionId: string | null = null;
  if (!o.withoutAuthoriseTx) {
    if (o.authoriseTxStatus) {
      const admin = await mkUser(tx, "ADMIN");
      const pending = await tx.blockchainTransaction.create({
        data: { chainId: 31337, txHash: "0x" + randomUUID().replaceAll("-", "").padEnd(64, "0"), purpose: "AUTHORISE_ISSUER_KEY", targetType: "ORGANISATION", targetId: organisationId, fromAddress: "0x" + "ab".repeat(20), initiatedByUserId: admin.id, organisationId },
      });
      if (o.authoriseTxStatus === "CONFIRMED") {
        await tx.blockchainTransaction.update({ where: { id: pending.id }, data: { status: "CONFIRMED", blockNumber: 1n, blockHash: "0x" + "cd".repeat(32), confirmedAt: new Date() } });
      }
      authoriseTransactionId = pending.id;
    } else {
      authoriseTransactionId = (await mkFinalizedTx(tx, "AUTHORISE_ISSUER_KEY", organisationId)).id;
    }
  }
  return tx.issuerKey.create({
    data: {
      organisationId,
      walletAddress: wallet.address.toLowerCase(),
      validFrom: o.validFrom ?? new Date("2026-01-01T00:00:00Z"),
      validUntil: o.validUntil ?? null,
      compromisedAt: o.compromisedAt ?? null,
      operatorMemberId: o.operatorMemberId ?? null,
      authoriseTransactionId,
    },
  });
}

export type Fixture = {
  orgId: string;
  issuer: Actor;
  cand: Actor;
  claimId: string;
  claimVersionId: string;
  requestId: string;
  credentialRowId: string;
};

/** Full Phase 4/5 path: candidate claim -> request -> issuer approval -> AWAITING_SIGNATURE credential. */
export async function approvedCredential(
  tx: Tx,
  draft: Record<string, unknown> = PERMANENT,
  existing?: { orgId: string; issuer: Actor },
): Promise<Fixture> {
  const org = existing ? { id: existing.orgId } : await mkOrg(tx, "ACTIVE");
  const issuer = existing?.issuer ?? (await issuerOf(tx, org.id));
  const cand = candidateActor((await mkUser(tx, "CANDIDATE")).id);
  const { claimId, claimVersionId } = await createClaim(tx, cand, draft, CLAIM_NOW);
  const { requestId } = await submitVerificationRequest(tx, cand, { claimId, claimVersionId, organisationId: org.id });
  const { credentialRowId } = await approveVerificationRequest(tx, issuer, requestId, {}, APPROVE_NOW);
  return { orgId: org.id, issuer, cand, claimId, claimVersionId, requestId, credentialRowId };
}

export const signOpts = (over: Partial<AcceptSigningOptions> = {}): AcceptSigningOptions => ({ config: TEST_CONFIG, now: SIGN_NOW, chain: PERMISSIVE_CHAIN_VIEW, ...over });

/** prepare -> wallet signs the typed data -> accept. The wallet is a TEST wallet (tests/fixtures). */
export async function signCredential(
  tx: Tx,
  f: Pick<Fixture, "issuer" | "credentialRowId">,
  wallet: TestWallet,
  opts: Partial<AcceptSigningOptions> = {},
) {
  const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: opts.now ?? SIGN_NOW });
  const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  const accepted = await acceptCredentialSignature(
    tx,
    f.issuer,
    f.credentialRowId,
    { signature, issuedAt: prep.issuedAt, nonce: prep.nonce },
    signOpts(opts),
  );
  return { prep, signature, accepted };
}
