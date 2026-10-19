import { isAddress } from "ethers";
import {
  encodeAnchorCohortRoot,
  encodeAnchorProofPulseEpoch,
  encodeAuthoriseIssuerWallet,
  encodeMarkCompromised,
  encodeRegisterOrganisation,
  encodeRetireIssuerWallet,
  encodeRevokeCredential,
  encodeRotateIssuerWallet,
  encodeSetOrganisationStatus,
  metadataHashOf,
  ORG_STATUS_FROM_CODE,
  REVOCATION_REASON_CODE,
  REVOCATION_REASON_FROM_CODE,
  type DecodedCall,
  type OrgStatusName,
  type RevocationReasonName,
} from "@/lib/blockchain/registry";
import type { Actor } from "@/lib/auth/authorize";
import { SCHEMA_ID, ZERO_HASH } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import type { PrismaClient, TxPurpose, TxTargetType } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import { isUuid, type IssuanceDb } from "@/server/issuance/common";
import { assertIssuer, assertStillActiveMember, type IssuerScope } from "@/server/issuer/review";
import { ANCHOR_WARNING_SECONDS, MAX_ANCHOR_DELAY_SECONDS } from "./policy";

// One source of truth for "what transaction is this action allowed to be?" (BLOCKCHAIN_MODEL §13).
//
// `resolveAction` turns (purpose, target, free parameters) into the EXACT expected calldata, using
// only trusted server/database state. It is used twice:
//   - BUILD: the server hands the browser wallet a transaction it constructed itself;
//   - RECORD: when the browser reports a tx hash, the server fetches the transaction from its own
//     RPC and requires its calldata to equal what resolveAction produces (only the chain head the
//     contract itself enforces, `expectedPreviousChainRoot`, is taken from the transaction).
// The browser therefore never chooses an organisation, credential, salt, root, leaf count,
// sequence number or schema id.

export type ChainDb = IssuanceDb & Pick<PrismaClient, "organisation" | "revocation" | "blockchainTransaction" | "anchor">;

export const ADMIN_PURPOSES: readonly TxPurpose[] = [
  "REGISTER_ORGANISATION",
  "SET_ORGANISATION_STATUS",
  "AUTHORISE_ISSUER_KEY",
  "RETIRE_ISSUER_KEY",
  "MARK_ISSUER_KEY_COMPROMISED",
];
export const ISSUER_PURPOSES: readonly TxPurpose[] = ["ANCHOR_COHORT", "ANCHOR_PROOF_PULSE", "REVOKE_CREDENTIAL"];

export const isAdminPurpose = (p: TxPurpose) => ADMIN_PURPOSES.includes(p);

export type AdminScope = { kind: "ADMIN"; userId: string };
export type IssuerActionScope = { kind: "ISSUER" } & IssuerScope;
export type ActionScope = AdminScope | IssuerActionScope;

export function assertAdmin(actor: Actor): AdminScope {
  if (!actor || actor.role !== "ADMIN" || !isUuid(actor.userId)) throw new DomainError("FORBIDDEN", "Only an administrator can do this.");
  return { kind: "ADMIN", userId: actor.userId };
}

/** The actor scope a purpose requires (admin purposes: ADMIN; the rest: an active issuer). */
export function scopeFor(actor: Actor, purpose: TxPurpose): ActionScope {
  if (isAdminPurpose(purpose)) return assertAdmin(actor);
  return { kind: "ISSUER", ...assertIssuer(actor) };
}

/** Free parameters an action may carry. Everything else is derived from the database. */
export type ActionParams = {
  status?: OrgStatusName;
  wallet?: string;
  newWallet?: string;
  compromisedAt?: bigint;
  rootSeq?: bigint;
  reason?: RevocationReasonName;
};

export type ResolveOptions = {
  now: Date;
  /** BUILD refuses an anchor that Phase 10 would necessarily reject (D7); RECORD never re-judges a sent tx. */
  enforceAnchorDelay: boolean;
};

