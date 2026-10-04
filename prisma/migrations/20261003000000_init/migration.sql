-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CANDIDATE', 'ISSUER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "OrganisationKind" AS ENUM ('EMPLOYER', 'EDUCATION', 'LICENSING_BODY', 'ASSOCIATION', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('EXPERIENCE', 'EDUCATION', 'CERTIFICATION', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "LifecycleType" AS ENUM ('PERMANENT', 'CONTINUING', 'EXPIRING');

-- CreateEnum
CREATE TYPE "VersionAuthor" AS ENUM ('CANDIDATE', 'ISSUER');

-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('IDENTITY_NOT_MATCHED', 'RECORD_NOT_FOUND', 'DATES_MISMATCH', 'TITLE_MISMATCH', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialPipelineStatus" AS ENUM ('AWAITING_SIGNATURE', 'SIGNED', 'QUEUED_FOR_ANCHOR', 'ANCHORED');

-- CreateEnum
CREATE TYPE "AttestationKind" AS ENUM ('CREDENTIAL', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "AttestationType" AS ENUM ('COHORT', 'PROOF_PULSE');

-- CreateEnum
CREATE TYPE "CohortBatchStatus" AS ENUM ('OPEN', 'SEALED', 'ANCHORED');

-- CreateEnum
CREATE TYPE "PulseScope" AS ENUM ('EMPLOYMENT', 'ENROLMENT', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "PulseLeafStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "PulseUpdateKind" AS ENUM ('INSERT', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "RevocationReason" AS ENUM ('ISSUED_IN_ERROR', 'FRAUD', 'RECORD_CORRECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "TxPurpose" AS ENUM ('REGISTER_ORGANISATION', 'SET_ORGANISATION_STATUS', 'AUTHORISE_ISSUER_KEY', 'RETIRE_ISSUER_KEY', 'MARK_ISSUER_KEY_COMPROMISED', 'ANCHOR_COHORT', 'ANCHOR_PROOF_PULSE', 'REVOKE_CREDENTIAL');

-- CreateEnum
CREATE TYPE "TxTargetType" AS ENUM ('ORGANISATION', 'ISSUER_KEY', 'COHORT_BATCH', 'PROOF_PULSE_TREE', 'CREDENTIAL');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FINALIZED', 'FAILED', 'DROPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "authUserId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "location" TEXT,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "orgId" CHAR(66) NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "OrganisationKind" NOT NULL,
    "status" "OrganisationStatus" NOT NULL DEFAULT 'PENDING_ONBOARDING',
    "pulseFreshnessDays" INTEGER NOT NULL DEFAULT 45,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationMember" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMPTZ(3),
    "removedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganisationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuerKey" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "walletAddress" CHAR(42) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "compromisedAt" TIMESTAMPTZ(3),
    "operatorMemberId" UUID,
    "authoriseTransactionId" UUID,
    "retireTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuerKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "category" "ClaimCategory" NOT NULL,
    "organisationId" UUID,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimVersion" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "proposedLifecycleType" "LifecycleType" NOT NULL,
    "authoredBy" "VersionAuthor" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" UUID NOT NULL,
    "claimVersionId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "institutionalIdentifier" TEXT,
    "candidateNote" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "reviewerMemberId" UUID NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "rejectionReason" "RejectionReason",
    "notes" TEXT,
    "sourceOfTruthReference" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "claimVersionId" UUID NOT NULL,
    "reviewDecisionId" UUID,
    "lifecycleType" "LifecycleType" NOT NULL,
    "pipelineStatus" "CredentialPipelineStatus" NOT NULL DEFAULT 'AWAITING_SIGNATURE',
    "credentialId" CHAR(66),
    "credentialSalt" CHAR(66),
    "contentSalt" CHAR(66),
    "subjectSalt" CHAR(66),
    "subjectCommitment" CHAR(66),
    "contentDigest" CHAR(66),
    "validFrom" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "supersedesCredentialId" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" UUID NOT NULL,
    "kind" "AttestationKind" NOT NULL,
    "credentialRowId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "signerKeyId" UUID NOT NULL,
    "typedDataHash" CHAR(66) NOT NULL,
    "signature" CHAR(132) NOT NULL,
    "nonce" CHAR(66) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "verifyingContract" CHAR(42) NOT NULL,
    "statusSeq" INTEGER,
    "newStatus" "PulseLeafStatus",
    "effectiveAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortBatch" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "CohortBatchStatus" NOT NULL DEFAULT 'OPEN',
    "batchRoot" CHAR(66),
    "leafCount" INTEGER,
    "sealedAt" TIMESTAMPTZ(3),
    "anchorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CohortBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortLeaf" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "credentialRowId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "leafHash" CHAR(66) NOT NULL,
    "proof" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CohortLeaf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "attestationType" "AttestationType" NOT NULL,
    "epoch" INTEGER NOT NULL,
    "batchRoot" CHAR(66) NOT NULL,
    "previousChainRoot" CHAR(66) NOT NULL,
    "chainRoot" CHAR(66) NOT NULL,
    "rootSeq" INTEGER,
    "leafCount" INTEGER NOT NULL,
    "anchorerKeyId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPulseTree" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 20,
    "currentRoot" CHAR(66),
    "currentRootSeq" INTEGER NOT NULL DEFAULT 0,
    "nextLeafIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProofPulseTree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPulseLeaf" (
    "id" UUID NOT NULL,
    "treeId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "credentialRowId" UUID NOT NULL,
    "leafIndex" INTEGER NOT NULL,
    "scope" "PulseScope" NOT NULL,
    "status" "PulseLeafStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusSeq" INTEGER NOT NULL DEFAULT 1,
    "statusEffectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "leafHash" CHAR(66),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProofPulseLeaf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPulseNode" (
    "treeId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "hash" CHAR(66) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProofPulseNode_pkey" PRIMARY KEY ("treeId","level","position")
);

-- CreateTable
CREATE TABLE "ProofPulseUpdate" (
    "id" UUID NOT NULL,
    "treeId" UUID NOT NULL,
    "rootSeq" INTEGER NOT NULL,
    "kind" "PulseUpdateKind" NOT NULL,
    "leafIndex" INTEGER NOT NULL,
    "newLeafHash" CHAR(66) NOT NULL,
    "previousRoot" CHAR(66),
    "newRoot" CHAR(66) NOT NULL,
    "causedByAttestationId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofPulseUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revocation" (
    "id" UUID NOT NULL,
    "credentialRowId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "revokerKeyId" UUID NOT NULL,
    "reasonCode" "RevocationReason" NOT NULL,
    "transactionId" UUID NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "revokedAt" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "purpose" "TxPurpose" NOT NULL,
    "targetType" "TxTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "targetSequence" INTEGER,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "fromAddress" CHAR(42) NOT NULL,
    "initiatedByUserId" UUID NOT NULL,
    "organisationId" UUID,
    "blockNumber" BIGINT,
    "blockHash" CHAR(66),
    "failureReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "finalizedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" "UserRole",
    "organisationId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "beforeDigest" TEXT,
    "afterDigest" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_orgId_key" ON "Organisation"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "OrganisationMember_organisationId_status_idx" ON "OrganisationMember"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationMember_id_organisationId_key" ON "OrganisationMember"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerKey_walletAddress_key" ON "IssuerKey"("walletAddress");

-- CreateIndex
CREATE INDEX "IssuerKey_organisationId_idx" ON "IssuerKey"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerKey_id_organisationId_key" ON "IssuerKey"("id", "organisationId");

-- CreateIndex
CREATE INDEX "Claim_candidateId_idx" ON "Claim"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimVersion_claimId_versionNumber_key" ON "ClaimVersion"("claimId", "versionNumber");

-- CreateIndex
CREATE INDEX "VerificationRequest_organisationId_status_submittedAt_idx" ON "VerificationRequest"("organisationId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_claimVersionId_idx" ON "VerificationRequest"("claimVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequest_id_organisationId_key" ON "VerificationRequest"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_verificationRequestId_key" ON "ReviewDecision"("verificationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_verificationRequestId_organisationId_key" ON "ReviewDecision"("verificationRequestId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_claimVersionId_key" ON "Credential"("claimVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_reviewDecisionId_key" ON "Credential"("reviewDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_credentialId_key" ON "Credential"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_supersedesCredentialId_key" ON "Credential"("supersedesCredentialId");

-- CreateIndex
CREATE INDEX "Credential_organisationId_pipelineStatus_idx" ON "Credential"("organisationId", "pipelineStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_id_organisationId_key" ON "Credential"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Attestation_typedDataHash_key" ON "Attestation"("typedDataHash");

-- CreateIndex
CREATE INDEX "Attestation_credentialRowId_idx" ON "Attestation"("credentialRowId");

-- CreateIndex
CREATE UNIQUE INDEX "Attestation_signerKeyId_nonce_key" ON "Attestation"("signerKeyId", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "CohortBatch_anchorId_key" ON "CohortBatch"("anchorId");

-- CreateIndex
CREATE INDEX "CohortBatch_organisationId_status_idx" ON "CohortBatch"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CohortBatch_anchorId_organisationId_key" ON "CohortBatch"("anchorId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortBatch_id_organisationId_key" ON "CohortBatch"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortLeaf_credentialRowId_key" ON "CohortLeaf"("credentialRowId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortLeaf_credentialRowId_organisationId_key" ON "CohortLeaf"("credentialRowId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortLeaf_batchId_position_key" ON "CohortLeaf"("batchId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CohortLeaf_batchId_leafHash_key" ON "CohortLeaf"("batchId", "leafHash");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_chainRoot_key" ON "Anchor"("chainRoot");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_transactionId_key" ON "Anchor"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_id_organisationId_key" ON "Anchor"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_organisationId_attestationType_epoch_key" ON "Anchor"("organisationId", "attestationType", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_organisationId_attestationType_previousChainRoot_key" ON "Anchor"("organisationId", "attestationType", "previousChainRoot");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseTree_organisationId_key" ON "ProofPulseTree"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseTree_id_organisationId_key" ON "ProofPulseTree"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseLeaf_credentialRowId_key" ON "ProofPulseLeaf"("credentialRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseLeaf_credentialRowId_organisationId_key" ON "ProofPulseLeaf"("credentialRowId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseLeaf_treeId_leafIndex_key" ON "ProofPulseLeaf"("treeId", "leafIndex");

-- CreateIndex
CREATE INDEX "ProofPulseUpdate_treeId_leafIndex_rootSeq_idx" ON "ProofPulseUpdate"("treeId", "leafIndex", "rootSeq");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPulseUpdate_treeId_rootSeq_key" ON "ProofPulseUpdate"("treeId", "rootSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Revocation_credentialRowId_key" ON "Revocation"("credentialRowId");

-- CreateIndex
CREATE UNIQUE INDEX "Revocation_transactionId_key" ON "Revocation"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Revocation_credentialRowId_organisationId_key" ON "Revocation"("credentialRowId", "organisationId");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_status_idx" ON "BlockchainTransaction"("status");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_targetType_targetId_idx" ON "BlockchainTransaction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_organisationId_purpose_idx" ON "BlockchainTransaction"("organisationId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_chainId_txHash_key" ON "BlockchainTransaction"("chainId", "txHash");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_occurredAt_idx" ON "AuditEvent"("organisationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssuerKey" ADD CONSTRAINT "IssuerKey_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssuerKey" ADD CONSTRAINT "IssuerKey_operatorMemberId_fkey" FOREIGN KEY ("operatorMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssuerKey" ADD CONSTRAINT "IssuerKey_authoriseTransactionId_fkey" FOREIGN KEY ("authoriseTransactionId") REFERENCES "BlockchainTransaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssuerKey" ADD CONSTRAINT "IssuerKey_retireTransactionId_fkey" FOREIGN KEY ("retireTransactionId") REFERENCES "BlockchainTransaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_claimVersionId_fkey" FOREIGN KEY ("claimVersionId") REFERENCES "ClaimVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_verificationRequestId_organisationId_fkey" FOREIGN KEY ("verificationRequestId", "organisationId") REFERENCES "VerificationRequest"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerMemberId_organisationId_fkey" FOREIGN KEY ("reviewerMemberId", "organisationId") REFERENCES "OrganisationMember"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_claimVersionId_fkey" FOREIGN KEY ("claimVersionId") REFERENCES "ClaimVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_reviewDecisionId_fkey" FOREIGN KEY ("reviewDecisionId") REFERENCES "ReviewDecision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_supersedesCredentialId_fkey" FOREIGN KEY ("supersedesCredentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_credentialRowId_organisationId_fkey" FOREIGN KEY ("credentialRowId", "organisationId") REFERENCES "Credential"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_signerKeyId_organisationId_fkey" FOREIGN KEY ("signerKeyId", "organisationId") REFERENCES "IssuerKey"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CohortBatch" ADD CONSTRAINT "CohortBatch_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CohortBatch" ADD CONSTRAINT "CohortBatch_anchorId_organisationId_fkey" FOREIGN KEY ("anchorId", "organisationId") REFERENCES "Anchor"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CohortLeaf" ADD CONSTRAINT "CohortLeaf_batchId_organisationId_fkey" FOREIGN KEY ("batchId", "organisationId") REFERENCES "CohortBatch"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CohortLeaf" ADD CONSTRAINT "CohortLeaf_credentialRowId_organisationId_fkey" FOREIGN KEY ("credentialRowId", "organisationId") REFERENCES "Credential"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CohortLeaf" ADD CONSTRAINT "CohortLeaf_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_anchorerKeyId_organisationId_fkey" FOREIGN KEY ("anchorerKeyId", "organisationId") REFERENCES "IssuerKey"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BlockchainTransaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseTree" ADD CONSTRAINT "ProofPulseTree_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseLeaf" ADD CONSTRAINT "ProofPulseLeaf_treeId_organisationId_fkey" FOREIGN KEY ("treeId", "organisationId") REFERENCES "ProofPulseTree"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseLeaf" ADD CONSTRAINT "ProofPulseLeaf_credentialRowId_organisationId_fkey" FOREIGN KEY ("credentialRowId", "organisationId") REFERENCES "Credential"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseLeaf" ADD CONSTRAINT "ProofPulseLeaf_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseNode" ADD CONSTRAINT "ProofPulseNode_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "ProofPulseTree"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseUpdate" ADD CONSTRAINT "ProofPulseUpdate_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "ProofPulseTree"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofPulseUpdate" ADD CONSTRAINT "ProofPulseUpdate_causedByAttestationId_fkey" FOREIGN KEY ("causedByAttestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_credentialRowId_organisationId_fkey" FOREIGN KEY ("credentialRowId", "organisationId") REFERENCES "Credential"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_revokerKeyId_organisationId_fkey" FOREIGN KEY ("revokerKeyId", "organisationId") REFERENCES "IssuerKey"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BlockchainTransaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ═══════════════════════════════════════════════════════════════════════════
-- FARJI custom invariants (hand-written; Prisma cannot express these).
-- Everything below enforces rules from docs/DOMAIN_MODEL.md and
-- docs/SECURITY_MODEL.md at the database level.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── 1. Partial unique indexes ─────────────

-- An issuer user belongs to at most one live organisation membership.
CREATE UNIQUE INDEX "OrganisationMember_one_live_membership_per_user"
  ON "OrganisationMember" ("userId") WHERE "status" IN ('INVITED', 'ACTIVE');

-- Only one open verification request per exact ClaimVersion.
CREATE UNIQUE INDEX "VerificationRequest_one_open_per_claim_version"
  ON "VerificationRequest" ("claimVersionId") WHERE "status" IN ('SUBMITTED', 'IN_REVIEW');

-- One CREDENTIAL attestation per credential; one STATUS_CHANGE per (credential, statusSeq).
CREATE UNIQUE INDEX "Attestation_one_credential_attestation"
  ON "Attestation" ("credentialRowId") WHERE "kind" = 'CREDENTIAL';
CREATE UNIQUE INDEX "Attestation_one_status_change_per_seq"
  ON "Attestation" ("credentialRowId", "statusSeq") WHERE "kind" = 'STATUS_CHANGE';

-- At most one OPEN cohort batch per organisation.
CREATE UNIQUE INDEX "CohortBatch_one_open_per_organisation"
  ON "CohortBatch" ("organisationId") WHERE "status" = 'OPEN';

-- ───────────── 2. Hex format CHECKs (lowercase 0x-hex) ─────────────

DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    -- table, column, hex digits
    ['Organisation','orgId','64'],
    ['IssuerKey','walletAddress','40'],
    ['Credential','credentialId','64'],
    ['Credential','credentialSalt','64'],
    ['Credential','contentSalt','64'],
    ['Credential','subjectSalt','64'],
    ['Credential','subjectCommitment','64'],
    ['Credential','contentDigest','64'],
    ['Attestation','typedDataHash','64'],
    ['Attestation','nonce','64'],
    ['Attestation','signature','130'],
    ['Attestation','verifyingContract','40'],
    ['CohortBatch','batchRoot','64'],
    ['CohortLeaf','leafHash','64'],
    ['Anchor','batchRoot','64'],
    ['Anchor','previousChainRoot','64'],
    ['Anchor','chainRoot','64'],
    ['ProofPulseTree','currentRoot','64'],
    ['ProofPulseLeaf','leafHash','64'],
    ['ProofPulseNode','hash','64'],
    ['ProofPulseUpdate','newLeafHash','64'],
    ['ProofPulseUpdate','previousRoot','64'],
    ['ProofPulseUpdate','newRoot','64'],
    ['BlockchainTransaction','txHash','64'],
    ['BlockchainTransaction','blockHash','64'],
    ['BlockchainTransaction','fromAddress','40']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I ~ %L)',
      spec[1], spec[1] || '_' || spec[2] || '_hex_check', spec[2], '^0x[0-9a-f]{' || spec[3] || '}$'
    );
  END LOOP;
END $$;

-- ───────────── 3. CHECK constraints ─────────────

ALTER TABLE "Profile" ADD CONSTRAINT "Profile_handle_format_check"
  CHECK ("handle" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

ALTER TABLE "Organisation"
  ADD CONSTRAINT "Organisation_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Organisation_pulseFreshnessDays_check" CHECK ("pulseFreshnessDays" BETWEEN 1 AND 3650);

ALTER TABLE "IssuerKey"
  ADD CONSTRAINT "IssuerKey_valid_period_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom"),
  ADD CONSTRAINT "IssuerKey_compromised_after_start_check" CHECK ("compromisedAt" IS NULL OR "compromisedAt" >= "validFrom");

ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_versionNumber_check" CHECK ("versionNumber" >= 1);

-- A REJECT carries a reason code; an APPROVE does not.
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reason_matches_decision_check"
  CHECK (("decision" = 'REJECT') = ("rejectionReason" IS NOT NULL));

ALTER TABLE "Credential"
  -- validUntil exists exactly for EXPIRING credentials.
  ADD CONSTRAINT "Credential_validUntil_iff_expiring_check" CHECK (("lifecycleType" = 'EXPIRING') = ("validUntil" IS NOT NULL)),
  ADD CONSTRAINT "Credential_valid_period_check" CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom"),
  ADD CONSTRAINT "Credential_not_self_superseding_check" CHECK ("supersedesCredentialId" IS NULL OR "supersedesCredentialId" <> "id"),
  -- credentialSalt becomes public on revocation, so it must never equal the private salts.
  ADD CONSTRAINT "Credential_distinct_salts_check" CHECK (
    ("credentialSalt" IS NULL OR "contentSalt" IS NULL OR "credentialSalt" <> "contentSalt")
    AND ("credentialSalt" IS NULL OR "subjectSalt" IS NULL OR "credentialSalt" <> "subjectSalt")
    AND ("contentSalt" IS NULL OR "subjectSalt" IS NULL OR "contentSalt" <> "subjectSalt")
  ),
  -- Cryptographic material is required once the credential is past AWAITING_SIGNATURE.
  ADD CONSTRAINT "Credential_crypto_required_after_signing_check" CHECK (
    "pipelineStatus" = 'AWAITING_SIGNATURE'
    OR ("credentialId" IS NOT NULL AND "credentialSalt" IS NOT NULL AND "contentSalt" IS NOT NULL
        AND "subjectSalt" IS NOT NULL AND "subjectCommitment" IS NOT NULL AND "contentDigest" IS NOT NULL
        AND "validFrom" IS NOT NULL AND "issuedAt" IS NOT NULL)
  );

ALTER TABLE "Attestation"
  ADD CONSTRAINT "Attestation_chainId_check" CHECK ("chainId" > 0),
  ADD CONSTRAINT "Attestation_kind_columns_check" CHECK (
    ("kind" = 'CREDENTIAL' AND "statusSeq" IS NULL AND "newStatus" IS NULL AND "effectiveAt" IS NULL)
    OR ("kind" = 'STATUS_CHANGE' AND "statusSeq" >= 1 AND "newStatus" IS NOT NULL AND "effectiveAt" IS NOT NULL)
  );

ALTER TABLE "CohortBatch"
  ADD CONSTRAINT "CohortBatch_sealed_requires_root_check" CHECK (
    "status" = 'OPEN' OR ("batchRoot" IS NOT NULL AND "leafCount" IS NOT NULL AND "sealedAt" IS NOT NULL)),
  ADD CONSTRAINT "CohortBatch_anchored_requires_anchor_check" CHECK ("status" <> 'ANCHORED' OR "anchorId" IS NOT NULL),
  ADD CONSTRAINT "CohortBatch_leafCount_check" CHECK ("leafCount" IS NULL OR "leafCount" > 0);

ALTER TABLE "CohortLeaf" ADD CONSTRAINT "CohortLeaf_position_check" CHECK ("position" >= 0);

ALTER TABLE "Anchor"
  ADD CONSTRAINT "Anchor_epoch_check" CHECK ("epoch" >= 1),
  ADD CONSTRAINT "Anchor_leafCount_check" CHECK ("leafCount" >= 0),
  -- rootSeq exists exactly for PROOF_PULSE anchors.
  ADD CONSTRAINT "Anchor_rootSeq_iff_proof_pulse_check" CHECK (("attestationType" = 'PROOF_PULSE') = ("rootSeq" IS NOT NULL)),
  -- Epoch 1 starts from the zero hash; later epochs must link to a real previous chainRoot.
  ADD CONSTRAINT "Anchor_genesis_link_check" CHECK (
    ("epoch" = 1) = ("previousChainRoot" = '0x0000000000000000000000000000000000000000000000000000000000000000'));

ALTER TABLE "ProofPulseTree"
  ADD CONSTRAINT "ProofPulseTree_depth_check" CHECK ("depth" BETWEEN 1 AND 32),
  ADD CONSTRAINT "ProofPulseTree_counters_check" CHECK ("currentRootSeq" >= 0 AND "nextLeafIndex" >= 0);

ALTER TABLE "ProofPulseLeaf" ADD CONSTRAINT "ProofPulseLeaf_counters_check" CHECK ("leafIndex" >= 0 AND "statusSeq" >= 1);
ALTER TABLE "ProofPulseNode" ADD CONSTRAINT "ProofPulseNode_coordinates_check" CHECK ("level" >= 0 AND "position" >= 0);
ALTER TABLE "ProofPulseUpdate" ADD CONSTRAINT "ProofPulseUpdate_counters_check" CHECK ("rootSeq" >= 1 AND "leafIndex" >= 0);

ALTER TABLE "BlockchainTransaction"
  ADD CONSTRAINT "BlockchainTransaction_chainId_check" CHECK ("chainId" > 0),
  -- A transaction is never CONFIRMED/FINALIZED without an observed block.
  ADD CONSTRAINT "BlockchainTransaction_confirmed_requires_block_check" CHECK (
    "status" NOT IN ('CONFIRMED', 'FINALIZED') OR ("blockNumber" IS NOT NULL AND "blockHash" IS NOT NULL)),
  ADD CONSTRAINT "BlockchainTransaction_finalized_requires_time_check" CHECK (
    "status" <> 'FINALIZED' OR "finalizedAt" IS NOT NULL);

-- ───────────── 4. Trigger functions ─────────────
-- Messages start with "FARJI:" so tests and services can recognise them.

CREATE FUNCTION farji_forbid_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'FARJI: rows in % cannot be deleted', TG_TABLE_NAME;
END $$;

CREATE FUNCTION farji_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'FARJI: % is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END $$;

-- TG_ARGV: columns that may never change after insert.
CREATE FUNCTION farji_immutable_columns() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD) -> c) IS DISTINCT FROM (to_jsonb(NEW) -> c) THEN
      RAISE EXCEPTION 'FARJI: %.% is immutable', TG_TABLE_NAME, c;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- TG_ARGV: columns that may be set once (from NULL) and never changed afterwards.
CREATE FUNCTION farji_write_once() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD) -> c) <> 'null'::jsonb AND (to_jsonb(OLD) -> c) IS DISTINCT FROM (to_jsonb(NEW) -> c) THEN
      RAISE EXCEPTION 'FARJI: %.% is write-once', TG_TABLE_NAME, c;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- TG_ARGV: integer columns that may only increase.
CREATE FUNCTION farji_monotonic_increase() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) ->> c)::bigint < (to_jsonb(OLD) ->> c)::bigint THEN
      RAISE EXCEPTION 'FARJI: %.% may only increase', TG_TABLE_NAME, c;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Only ISSUER-role users can hold an organisation membership.
CREATE FUNCTION farji_member_must_be_issuer() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT "role"::text FROM "User" WHERE "id" = NEW."userId") IS DISTINCT FROM 'ISSUER' THEN
    RAISE EXCEPTION 'FARJI: only ISSUER users can be organisation members';
  END IF;
  RETURN NEW;
END $$;

-- Terminal verification requests never change status again.
CREATE FUNCTION farji_request_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD."status"::text IN ('APPROVED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED')
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'FARJI: a % verification request cannot change status', OLD."status";
  END IF;
  RETURN NEW;
END $$;

-- A reviewer must be an ACTIVE member and can never review their own claim.
CREATE FUNCTION farji_review_decision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE reviewer_user uuid; reviewer_status text; claim_owner uuid;
BEGIN
  SELECT "userId", "status"::text INTO reviewer_user, reviewer_status
    FROM "OrganisationMember" WHERE "id" = NEW."reviewerMemberId";
  SELECT "candidateId" INTO claim_owner FROM "VerificationRequest" WHERE "id" = NEW."verificationRequestId";
  IF reviewer_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'FARJI: reviewer must be an ACTIVE organisation member';
  END IF;
  IF reviewer_user = claim_owner THEN
    RAISE EXCEPTION 'FARJI: a reviewer cannot review their own claim';
  END IF;
  RETURN NEW;
END $$;

-- Credential pipeline status only moves forward.
CREATE FUNCTION farji_credential_pipeline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE old_rank int; new_rank int;
BEGIN
  old_rank := CASE OLD."pipelineStatus"::text WHEN 'AWAITING_SIGNATURE' THEN 1 WHEN 'SIGNED' THEN 2 WHEN 'QUEUED_FOR_ANCHOR' THEN 3 ELSE 4 END;
  new_rank := CASE NEW."pipelineStatus"::text WHEN 'AWAITING_SIGNATURE' THEN 1 WHEN 'SIGNED' THEN 2 WHEN 'QUEUED_FOR_ANCHOR' THEN 3 ELSE 4 END;
  IF new_rank < old_rank THEN
    RAISE EXCEPTION 'FARJI: credential pipeline status cannot move backwards';
  END IF;
  RETURN NEW;
END $$;

-- Cohort batch status only moves forward.
CREATE FUNCTION farji_cohort_batch_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE old_rank int; new_rank int;
BEGIN
  old_rank := CASE OLD."status"::text WHEN 'OPEN' THEN 1 WHEN 'SEALED' THEN 2 ELSE 3 END;
  new_rank := CASE NEW."status"::text WHEN 'OPEN' THEN 1 WHEN 'SEALED' THEN 2 ELSE 3 END;
  IF new_rank < old_rank THEN
    RAISE EXCEPTION 'FARJI: cohort batch status cannot move backwards';
  END IF;
  RETURN NEW;
END $$;

-- Cohort leaves: only into an OPEN batch, never for CONTINUING credentials; frozen once sealed.
CREATE FUNCTION farji_cohort_leaf_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE batch_status text; lifecycle text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status"::text INTO batch_status FROM "CohortBatch" WHERE "id" = NEW."batchId";
    SELECT "lifecycleType"::text INTO lifecycle FROM "Credential" WHERE "id" = NEW."credentialRowId";
    IF batch_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION 'FARJI: leaves can only be added to an OPEN cohort batch';
    END IF;
    IF lifecycle = 'CONTINUING' THEN
      RAISE EXCEPTION 'FARJI: CONTINUING credentials belong in ProofPulse, not CohortProof';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT "status"::text INTO batch_status FROM "CohortBatch" WHERE "id" = OLD."batchId";
    IF batch_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION 'FARJI: leaves of a sealed cohort batch cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: identity is frozen; the proof is written once.
  IF (OLD."batchId", OLD."credentialRowId", OLD."organisationId", OLD."position", OLD."leafHash")
     IS DISTINCT FROM (NEW."batchId", NEW."credentialRowId", NEW."organisationId", NEW."position", NEW."leafHash") THEN
    RAISE EXCEPTION 'FARJI: cohort leaf identity is immutable';
  END IF;
  IF OLD."proof" IS NOT NULL AND OLD."proof" IS DISTINCT FROM NEW."proof" THEN
    RAISE EXCEPTION 'FARJI: cohort leaf proof is write-once';
  END IF;
  RETURN NEW;
END $$;

-- ProofPulse leaves are for CONTINUING credentials only; ENDED never reverts; statusSeq never decreases.
CREATE FUNCTION farji_proofpulse_leaf_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE lifecycle text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "lifecycleType"::text INTO lifecycle FROM "Credential" WHERE "id" = NEW."credentialRowId";
    IF lifecycle IS DISTINCT FROM 'CONTINUING' THEN
      RAISE EXCEPTION 'FARJI: only CONTINUING credentials can have a ProofPulse leaf';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status"::text = 'ENDED' AND NEW."status"::text <> 'ENDED' THEN
    RAISE EXCEPTION 'FARJI: an ENDED ProofPulse leaf cannot become ACTIVE again';
  END IF;
  IF NEW."statusSeq" < OLD."statusSeq" THEN
    RAISE EXCEPTION 'FARJI: ProofPulse statusSeq may only increase';
  END IF;
  RETURN NEW;
END $$;

-- Anchors and revocations are only recorded from an OBSERVED (CONFIRMED/FINALIZED)
-- transaction of the matching purpose. Finality policy itself is read from the transaction.
CREATE FUNCTION farji_anchor_tx_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tx_status text; tx_purpose text; expected text;
BEGIN
  SELECT "status"::text, "purpose"::text INTO tx_status, tx_purpose FROM "BlockchainTransaction" WHERE "id" = NEW."transactionId";
  expected := CASE NEW."attestationType"::text WHEN 'COHORT' THEN 'ANCHOR_COHORT' ELSE 'ANCHOR_PROOF_PULSE' END;
  IF tx_status IS NULL OR tx_status NOT IN ('CONFIRMED', 'FINALIZED') THEN
    RAISE EXCEPTION 'FARJI: an Anchor requires a CONFIRMED or FINALIZED transaction';
  END IF;
  IF tx_purpose <> expected THEN
    RAISE EXCEPTION 'FARJI: transaction purpose % does not match attestation type %', tx_purpose, NEW."attestationType";
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION farji_revocation_tx_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tx_status text; tx_purpose text;
BEGIN
  SELECT "status"::text, "purpose"::text INTO tx_status, tx_purpose FROM "BlockchainTransaction" WHERE "id" = NEW."transactionId";
  IF tx_status IS NULL OR tx_status NOT IN ('CONFIRMED', 'FINALIZED') THEN
    RAISE EXCEPTION 'FARJI: a Revocation requires a CONFIRMED or FINALIZED transaction';
  END IF;
  IF tx_purpose <> 'REVOKE_CREDENTIAL' THEN
    RAISE EXCEPTION 'FARJI: transaction purpose % is not REVOKE_CREDENTIAL', tx_purpose;
  END IF;
  RETURN NEW;
END $$;

-- Transactions are born PENDING; only legal transitions are allowed afterwards.
-- (Who may change status — server-side chain sync only — is enforced by the service layer.)
CREATE FUNCTION farji_transaction_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text <> 'PENDING' OR NEW."blockNumber" IS NOT NULL OR NEW."blockHash" IS NOT NULL
       OR NEW."confirmedAt" IS NOT NULL OR NEW."finalizedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'FARJI: a transaction must be inserted as PENDING with no block data';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status"::text IN ('FINALIZED', 'FAILED', 'DROPPED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'FARJI: a % transaction is terminal', OLD."status";
  END IF;
  IF OLD."status"::text = 'FINALIZED'
     AND (NEW."blockNumber", NEW."blockHash") IS DISTINCT FROM (OLD."blockNumber", OLD."blockHash") THEN
    RAISE EXCEPTION 'FARJI: block data of a FINALIZED transaction is immutable';
  END IF;
  IF OLD."status"::text = 'PENDING' AND NEW."status"::text = 'FINALIZED' THEN
    RAISE EXCEPTION 'FARJI: a transaction must be CONFIRMED before it can be FINALIZED';
  END IF;
  IF OLD."status"::text = 'CONFIRMED' AND NEW."status"::text = 'FAILED' THEN
    RAISE EXCEPTION 'FARJI: a CONFIRMED transaction cannot become FAILED';
  END IF;
  RETURN NEW;
END $$;

-- ───────────── 5. Triggers ─────────────

-- No deletion of history-bearing or identity rows.
CREATE TRIGGER no_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Organisation" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "OrganisationMember" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "IssuerKey" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Claim" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "VerificationRequest" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Credential" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "CohortBatch" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "ProofPulseTree" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "ProofPulseLeaf" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "BlockchainTransaction" FOR EACH ROW EXECUTE FUNCTION farji_forbid_delete();

-- Append-only evidence: no UPDATE, no DELETE.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "ClaimVersion" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "ReviewDecision" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "Attestation" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "Anchor" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "ProofPulseUpdate" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "Revocation" FOR EACH ROW EXECUTE FUNCTION farji_append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION farji_append_only();

-- Identity columns.
CREATE TRIGGER immutable BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('authUserId');
CREATE TRIGGER immutable BEFORE UPDATE ON "Organisation" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('orgId');
CREATE TRIGGER immutable BEFORE UPDATE ON "OrganisationMember" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('userId', 'organisationId');
CREATE TRIGGER immutable BEFORE UPDATE ON "Claim" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('candidateId', 'category');
CREATE TRIGGER immutable BEFORE UPDATE ON "VerificationRequest" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('claimVersionId', 'organisationId', 'candidateId', 'submittedAt');
CREATE TRIGGER immutable BEFORE UPDATE ON "Credential" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('organisationId', 'claimVersionId', 'lifecycleType', 'createdAt');
CREATE TRIGGER immutable BEFORE UPDATE ON "CohortBatch" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('organisationId');
CREATE TRIGGER immutable BEFORE UPDATE ON "ProofPulseTree" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('organisationId', 'depth');
CREATE TRIGGER immutable BEFORE UPDATE ON "ProofPulseLeaf" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('treeId', 'organisationId', 'credentialRowId', 'leafIndex', 'scope');
CREATE TRIGGER immutable BEFORE UPDATE ON "BlockchainTransaction" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns(
  'chainId', 'txHash', 'purpose', 'targetType', 'targetId', 'targetSequence', 'fromAddress', 'initiatedByUserId', 'organisationId', 'submittedAt');

-- IssuerKey: a wallet address is bound to one organisation for life and its validity
-- period can only be closed once (retire / compromise), never reopened or edited.
CREATE TRIGGER immutable BEFORE UPDATE ON "IssuerKey" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns('walletAddress', 'organisationId', 'validFrom', 'createdAt');
CREATE TRIGGER write_once BEFORE UPDATE ON "IssuerKey" FOR EACH ROW EXECUTE FUNCTION farji_write_once('validUntil', 'compromisedAt', 'authoriseTransactionId', 'retireTransactionId');

-- Credential evidence columns are set once.
CREATE TRIGGER write_once BEFORE UPDATE ON "Credential" FOR EACH ROW EXECUTE FUNCTION farji_write_once(
  'credentialId', 'credentialSalt', 'contentSalt', 'subjectSalt', 'subjectCommitment', 'contentDigest',
  'validFrom', 'validUntil', 'issuedAt', 'reviewDecisionId', 'supersedesCredentialId');
CREATE TRIGGER pipeline_forward_only BEFORE UPDATE ON "Credential" FOR EACH ROW EXECUTE FUNCTION farji_credential_pipeline_guard();

-- Sealed cohort batches are frozen.
CREATE TRIGGER write_once BEFORE UPDATE ON "CohortBatch" FOR EACH ROW EXECUTE FUNCTION farji_write_once('batchRoot', 'leafCount', 'sealedAt', 'anchorId');
CREATE TRIGGER status_forward_only BEFORE UPDATE ON "CohortBatch" FOR EACH ROW EXECUTE FUNCTION farji_cohort_batch_status_guard();
CREATE TRIGGER cohort_leaf_guard BEFORE INSERT OR UPDATE OR DELETE ON "CohortLeaf" FOR EACH ROW EXECUTE FUNCTION farji_cohort_leaf_guard();

-- ProofPulse counters.
CREATE TRIGGER monotonic BEFORE UPDATE ON "ProofPulseTree" FOR EACH ROW EXECUTE FUNCTION farji_monotonic_increase('currentRootSeq', 'nextLeafIndex');
CREATE TRIGGER leaf_guard BEFORE INSERT OR UPDATE ON "ProofPulseLeaf" FOR EACH ROW EXECUTE FUNCTION farji_proofpulse_leaf_guard();

-- Workflow rules.
CREATE TRIGGER member_must_be_issuer BEFORE INSERT ON "OrganisationMember" FOR EACH ROW EXECUTE FUNCTION farji_member_must_be_issuer();
CREATE TRIGGER request_status_guard BEFORE UPDATE ON "VerificationRequest" FOR EACH ROW EXECUTE FUNCTION farji_request_status_guard();
CREATE TRIGGER review_guard BEFORE INSERT ON "ReviewDecision" FOR EACH ROW EXECUTE FUNCTION farji_review_decision_guard();

-- Chain mirrors require an observed transaction; transactions follow legal transitions.
CREATE TRIGGER tx_guard BEFORE INSERT ON "Anchor" FOR EACH ROW EXECUTE FUNCTION farji_anchor_tx_guard();
CREATE TRIGGER tx_guard BEFORE INSERT ON "Revocation" FOR EACH ROW EXECUTE FUNCTION farji_revocation_tx_guard();
CREATE TRIGGER transaction_guard BEFORE INSERT OR UPDATE ON "BlockchainTransaction" FOR EACH ROW EXECUTE FUNCTION farji_transaction_guard();

-- ───────────── 6. Row Level Security ─────────────
-- Supabase exposes the public schema through its Data API. RLS is enabled with NO
-- policies, so the anon and authenticated roles can read and write nothing. The
-- server reaches the database through Prisma with a server-only connection string.
-- Application access rules are designed in Phase 3.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'Profile', 'Organisation', 'OrganisationMember', 'IssuerKey',
    'Claim', 'ClaimVersion', 'VerificationRequest', 'ReviewDecision',
    'Credential', 'Attestation', 'CohortBatch', 'CohortLeaf', 'Anchor',
    'ProofPulseTree', 'ProofPulseLeaf', 'ProofPulseNode', 'ProofPulseUpdate',
    'Revocation', 'BlockchainTransaction', 'AuditEvent'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
