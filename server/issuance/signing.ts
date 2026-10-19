import type { Actor } from "@/lib/auth/authorize";
import { LIFECYCLE_CODE, type LifecycleName } from "@/lib/crypto/constants";
import { nowSeconds, unixSecondsToDate } from "@/lib/crypto/encoding";
import {
  buildCredentialTypedData,
  farjiDomain,
  normaliseSignature,
  recoverSigner,
  toWalletTypedData,
  typedDataHash,
  type CredentialAttestationMessage,
  type Eip712Config,
  type TypedData,
} from "@/lib/crypto/eip712";
import { areDistinctSalts } from "@/lib/crypto/commitments";
import { DomainError } from "@/server/candidate/errors";
import { assertIssuer, assertStillActiveMember } from "@/server/issuer/review";
import { enqueueSignedCredential } from "@/server/merkle/enqueue";
import {
  assertIssuedAtWindow,
  assertSignable,
  audit,
  canonicalTerms,
  deriveMaterial,
  inTransaction,
  isUniqueViolation,
  isUuid,
  loadCredentialContext,
  parseIssuedAt,
  parseNonce,
  requireSigningKey,
  resolveSupersedes,
  verifiedMaterial,
  type IssuanceDb,
  type ServiceOptions,
  type SignatureInput,
} from "./common";
import { getEip712Config } from "./config";
import { randomBytes32 } from "./random";

// Credential issuance: prepare the signing payload, then accept the issuer wallet's signature
// (ROADMAP Phase 6). The SERVER NEVER HOLDS A PRIVATE KEY: it builds typed data from database
// rows, a wallet signs it, and the server only RECOVERS the signer and checks it against the
// issuer key history. Nothing the client sends is trusted except the signature itself, plus the
// `issuedAt` and `nonce` it echoes back from `prepare` (both bound into the signed message).
//
// Pipeline: AWAITING_SIGNATURE --prepare--> (still AWAITING_SIGNATURE, salts/digests written)
//           --accept--> SIGNED --enqueue--> QUEUED_FOR_ANCHOR.
//
// `validFrom` is the effective start of the underlying professional claim.
// `issuedAt` is the actual cryptographic issuance (signature) timestamp. They are never conflated.

export type SigningOptions = ServiceOptions & { config?: Eip712Config };

export type PreparedSigning = {
  credentialRowId: string;
  credentialId: string;
  issuedAt: string;
  nonce: string;
  typedDataHash: string;
  /** Raw typed data (bigint integers): what ethers `signTypedData` takes. */
  typedData: TypedData<CredentialAttestationMessage>;
  /** JSON-safe `eth_signTypedData_v4` form for a browser wallet (Phase 9). */
  walletTypedData: ReturnType<typeof toWalletTypedData>;
};

function newSalts(random: () => string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const salts = { credentialSalt: random(), contentSalt: random(), subjectSalt: random() };
    if (areDistinctSalts(salts.credentialSalt, salts.contentSalt, salts.subjectSalt)) return salts;
  }
  throw new Error("Could not generate distinct salts");
}

export async function prepareCredentialSigning(
  db: IssuanceDb,
  actor: Actor,
  credentialRowId: string,
  opts: SigningOptions = {},
): Promise<PreparedSigning> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();
  const random = opts.random ?? randomBytes32;

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    let ctx = await loadCredentialContext(tx, scope, credentialRowId);
    if (ctx.pipelineStatus !== "AWAITING_SIGNATURE") throw new DomainError("CONFLICT", "This credential has already been signed.");
    assertSignable(ctx, scope);
    const terms = canonicalTerms(ctx);

    if (!ctx.credentialSalt) {
      // First preparation: draw three DISTINCT salts and derive every identifier. All of these
      // columns are write-once, and the conditional update lets only one preparer win.
      const salts = newSalts(random);
      const material = deriveMaterial(ctx, terms, salts);
      await tx.credential.updateMany({
        where: { id: ctx.id, organisationId: scope.organisationId, pipelineStatus: "AWAITING_SIGNATURE", credentialSalt: null },
        data: {
          ...salts,
          credentialId: material.credentialId,
          subjectCommitment: material.subjectCommitment,
          contentDigest: material.contentDigest,
          validFrom: unixSecondsToDate(terms.validFrom),
        },
      });
      ctx = await loadCredentialContext(tx, scope, credentialRowId);
    }

    // Idempotent path: whatever is stored (by us or a concurrent preparer) must be consistent.
    const material = verifiedMaterial(ctx, terms);
    const supersedes = await resolveSupersedes(tx, ctx);
    const nonce = random();
    const issuedAt = nowSeconds(now);

    const typedData = buildCredentialTypedData(domain, {
      credentialId: material.credentialId,
      orgId: material.orgId,
      subjectCommitment: material.subjectCommitment,
      content: terms.content,
      contentSalt: material.contentSalt,
      lifecycleType: LIFECYCLE_CODE[ctx.lifecycleType as LifecycleName],
      validFrom: terms.validFrom,
      validUntil: terms.validUntil,
      supersedesCredentialId: supersedes.credentialId,
      issuedAt,
      nonce,
    });

    await audit(tx, scope, "CREDENTIAL_SIGNING_PREPARED", "Credential", ctx.id, { claimVersionId: ctx.claimVersionId });
    return {
      credentialRowId: ctx.id,
      credentialId: material.credentialId,
      issuedAt: issuedAt.toString(),
      nonce,
      typedDataHash: typedDataHash(typedData),
      typedData,
      walletTypedData: toWalletTypedData(typedData),
    };
  });
}