export type Resolved = {
  purpose: TxPurpose;
  fn: string;
  targetType: TxTargetType;
  targetId: string;
  targetSequence: number | null;
  organisationId: string | null;
  /** For anchors: which chain head the caller must read for `expectedPreviousChainRoot`. */
  chain: "COHORT" | "PROOF_PULSE" | null;
  orgId: string | null;
  warnings: string[];
  encode: (expectedPreviousChainRoot?: string) => string;
};

const lower = (s: string) => s.toLowerCase();

function walletParam(value: unknown, field: string): string {
  if (typeof value !== "string" || !isAddress(value) || /^0x0+$/.test(value)) {
    throw new DomainError("VALIDATION", "Enter a valid wallet address.", { [field]: "Enter a valid wallet address." });
  }
  return lower(value);
}

async function loadOrganisation(db: ChainDb, id: string) {
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", "Organisation not found.");
  const org = await db.organisation.findUnique({ where: { id }, select: { id: true, orgId: true, slug: true, status: true } });
  if (!org) throw new DomainError("NOT_FOUND", "Organisation not found.");
  return org;
}

async function loadKey(db: ChainDb, id: string) {
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", "Issuer key not found.");
  const key = await db.issuerKey.findUnique({
    where: { id },
    select: { id: true, organisationId: true, walletAddress: true, validFrom: true, validUntil: true, compromisedAt: true, organisation: { select: { orgId: true, status: true } } },
  });
  if (!key) throw new DomainError("NOT_FOUND", "Issuer key not found.");
  return key;
}

/** Only one unfinished transaction per (target, purpose): a duplicate would only race the first. */
async function assertNoInFlight(db: ChainDb, targetType: TxTargetType, targetId: string, purpose: TxPurpose) {
  const open = await db.blockchainTransaction.findFirst({
    where: { targetType, targetId, purpose, status: { in: ["PENDING", "CONFIRMED"] } },
    select: { id: true },
  });
  if (open) throw new DomainError("CONFLICT", "A transaction for this is already in progress.");
}

