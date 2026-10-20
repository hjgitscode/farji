import type { Actor } from "@/lib/auth/authorize";
import type { PrismaClient } from "@/lib/database/generated/client";
import { assertAdmin } from "./actions";
import { assertIssuer } from "@/server/issuer/review";
import { DomainError } from "@/server/candidate/errors";
import { isUuid } from "@/server/issuance/common";
import { getChain } from "./context";

// Read-only queries behind the minimal admin / issuer blockchain pages. Role and organisation scope
// are enforced here (not in the page). Nothing here selects a private salt, a candidate identifier
// or a signature.

type Db = PrismaClient;

/** The configured chain id for the wallet UI, or null when chain features are not configured. */
export function configuredChainId(): string | null {
  try {
    return getChain().cfg.chainId.toString();
  } catch {
    return null;
  }
}

/** Public network facts for "View signing details" (chain id and registry address are public). */
export function configuredChainInfo(): { chainId: string; registry: string } | null {
  try {
    const cfg = getChain().cfg;
    return { chainId: cfg.chainId.toString(), registry: cfg.registry };
  } catch {
    return null;
  }
}

const TX_SELECT = {
  id: true,
  txHash: true,
  purpose: true,
  targetType: true,
  status: true,
  fromAddress: true,
  blockNumber: true,
  failureReason: true,
  submittedAt: true,
  confirmedAt: true,
  finalizedAt: true,
  organisation: { select: { displayName: true } },
} as const;

export async function adminListOrganisations(db: Db, actor: Actor) {
  assertAdmin(actor);
  return db.organisation.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, slug: true, displayName: true, legalName: true, kind: true, status: true, orgId: true },
  });
}

export async function adminGetOrganisation(db: Db, actor: Actor, id: string) {
  assertAdmin(actor);
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", "Organisation not found.");
  const org = await db.organisation.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      displayName: true,
      legalName: true,
      kind: true,
      status: true,
      orgId: true,
      pulseFreshnessDays: true,
      members: { orderBy: { invitedAt: "asc" }, select: { id: true, status: true, invitedAt: true, joinedAt: true, removedAt: true, operatedKeys: { select: { id: true } } } },
      issuerKeys: {
        orderBy: { createdAt: "asc" },
        select: { id: true, walletAddress: true, validFrom: true, validUntil: true, compromisedAt: true, operatorMemberId: true, authoriseTransaction: { select: { status: true } } },
      },
    },
  });
  if (!org) throw new DomainError("NOT_FOUND", "Organisation not found.");
  return org;
}

export async function adminListTransactions(db: Db, actor: Actor) {
  assertAdmin(actor);
  return db.blockchainTransaction.findMany({ orderBy: { submittedAt: "desc" }, take: 100, select: TX_SELECT });
}

export async function issuerListTransactions(db: Db, actor: Actor) {
  const scope = assertIssuer(actor);
  return db.blockchainTransaction.findMany({ where: { organisationId: scope.organisationId }, orderBy: { submittedAt: "desc" }, take: 100, select: TX_SELECT });
}

export async function issuerWallets(db: Db, actor: Actor) {
  const scope = assertIssuer(actor);
  const keys = await db.issuerKey.findMany({
    where: { organisationId: scope.organisationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, walletAddress: true, validFrom: true, validUntil: true, compromisedAt: true, operatorMemberId: true, authoriseTransaction: { select: { status: true } } },
  });
  return keys.map((k) => ({ ...k, boundToYou: k.operatorMemberId === scope.memberId, bound: k.operatorMemberId !== null, operatorMemberId: undefined }));
}

export async function issuerListCredentials(db: Db, actor: Actor) {
  const scope = assertIssuer(actor);
  return db.credential.findMany({
    where: { organisationId: scope.organisationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      lifecycleType: true,
      pipelineStatus: true,
      credentialId: true,
      issuedAt: true,
      claimVersion: { select: { versionNumber: true, content: true, claim: { select: { category: true } } } },
      revocation: { select: { reasonCode: true, revokedAt: true } },
    },
  });
}

export async function issuerCohortOverview(db: Db, actor: Actor) {
  const scope = assertIssuer(actor);
  return db.cohortBatch.findMany({
    where: { organisationId: scope.organisationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, label: true, status: true, batchRoot: true, leafCount: true, sealedAt: true, _count: { select: { leaves: true } }, anchor: { select: { epoch: true, chainRoot: true } } },
  });
}

export async function issuerPulseOverview(db: Db, actor: Actor) {
  const scope = assertIssuer(actor);
  const tree = await db.proofPulseTree.findUnique({
    where: { organisationId: scope.organisationId },
    select: {
      id: true,
      depth: true,
      currentRoot: true,
      currentRootSeq: true,
      nextLeafIndex: true,
      leaves: {
        orderBy: { leafIndex: "asc" },
        take: 500,
        select: {
          leafIndex: true,
          status: true,
          statusSeq: true,
          scope: true,
          credential: { select: { id: true, pipelineStatus: true, claimVersion: { select: { content: true } } } },
        },
      },
    },
  });
  const anchors = await db.anchor.findMany({ where: { organisationId: scope.organisationId, attestationType: "PROOF_PULSE" }, orderBy: { epoch: "desc" }, take: 10, select: { epoch: true, rootSeq: true, chainRoot: true } });
  return { tree, anchors };
}