export type AcceptSigningOptions = SigningOptions & {
  /** Queue the signed credential into the Merkle pipeline straight away (default true). */
  enqueue?: boolean;
};

export type AcceptedSigning = {
  credentialRowId: string;
  attestationId: string;
  typedDataHash: string;
  pipelineStatus: "SIGNED" | "QUEUED_FOR_ANCHOR" | "ANCHORED";
  idempotent: boolean;
  queued: boolean;
  queueError?: string;
};

export async function acceptCredentialSignature(
  db: IssuanceDb,
  actor: Actor,
  credentialRowId: string,
  rawInput: SignatureInput,
  opts: AcceptSigningOptions = {},
): Promise<AcceptedSigning> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const issuedAt = parseIssuedAt(rawInput?.issuedAt);
  const nonce = parseNonce(rawInput?.nonce);
  const signature = normaliseSignature(rawInput?.signature);
  if (!signature) throw new DomainError("VALIDATION", "Invalid signature.", { signature: "Invalid signature." });
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();

  const accepted = await inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const ctx = await loadCredentialContext(tx, scope, credentialRowId);

    // The message is ALWAYS rebuilt from database rows; the client supplies only issuedAt + nonce.
    const terms = canonicalTerms(ctx);
    const material = verifiedMaterial(ctx, terms);
    const supersedes = await resolveSupersedes(tx, ctx);
    const typedData = buildCredentialTypedData(domain, {
      credentialId: material.credentialId,
      orgId: material.orgId,
      subjectCommitment: material.subjectCommitment,
      content: terms.content,
      contentSalt: material.contentSalt,
      lifecycleType: LIFECYCLE_CODE[ctx.lifecycleType as LifecycleName],
      validFrom: terms.validFrom,
      validUntil: terms.validUntil,
      supersedesCredentialId: supersedes.credentialId,
      issuedAt,
      nonce,
    });
    const hash = typedDataHash(typedData);

    if (ctx.pipelineStatus !== "AWAITING_SIGNATURE") {
      // Retry of an already accepted signature: success only for the very same signed message.
      const existing = ctx.attestations[0];
      if (existing && existing.typedDataHash === hash) {
        return { credentialRowId: ctx.id, attestationId: existing.id, typedDataHash: hash, idempotent: true };
      }
      throw new DomainError("CONFLICT", "This credential has already been signed.");
    }

    assertSignable(ctx, scope);
    assertIssuedAtWindow(issuedAt, nowSeconds(now));

    const signer = recoverSigner(typedData, signature);
    if (!signer) throw new DomainError("VALIDATION", "Invalid signature.", { signature: "Invalid signature." });
    const signerKeyId = await requireSigningKey(tx, ctx.organisationId, signer, unixSecondsToDate(issuedAt), now, scope.memberId);

    // Conditional update is the gate: exactly one accept can move AWAITING_SIGNATURE -> SIGNED.
    const { count } = await tx.credential.updateMany({
      where: { id: ctx.id, organisationId: scope.organisationId, pipelineStatus: "AWAITING_SIGNATURE", issuedAt: null },
      data: { pipelineStatus: "SIGNED", issuedAt: unixSecondsToDate(issuedAt), supersedesCredentialId: supersedes.rowId },
    });
    if (count !== 1) throw new DomainError("CONFLICT", "This credential has already been signed.");

    const chainId = Number(domain.chainId);
    if (!Number.isSafeInteger(chainId) || chainId > 2147483647) throw new DomainError("CONFLICT", "Unsupported chain id.");
    const attestation = await tx.attestation.create({
      data: {
        kind: "CREDENTIAL",
        credentialRowId: ctx.id,
        organisationId: ctx.organisationId,
        signerKeyId,
        typedDataHash: hash,
        signature,
        nonce,
        issuedAt: unixSecondsToDate(issuedAt),
        chainId,
        verifyingContract: domain.verifyingContract,
      },
      select: { id: true },
    });

    await audit(tx, scope, "CREDENTIAL_SIGNED", "Credential", ctx.id, {
      attestationId: attestation.id,
      signerKeyId,
      claimVersionId: ctx.claimVersionId,
    });
    return { credentialRowId: ctx.id, attestationId: attestation.id, typedDataHash: hash, idempotent: false };
  }).catch((e) => {
    // Unique violations here mean a concurrent duplicate of the same attestation/nonce/hash.
    if (isUniqueViolation(e)) throw new DomainError("CONFLICT", "This signature has already been used.");
    throw e;
  });

  // Merkle queuing runs in its OWN transaction so a tree/batch conflict never loses an accepted
  // signature, and it is idempotent, so a retry (or enqueuePendingForOrganisation) completes it.
  let pipelineStatus: AcceptedSigning["pipelineStatus"] = "SIGNED";
  let queued = false;
  let queueError: string | undefined;
  if (opts.enqueue !== false) {
    try {
      pipelineStatus = (await enqueueSignedCredential(db, scope, accepted.credentialRowId, { now })).pipelineStatus;
      queued = pipelineStatus === "QUEUED_FOR_ANCHOR";
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      queueError = e.message;
    }
  }
  return { ...accepted, pipelineStatus, queued, ...(queueError ? { queueError } : {}) };
}