export async function resolveAction(
  db: ChainDb,
  scope: ActionScope,
  purpose: TxPurpose,
  targetId: string,
  params: ActionParams,
  opts: ResolveOptions,
): Promise<Resolved> {
  const base = { purpose, warnings: [] as string[], chain: null as Resolved["chain"], targetSequence: null as number | null };
  const nowSec = BigInt(Math.floor(opts.now.getTime() / 1000));

  switch (purpose) {
    // ───────────── admin ─────────────
    case "REGISTER_ORGANISATION": {
      assertScope(scope, "ADMIN");
      const org = await loadOrganisation(db, targetId);
      if (org.status !== "PENDING_ONBOARDING") throw new DomainError("CONFLICT", "This organisation is already registered.");
      await assertNoInFlight(db, "ORGANISATION", org.id, purpose);
      return { ...base, fn: "registerOrganisation", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, orgId: org.orgId, encode: () => encodeRegisterOrganisation(org.orgId, metadataHashOf(org.slug)) };
    }
    case "SET_ORGANISATION_STATUS": {
      assertScope(scope, "ADMIN");
      const org = await loadOrganisation(db, targetId);
      if (org.status === "PENDING_ONBOARDING") throw new DomainError("CONFLICT", "Register this organisation on-chain first.");
      const status = params.status;
      if (status !== "ACTIVE" && status !== "SUSPENDED") throw new DomainError("VALIDATION", "Choose ACTIVE or SUSPENDED.", { status: "Choose ACTIVE or SUSPENDED." });
      if (status === org.status) throw new DomainError("CONFLICT", "The organisation already has that status.");
      await assertNoInFlight(db, "ORGANISATION", org.id, purpose);
      return { ...base, fn: "setOrganisationStatus", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, orgId: org.orgId, encode: () => encodeSetOrganisationStatus(org.orgId, status) };
    }
    case "AUTHORISE_ISSUER_KEY": {
      assertScope(scope, "ADMIN");
      const org = await loadOrganisation(db, targetId);
      if (org.status !== "ACTIVE") throw new DomainError("CONFLICT", "The organisation must be ACTIVE.");
      const wallet = walletParam(params.wallet, "wallet");
      if (await db.issuerKey.findUnique({ where: { walletAddress: wallet }, select: { id: true } })) {
        throw new DomainError("CONFLICT", "That wallet has already been used as an issuer wallet and can never be authorised again.");
      }
      await assertNoInFlight(db, "ORGANISATION", org.id, purpose);
      return { ...base, fn: "authoriseIssuerWallet", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, orgId: org.orgId, encode: () => encodeAuthoriseIssuerWallet(org.orgId, wallet) };
    }
    case "RETIRE_ISSUER_KEY": {
      assertScope(scope, "ADMIN");
      const key = await loadKey(db, targetId);
      if (key.validUntil || key.compromisedAt) throw new DomainError("CONFLICT", "This wallet is already retired or compromised.");
      await assertNoInFlight(db, "ISSUER_KEY", key.id, purpose);
      const orgId = key.organisation.orgId;
      if (params.newWallet !== undefined) {
        // Rotation: retire + authorise atomically; the new wallet must be fresh.
        if (key.organisation.status !== "ACTIVE") throw new DomainError("CONFLICT", "The organisation must be ACTIVE to rotate a wallet.");
        const newWallet = walletParam(params.newWallet, "newWallet");
        if (await db.issuerKey.findUnique({ where: { walletAddress: newWallet }, select: { id: true } })) {
          throw new DomainError("CONFLICT", "The new wallet must be fresh: it has been used as an issuer wallet before.");
        }
        return { ...base, fn: "rotateIssuerWallet", targetType: "ISSUER_KEY", targetId: key.id, organisationId: key.organisationId, orgId, encode: () => encodeRotateIssuerWallet(orgId, key.walletAddress, newWallet) };
      }
      return { ...base, fn: "retireIssuerWallet", targetType: "ISSUER_KEY", targetId: key.id, organisationId: key.organisationId, orgId, encode: () => encodeRetireIssuerWallet(key.walletAddress) };
    }
    case "MARK_ISSUER_KEY_COMPROMISED": {
      assertScope(scope, "ADMIN");
      const key = await loadKey(db, targetId);
      if (key.compromisedAt) throw new DomainError("CONFLICT", "This wallet is already marked compromised.");
      const at = params.compromisedAt;
      const from = dateToUnixSeconds(key.validFrom);
      if (typeof at !== "bigint" || at < from || at > nowSec + 60n) {
        throw new DomainError("VALIDATION", "The compromise time must be between the wallet's authorisation and now.", { compromisedAt: "Must be between the wallet's authorisation and now." });
      }
      await assertNoInFlight(db, "ISSUER_KEY", key.id, purpose);
      return { ...base, fn: "markIssuerWalletCompromised", targetType: "ISSUER_KEY", targetId: key.id, organisationId: key.organisationId, orgId: key.organisation.orgId, encode: () => encodeMarkCompromised(key.walletAddress, at) };
    }

    // ───────────── issuer ─────────────
    case "ANCHOR_COHORT": {
      const s = assertScope(scope, "ISSUER");
      await assertStillActiveMember(db, s);
      if (!isUuid(targetId)) throw new DomainError("NOT_FOUND", "Batch not found.");
      const batch = await db.cohortBatch.findFirst({ where: { id: targetId, organisationId: s.organisationId }, select: { id: true, status: true, batchRoot: true, leafCount: true } });
      if (!batch) throw new DomainError("NOT_FOUND", "Batch not found.");
      if (batch.status !== "SEALED" || !batch.batchRoot || !batch.leafCount) throw new DomainError("CONFLICT", "Only a sealed, not yet anchored batch can be anchored.");
      const org = await db.organisation.findUniqueOrThrow({ where: { id: s.organisationId }, select: { orgId: true, status: true } });
      if (org.status !== "ACTIVE") throw new DomainError("CONFLICT", "The organisation must be ACTIVE to anchor.");
      await assertNoInFlight(db, "COHORT_BATCH", batch.id, purpose);

      const leaves = await db.cohortLeaf.findMany({ where: { batchId: batch.id }, select: { credential: { select: { issuedAt: true } } } });
      const warnings = anchorDelayAssessment(leaves.map((l) => l.credential.issuedAt), opts.now, opts.enforceAnchorDelay, "batch");
      const { batchRoot, leafCount } = batch;
      return {
        ...base,
        warnings,
        chain: "COHORT",
        fn: "anchorCohortRoot",
        targetType: "COHORT_BATCH",
        targetId: batch.id,
        organisationId: s.organisationId,
        orgId: org.orgId,
        encode: (prev) => encodeAnchorCohortRoot(org.orgId, batchRoot, leafCount, SCHEMA_ID, prev ?? ZERO_HASH),
      };
    }
    case "ANCHOR_PROOF_PULSE": {
      const s = assertScope(scope, "ISSUER");
      await assertStillActiveMember(db, s);
      if (!isUuid(targetId)) throw new DomainError("NOT_FOUND", "Tree not found.");
      const tree = await db.proofPulseTree.findFirst({ where: { id: targetId, organisationId: s.organisationId }, select: { id: true, currentRootSeq: true } });
      if (!tree) throw new DomainError("NOT_FOUND", "Tree not found.");
      const rootSeq = params.rootSeq ?? BigInt(tree.currentRootSeq);
      if (rootSeq < 1n || rootSeq > BigInt(tree.currentRootSeq)) throw new DomainError("CONFLICT", "That ProofPulse root does not exist.");
      const update = await db.proofPulseUpdate.findUnique({ where: { treeId_rootSeq: { treeId: tree.id, rootSeq: Number(rootSeq) } }, select: { newRoot: true } });
      if (!update) throw new DomainError("CONFLICT", "That ProofPulse root does not exist.");
      const leafCount = await db.proofPulseUpdate.count({ where: { treeId: tree.id, rootSeq: { lte: Number(rootSeq) }, kind: "INSERT" } });
      const org = await db.organisation.findUniqueOrThrow({ where: { id: s.organisationId }, select: { orgId: true, status: true } });
      if (org.status !== "ACTIVE") throw new DomainError("CONFLICT", "The organisation must be ACTIVE to anchor.");
      await assertNoInFlight(db, "PROOF_PULSE_TREE", tree.id, purpose);

      const queued = await db.credential.findMany({
        where: { organisationId: s.organisationId, lifecycleType: "CONTINUING", pipelineStatus: "QUEUED_FOR_ANCHOR" },
        select: { issuedAt: true },
      });
      // An epoch also re-affirms already-anchored leaves, so it is never refused for stale queued leaves; it warns.
      const warnings = anchorDelayAssessment(queued.map((q) => q.issuedAt), opts.now, false, "ProofPulse");
      const { newRoot } = update;
      return {
        ...base,
        warnings,
        chain: "PROOF_PULSE",
        fn: "anchorProofPulseEpoch",
        targetType: "PROOF_PULSE_TREE",
        targetId: tree.id,
        targetSequence: Number(rootSeq),
        organisationId: s.organisationId,
        orgId: org.orgId,
        encode: (prev) => encodeAnchorProofPulseEpoch(org.orgId, newRoot, rootSeq, leafCount, prev ?? ZERO_HASH),
      };
    }
    case "REVOKE_CREDENTIAL": {
      const s = assertScope(scope, "ISSUER");
      await assertStillActiveMember(db, s);
      if (!isUuid(targetId)) throw new DomainError("NOT_FOUND", "Credential not found.");
      const reason = params.reason;
      if (!reason || !(reason in REVOCATION_REASON_CODE)) throw new DomainError("VALIDATION", "Choose a revocation reason.", { reason: "Choose a revocation reason." });
      // The credential must be a KNOWN credential of THIS organisation in FARJI's database.
      const credential = await db.credential.findFirst({
        where: { id: targetId, organisationId: s.organisationId },
        select: { id: true, credentialSalt: true, credentialId: true, pipelineStatus: true, revocation: { select: { id: true } }, organisation: { select: { orgId: true, status: true } } },
      });
      if (!credential) throw new DomainError("NOT_FOUND", "Credential not found.");
      if (credential.pipelineStatus === "AWAITING_SIGNATURE" || !credential.credentialSalt || !credential.credentialId) {
        throw new DomainError("CONFLICT", "Only an issued (signed) credential can be revoked.");
      }
      if (credential.revocation) throw new DomainError("CONFLICT", "This credential is already revoked.");
      if (credential.organisation.status === "PENDING_ONBOARDING") throw new DomainError("CONFLICT", "The organisation is not registered on-chain.");
      await assertNoInFlight(db, "CREDENTIAL", credential.id, purpose);
      const { credentialSalt } = credential;
      const orgId = credential.organisation.orgId;
      return {
        ...base,
        warnings: ["Revoking publishes this credential's credentialSalt on-chain. It reveals nothing about the content or the subject, and it cannot be undone."],
        fn: "revokeCredential",
        targetType: "CREDENTIAL",
        targetId: credential.id,
        organisationId: s.organisationId,
        orgId,
        encode: () => encodeRevokeCredential(orgId, credentialSalt, reason),
      };
    }
  }
}

function assertScope<K extends ActionScope["kind"]>(scope: ActionScope, kind: K): Extract<ActionScope, { kind: K }> {
  if (scope.kind !== kind) throw new DomainError("FORBIDDEN", "Not allowed for this role.");
  return scope as Extract<ActionScope, { kind: K }>;
}

/**
 * D7 (maxAnchorDelay = 30 days). The contract cannot enforce it (it never sees `issuedAt`); the app
 * warns after 21 days and, when building, refuses an anchor in which EVERY attestation is already
 * older than 30 days (Phase 10 would necessarily reject all of it).
 */
export function anchorDelayAssessment(issuedAts: (Date | null)[], now: Date, enforce: boolean, what: string): string[] {
  const ages = issuedAts.filter((d): d is Date => d !== null).map((d) => (now.getTime() - d.getTime()) / 1000);
  if (ages.length === 0) return [];
  const oldest = Math.max(...ages);
  const newest = Math.min(...ages);
  if (enforce && newest > MAX_ANCHOR_DELAY_SECONDS) {
    throw new DomainError("CONFLICT", `Every credential in this ${what} was signed more than 30 days ago, so an anchor now would not be accepted as evidence. Sign them again.`);
  }
  const warnings: string[] = [];
  if (oldest > MAX_ANCHOR_DELAY_SECONDS) {
    warnings.push(`Some credentials in this ${what} were signed more than 30 days ago; they will not count as valid evidence once anchored. Re-sign them.`);
  } else if (oldest > ANCHOR_WARNING_SECONDS) {
    warnings.push(`Some credentials in this ${what} were signed more than 21 days ago. Anchor soon: after 30 days they stop counting as valid evidence.`);
  }
  return warnings;
}

/** The free parameters a reported transaction claims, plus the function it called. */
export function paramsFromCall(purpose: TxPurpose, call: DecodedCall): ActionParams {
  const a = call.args;
  switch (purpose) {
    case "SET_ORGANISATION_STATUS":
      return { status: ORG_STATUS_FROM_CODE[Number(a.status)] };
    case "AUTHORISE_ISSUER_KEY":
      return { wallet: a.wallet as string };
    case "RETIRE_ISSUER_KEY":
      return call.name === "rotateIssuerWallet" ? { newWallet: a.newWallet as string } : {};
    case "MARK_ISSUER_KEY_COMPROMISED":
      return { compromisedAt: BigInt(a.compromisedAt as bigint) };
    case "ANCHOR_PROOF_PULSE":
      return { rootSeq: BigInt(a.rootSeq as bigint) };
    case "REVOKE_CREDENTIAL":
      return { reason: REVOCATION_REASON_FROM_CODE[Number(a.reasonCode)] };
    default:
      return {};
  }
}

