# FARJI Domain Model

This is the canonical source for FARJI terminology, entities, lifecycle rules
and verification-state derivation. Every other document and all code MUST use
the terms defined here, with the same spelling and meaning.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY_MODEL.md](SECURITY_MODEL.md),
[BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md), [MERKLE_MODEL.md](MERKLE_MODEL.md).

---

## 1. Glossary (canonical terms)

| Term | Meaning |
|---|---|
| **Candidate** | Authenticated user who owns a professional profile and its claims. Never needs a crypto wallet. |
| **Issuer** | Authenticated user who is a member of exactly one Organisation with the ISSUER role, and acts only for that Organisation. |
| **Admin** | Authenticated platform administrator. Governs organisations and issuer wallets. Never issues, attests or revokes credentials. |
| **Public viewer** | Unauthenticated visitor (recruiter, member of the public) viewing public profiles and verification pages. |
| **Organisation** | A real-world institution (employer, university, licensing body, association) registered on FARJI and on-chain. The source of truth for its own records. |
| **Issuer wallet** | An EVM account (secp256k1 key) authorised on-chain to act for one Organisation during one validity period. It is never re-authorised once retired or compromised. In the database it is an `IssuerKey` row. |
| **Issuer key history** | The append-only record of each issuer wallet's single validity period (`validFrom`, `validUntil`, `compromisedAt`) for its Organisation. Rotation adds a new wallet; it never reopens an old one. |
| **Claim** | A Candidate's logical professional record (one job, one degree, one licence). Has a stable identity across edits. |
| **ClaimVersion** | An immutable snapshot of a Claim's content. Editing a Claim creates a new ClaimVersion. |
| **VerificationRequest** | A Candidate's request asking one Organisation to verify one specific ClaimVersion. |
| **ReviewDecision** | An Issuer's recorded decision (APPROVE or REJECT) on a VerificationRequest, including source-of-truth review notes. |
| **Credential** | An Organisation-issued record covering exactly one ClaimVersion's content (one Credential per ClaimVersion in the MVP). Has a `credentialId`, a `lifecycleType` and an issuance pipeline status. |
| **Attestation** | EIP-712 signature evidence: an issuer wallet's signature over a Credential (CredentialAttestation) or over a status change (StatusChangeAttestation). Not to be confused with an Anchor. |
| **Lifecycle type** | One of `PERMANENT`, `CONTINUING`, `EXPIRING`. Fixed per Credential. |
| **Verification state** | One of the eleven derived states in §6. Always computed from evidence; never stored as the source of truth. |
| **CohortProof** | The static Merkle batch engine for PERMANENT and EXPIRING Credentials. See [MERKLE_MODEL.md](MERKLE_MODEL.md). |
| **CohortProof batch** | One static Merkle tree of Credential leaves, anchored once. |
| **ProofPulse** | The incremental Merkle engine for CONTINUING Credentials' current state. |
| **ProofPulse tree** | The persistent incremental Merkle tree of one Organisation (one per Organisation in the MVP; each leaf records its scope: EMPLOYMENT, ENROLMENT or MEMBERSHIP). |
| **ProofPulse epoch** | An Anchor in the Organisation's PROOF_PULSE attestation chain that snapshots the ProofPulse tree's already-current root. |
| **Anchor** | An on-chain record, written by an issuer wallet, appending a Merkle root (`batchRoot`: a CohortProof batch root or a ProofPulse root) to an attestation chain. Identified by its `chainRoot`. |
| **Attestation type** | `COHORT` or `PROOF_PULSE` — the kind of root an Anchor carries. |
| **Attestation chain** | An independent on-chain hash chain of Anchors for one (Organisation, attestation type) pair. See [BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md) §8. |
| **Confirmation/finality policy** | The rule deciding when an on-chain Anchor or Revocation counts as confirmed (default: Ethereum `finalized` block). |
| **Status change** | An issuer-signed change of a CONTINUING Credential's ProofPulse status (`ACTIVE` → `ENDED`). |
| **Revocation** | An on-chain, irreversible statement by the issuing Organisation that a Credential must no longer be relied on. |
| **Supersession** | A newer attested Credential (for a newer ClaimVersion of the same Claim) replacing an older one. |
| **Audit event** | An append-only record of an important mutation, who made it and when. |
| **Proof bundle** | The exportable set of evidence (content, the three salts, attestation, Merkle proof, anchor reference) allowing independent verification. |

Spelling convention: British spelling for domain terms everywhere — *Organisation,
authorise, authorised, enrolment, licence (noun)*. Enum values are
`SCREAMING_SNAKE_CASE` exactly as written in this document.

---

## 2. Roles

| Role | How obtained | Scope |
|---|---|---|
| CANDIDATE | Self sign-up | Own profile, own claims, own requests only |
| ISSUER | Invited by an Admin into one Organisation | That Organisation's requests, credentials, trees and anchors only |
| ADMIN | Provisioned out-of-band (never self sign-up) | Platform governance; no credential issuance or revocation |

Decided for the MVP (ROADMAP D2): exactly one primary application role per account
— CANDIDATE, ISSUER or ADMIN. Organisation membership is modelled separately
(OrganisationMembership, §3.4). Regardless of the account model, an Issuer may never
approve a Claim owned by their own user account.

---

## 3. Entities

The final database model (Phase 2B; `prisma/schema.prisma` is the implementation).
21 tables. "Append-only" means rows are never updated or deleted (enforced by DB
triggers). Every foreign key is `onDelete: Restrict`; nothing cascades. Every primary
key is an internal UUID; blockchain values are unique business identifiers, never
primary keys. Hex values (`bytes32`, addresses, signatures) are stored as lowercase
`0x…` CHAR with format CHECKs. **No table stores a verification state, a verified
flag, a trust score or a reputation score.**

Naming: **Claim / ClaimVersion** = the candidate's editable record and its immutable
snapshots. **Credential** = the organisation-issued record for one ClaimVersion.
**Attestation** = EIP-712 signature evidence. **Anchor** = an observed on-chain entry
in an attestation chain.

### 3.1 User
- `id` (internal UUID), `authUserId` (Supabase Auth user id, unique), `role`
  (CANDIDATE | ISSUER | ADMIN — one primary role), `status` (ACTIVE | SUSPENDED |
  DEACTIVATED).
- Email and credentials live only in Supabase Auth and are not duplicated. MFA
  assurance is read from the session, not stored. The role is never read from
  client-editable auth metadata. `authUserId` is immutable; users are never deleted.
- Invariant: role changes are Admin-only and audited.

### 3.2 Profile
- `userId` (unique), `handle` (unique public slug), `displayName`, `headline`, `about`,
  `location`, `visibility` (PUBLIC | UNLISTED | PRIVATE, default PRIVATE).
- Ordinary editable data, not versioned evidence. Candidates only (service-enforced).

### 3.3 Organisation
- `orgId` (bytes32, unique), `slug` (unique), `legalName`, `displayName`, `kind`,
  `status` (PENDING_ONBOARDING | ACTIVE | SUSPENDED), `pulseFreshnessDays`
  (configurable, default **45**, CHECK 1–3650).
- Suspension blocks new issuance; it never erases or invalidates history. Never deleted.
- The freshness window is business policy passed to the verification engine, never
  hardcoded in it.

### 3.4 OrganisationMember
- `userId`, `organisationId`, `status` (INVITED | ACTIVE | REMOVED), `invitedAt`,
  `joinedAt`, `removedAt`.
- Only users with role ISSUER can be members (trigger). At most one live (INVITED or
  ACTIVE) membership per user (partial unique index). Removal is a status change.

### 3.5 IssuerKey
- One row per issuer wallet authorisation lifecycle: `organisationId`,
  `walletAddress` (globally unique), `validFrom`, `validUntil` (nullable), `compromisedAt`
  (nullable), `operatorMemberId` (nullable), `authoriseTransactionId` and
  `retireTransactionId` (nullable, → BlockchainTransaction), `createdAt`.
- **There is no IssuerKeyWindow and a wallet has no second window.** Once a wallet is
  retired or marked compromised it is **never re-authorised in FARJI**: the address is
  globally unique, so a second row for the same address is impossible. Key rotation
  creates a **new IssuerKey row for a fresh wallet**.
- `walletAddress`, `organisationId`, `validFrom` are immutable; `validUntil` and
  `compromisedAt` can be set once and never changed. Rows are never deleted.
- Historical verification asks whether the signing timestamp lay inside the key's
  original valid period (`validFrom <= t` and `validUntil` is null or `t < validUntil`),
  and whether `compromisedAt` precedes it.
- The chain is authoritative for key history; this table is a mirror that must never
  be used to *grant* validity the chain does not show.

### 3.6 Claim
- `candidateId`, `category` (EXPERIENCE | EDUCATION | CERTIFICATION | MEMBERSHIP),
  `organisationId` (nullable — free-text organisations cannot be verified),
  `visibility`, `archivedAt` (soft-hide).
- Stable identity of one real-world job/degree/licence. Never deleted. The **current
  version is the ClaimVersion with the highest `versionNumber`** (no pointer column).

### 3.7 ClaimVersion (append-only)
- `claimId`, `versionNumber` (≥ 1, unique per Claim), `content` (JSON, typed per
  category — candidate personal data, never on-chain), `proposedLifecycleType`
  (the candidate's proposal), `authoredBy` (CANDIDATE | ISSUER), `createdAt`.
- An edit always inserts version N+1. `proposedLifecycleType` is only a proposal; the
  authoritative lifecycle type lives on the issued Credential.

### 3.8 VerificationRequest
- `claimVersionId` (one exact ClaimVersion), `organisationId`, `candidateId`, `status`
  (§5.1), `institutionalIdentifier`, `candidateNote`, `submittedAt`, `closedAt`.
- At most one open (SUBMITTED | IN_REVIEW) request per ClaimVersion (partial unique
  index). Terminal statuses never change again. Identity columns are immutable. Never
  deleted.

### 3.9 ReviewDecision (append-only)
- `verificationRequestId` (unique — one decision per request), `organisationId`,
  `reviewerMemberId`, `decision` (APPROVE | REJECT), `rejectionReason` (required
  exactly when REJECT), `notes` (internal), `sourceOfTruthReference`, `decidedAt`.
- Composite foreign keys guarantee the request and the reviewing member both belong
  to `organisationId`. The reviewer must be an ACTIVE member and can never be the
  claim's owner (trigger). A rejection never deletes the claim, version or request,
  and is not shown publicly.

### 3.10 Credential
- `organisationId`, `claimVersionId` (unique — **one Credential per ClaimVersion** in
  the MVP), `reviewDecisionId` (nullable, unique), `lifecycleType` (authoritative,
  immutable), `pipelineStatus` (§5.2, forward-only), `credentialId` (bytes32, unique),
  `credentialSalt`, `contentSalt`, `subjectSalt`, `subjectCommitment`,
  `contentDigest`, `validFrom`, `validUntil` (exactly for EXPIRING), `issuedAt`,
  `supersedesCredentialId` (nullable, unique — a linear chain).
- **Three distinct salts** (a CHECK forbids equality): `credentialSalt` feeds
  `credentialId` and becomes public if the credential is ever revoked; `contentSalt`
  salts `contentDigest`; `subjectSalt` salts `subjectCommitment`. The latter two stay
  private.
- Cryptographic columns are nullable while AWAITING_SIGNATURE (Phase 6 fills them);
  a CHECK requires them all once the pipeline moves past it. They are write-once.
- **`validFrom` vs `issuedAt` (never conflate them).** `validFrom` is the **effective
  start date of the underlying professional claim** (the claim's `startDate`, 00:00:00
  UTC); it is *not* the issuance or signing time. `issuedAt` is the **actual
  cryptographic issuance (signature) timestamp** — the instant the issuer wallet signed —
  and is what issuer-key validity is judged against. `validUntil` is set for EXPIRING
  credentials only (at approval, Phase 5).
- **When each column is written (Phase 6).** At *prepare*: the three salts,
  `credentialId`, `subjectCommitment`, `contentDigest` and `validFrom`. At *accept* (a
  verified issuer signature): `issuedAt`, `supersedesCredentialId` and the move to SIGNED,
  together with the CREDENTIAL Attestation. Then the credential is queued (QUEUED_FOR_ANCHOR)
  into CohortProof (PERMANENT, EXPIRING) or ProofPulse (CONTINUING).
- Supersession is derived: a Credential is superseded when another names it in
  `supersedesCredentialId`. Never deleted.

### 3.11 Attestation (append-only)
- `kind` (CREDENTIAL | STATUS_CHANGE), `credentialRowId`, `organisationId`,
  `signerKeyId` (→ IssuerKey), `typedDataHash` (unique), `signature`, `nonce`,
  `issuedAt` (the signed timestamp), `chainId`, `verifyingContract`; for STATUS_CHANGE
  also `statusSeq`, `newStatus`, `effectiveAt`.
- EIP-712 evidence only: no secrets, no claim content (the message is recomputed from
  the ClaimVersion and salts and compared to `typedDataHash`). Composite foreign keys
  force the credential and the signing key to belong to the same Organisation.
- Unique on (`signerKeyId`, `nonce`); one CREDENTIAL attestation per credential; one
  STATUS_CHANGE per (credential, `statusSeq`).

### 3.12 CohortBatch / CohortLeaf
- Batch: `organisationId`, `label`, `status` (OPEN | SEALED | ANCHORED), `batchRoot`,
  `leafCount`, `sealedAt`, `anchorId`. At most one OPEN batch per Organisation. Root,
  count, seal time and anchor are write-once; status only moves forward.
- Leaf: `batchId`, `credentialRowId` (unique), `organisationId`, `position`,
  `leafHash`, `proof` (JSON, written once at sealing). Leaves only enter an OPEN
  batch, never for CONTINUING credentials, and are frozen once the batch is sealed.

### 3.13 ProofPulseTree / ProofPulseLeaf / ProofPulseNode / ProofPulseUpdate
- **Tree:** exactly **one per Organisation** (unique `organisationId`): `depth`
  (immutable), `currentRoot`, `currentRootSeq` and `nextLeafIndex` (both monotonic).
  No `treeId`/sharding in the MVP.
- **Leaf:** `treeId`, `credentialRowId` (unique), `leafIndex` (unique per tree,
  assigned once), `scope` (EMPLOYMENT | ENROLMENT | MEMBERSHIP), `status` (ACTIVE |
  ENDED — **REVOKED is deliberately not a value**), `statusSeq`, `statusEffectiveAt`,
  `leafHash`. Only CONTINUING credentials; an ENDED leaf never becomes ACTIVE again.
- **Node:** `(treeId, level, position)` → `hash`: the current node values, a derivable
  cache that makes path updates cheap.
- **Update (append-only):** `(treeId, rootSeq)` unique — `kind` (INSERT |
  STATUS_CHANGE), `leafIndex`, `newLeafHash`, `previousRoot`, `newRoot`,
  `causedByAttestationId`. This log is the permanent root history; the algorithm that
  writes it is Phase 7. Leaf and Node rows are rewritable projections; ProofPulseUpdate
  and Anchor are the evidence.

### 3.14 Anchor (append-only)
- `organisationId`, `attestationType` (COHORT | PROOF_PULSE), `epoch` (≥ 1),
  `batchRoot`, `previousChainRoot`, `chainRoot` (unique), `rootSeq` (exactly for
  PROOF_PULSE), `leafCount`, `anchorerKeyId`, `transactionId` (unique), `blockNumber`,
  `blockTimestamp`.
- An Anchor represents a **successfully observed** on-chain attestation: it can only be
  inserted from a CONFIRMED or FINALIZED BlockchainTransaction whose purpose matches
  its type. Whether it meets the finality policy is read from that transaction.
- Unique (`organisationId`, `attestationType`, `epoch`) and unique (`organisationId`,
  `attestationType`, `previousChainRoot`): COHORT and PROOF_PULSE chains are
  independent, and a chain cannot fork. Epoch 1 links to the zero hash.
- A ProofPulse epoch is simply a PROOF_PULSE Anchor (no separate epoch table).

### 3.15 Revocation (append-only)
- `credentialRowId` (unique — one per credential), `organisationId`, `revokerKeyId`,
  `reasonCode`, `transactionId` (unique), `blockNumber`, `revokedAt`.
- Organisation-scoped by composite foreign keys: the credential and the revoking key
  must both belong to `organisationId`. Recorded only from a CONFIRMED or FINALIZED
  `REVOKE_CREDENTIAL` transaction. Irreversible. Never shown as ENDED, and vice versa.

### 3.16 BlockchainTransaction
- `chainId`, `txHash` (unique together), `purpose`, `status` (PENDING | CONFIRMED |
  FINALIZED | FAILED | DROPPED), `fromAddress`, `initiatedByUserId`, `organisationId`,
  `blockNumber`, `blockHash`, `failureReason`, timestamps.
- **Target linkage** — what the transaction is trying to change, known before any
  Anchor/Revocation exists: `targetType` (ORGANISATION | ISSUER_KEY | COHORT_BATCH |
  PROOF_PULSE_TREE | CREDENTIAL), `targetId` (the UUID of that row; deliberately not a
  foreign key because it is polymorphic) and `targetSequence` (nullable; e.g. the
  `rootSeq` or chain epoch being anchored). No separate "anchor intent" table.
- Born PENDING with no block data. Legal transitions: PENDING → CONFIRMED | FAILED |
  DROPPED; CONFIRMED → FINALIZED | PENDING (reorg) | DROPPED. FINALIZED, FAILED and
  DROPPED are terminal; PENDING cannot jump to FINALIZED. CONFIRMED/FINALIZED require
  an observed block number and hash. **Only server-side chain synchronisation
  changes status; the client never marks a transaction confirmed or finalised.**
  Rows come only from a hash a wallet really returned — never fabricated.

### 3.17 AuditEvent (append-only)
- `actorUserId` (null for system), `actorRole`, `organisationId`, `action`,
  `targetType`, `targetId`, `beforeDigest`, `afterDigest`, `metadata` (IDs and digests
  only), `ipHash`, `userAgent`, `occurredAt`. See [SECURITY_MODEL.md](SECURITY_MODEL.md) §8.
- Security history only; never the source of truth for domain state.

### 3.18 Sensitive data placement
Candidate personal data lives only in `Profile` and `ClaimVersion.content` (plus the
internal `institutionalIdentifier`/`candidateNote` on a request). It is not copied
into Attestation, Anchor, Credential, AuditEvent or the chain — those hold IDs,
salted digests and commitments. Email is not stored by FARJI (Supabase Auth only).
Private salts (`contentSalt`, `subjectSalt`) are sensitive and must never be logged,
returned by public endpoints or placed in audit metadata.

---

## 4. Lifecycle types

| Lifecycle type | Typical examples | Merkle engine | Positive state | Terminal / negative states reachable |
|---|---|---|---|---|
| `PERMANENT` | Completed degree, completed internship, past employment | CohortProof | `PERMANENT_VALID` | `REVOKED`, `MODIFIED` |
| `CONTINUING` | Current employment, current enrolment, active membership | ProofPulse | `CURRENTLY_ATTESTED` | `STALE_NO_RECENT_ATTESTATION`, `ENDED`, `REVOKED`, `MODIFIED` |
| `EXPIRING` | Professional licence, certification with expiry date | CohortProof (leaf carries `validUntil`) | `VERIFIED` | `EXPIRED`, `REVOKED`, `MODIFIED` |

Rules:
- A PERMANENT Credential stays historically valid forever unless revoked or
  superseded. Time passing never changes it.
- A CONTINUING Credential is only positive while recent issuer state evidence
  exists (ProofPulse epoch within the Organisation's freshness window).
- An explicit end of employment/enrolment/membership makes a CONTINUING Credential
  `ENDED`. `ENDED` means "was genuinely true, and has finished". It is **not**
  `REVOKED` and must never be displayed or stored as revocation.
- An EXPIRING Credential becomes `EXPIRED` once `now >= validUntil`. Renewal is a
  new ClaimVersion + new Credential that supersedes the old one.
- An ENDED CONTINUING Credential does not change lifecycle type and remains
  historically verifiable as ENDED. **No second PERMANENT Credential is
  automatically created** when a CONTINUING relationship ends: one real-world job,
  enrolment or membership is never duplicated into two Credentials merely because
  its lifecycle changed (ROADMAP D13, decided).

---

## 5. Workflow statuses (NOT verification states)

Workflow statuses describe where a process is. They are stored. They are distinct
from verification states (§6), which are derived and never stored as truth.

### 5.1 VerificationRequest.status

```
SUBMITTED ──► IN_REVIEW ──► APPROVED
    │             │      └─► REJECTED
    │             │
    ├─────────────┴──► WITHDRAWN    (candidate withdrew)
    └─────────────┴──► SUPERSEDED   (candidate created a newer ClaimVersion)
```
- Terminal: APPROVED, REJECTED, WITHDRAWN, SUPERSEDED. Terminal requests are never
  reopened or deleted; a new request is created instead.
- REJECTED keeps the Claim and ClaimVersion; the Claim simply remains unverified.
- Rejection history is retained internally through the append-only ReviewDecision
  and AuditEvent records. Rejections are **not shown** on a Candidate's public
  professional profile by default (ROADMAP D14, decided); publicly the Claim is
  simply `SELF_DECLARED`.

### 5.2 Credential.pipelineStatus

```
AWAITING_SIGNATURE ──► SIGNED ──► QUEUED_FOR_ANCHOR ──► ANCHORED
```
- AWAITING_SIGNATURE: approved by an Issuer, no CredentialAttestation yet.
- SIGNED: a CredentialAttestation has been accepted (signature verified on receipt).
- QUEUED_FOR_ANCHOR: leaf added to an OPEN CohortProof batch or inserted into the
  ProofPulse tree; its root has not yet been anchored and confirmed.
- ANCHORED: the containing root is anchored on-chain and meets the
  confirmation/finality policy.
- Revocation is not a pipeline status; it is evidence (Revocation record + chain).

Request APPROVED and pipeline AWAITING_SIGNATURE / SIGNED / QUEUED_FOR_ANCHOR are
**operational** statuses. They are shown to Candidates and Issuers as progress, but
they never produce, and must never be displayed as, an on-chain positive
verification. Only the derived verification state (§6) is shown as a verification
result.

---

## 6. Verification states (derived)

| State | Meaning | Applies to |
|---|---|---|
| `SELF_DECLARED` | Not issuer-signed, and no verification is in progress. | Claim |
| `PENDING` | Verification in progress: open request or approved-but-unsigned (not yet issuer-signed); or issuer-signed but the anchor needed for an on-chain positive result has not yet met the confirmation/finality policy. | Claim, Credential |
| `VERIFIED` | EXPIRING Credential, not revoked, cryptographically valid, anchored and confirmed, `now < validUntil`. | Credential (EXPIRING) |
| `PERMANENT_VALID` | PERMANENT Credential, not revoked, cryptographically valid, not superseded, anchored and confirmed. | Credential (PERMANENT) |
| `CURRENTLY_ATTESTED` | CONTINUING Credential, not ended, with a confirmed ProofPulse epoch proving it ACTIVE within the freshness window. | Credential (CONTINUING) |
| `STALE_NO_RECENT_ATTESTATION` | CONTINUING Credential, not ended, previously proven ACTIVE by a confirmed epoch, but no such epoch within the freshness window. | Credential (CONTINUING) |
| `EXPIRED` | EXPIRING Credential past `validUntil`. | Credential (EXPIRING) |
| `ENDED` | CONTINUING Credential whose relationship was explicitly ended by a valid issuer status change. | Credential (CONTINUING) |
| `REVOKED` | The issuing Organisation explicitly revoked the Credential on-chain. | Credential |
| `MODIFIED` | A newer attested Credential version (for a newer ClaimVersion of the same Claim) supersedes this one. | Credential |
| `INVALID_PROOF` | An issuer-signed Credential fails verification: signer not authorised at the issuance timestamp, or any cryptographic check fails (hash mismatch, bad signature, invalid Merkle proof, missing/foreign anchor, bad `credentialId` derivation, anchor-delay violation). Never applied to unsigned or self-declared claims. | Credential |

### 6.1 Credential state derivation (precedence order)

`deriveCredentialState(credential, evidence, now, policy) → { state, checks[] }`

The function is pure. `policy` carries configuration such as the Organisation's
`pulseFreshnessDays` (default 45), `maxAnchorDelay` and the confirmation/finality
policy; none of these values are hardcoded in the engine. `checks[]` lists every
individual check with pass/fail so the "View verification details" panel can show
the full picture, not only the top state.

**A. Not yet issuer-signed** (no CredentialAttestation recorded):
   → `PENDING` if a verification is in progress (open request, or Credential
   AWAITING_SIGNATURE); otherwise `SELF_DECLARED`.
   An unsigned or self-declared claim is **never** `INVALID_PROOF`.

**B. Explicitly revoked** (on-chain Revocation exists for `credentialId`, checked
   against the chain) → `REVOKED`. Revocation overrides every other state below.

**C. Signer not authorised at the issuance timestamp, or cryptographic verification
   fails** → `INVALID_PROOF`. Checks:
   - recomputed canonical `contentDigest` equals the attested digest;
   - EIP-712 signature recovers to `signerAddress` under the correct domain;
   - signer was an authorised issuer wallet **of this Organisation** at `issuedAt`
     (per on-chain key history), and not marked compromised at or before `issuedAt`;
   - `credentialId == keccak256(abi.encode(CREDENTIAL_ID_TAG, orgId, credentialSalt))`;
   - for evidence that is anchored: Merkle proof verifies against the anchored
     `batchRoot`; the Anchor is in this Organisation's attestation chain of the right
     attestation type; `issuedAt <= anchoredAt <= issuedAt + maxAnchorDelay`; the
     signer was not marked compromised at or before `anchoredAt`.

**D. Superseded** — a newer attested Credential names this one in
   `supersedesCredentialId` → `MODIFIED`.

**E. Otherwise, derive by lifecycle.** "Confirmed" below means anchored on-chain and
   meeting the confirmation/finality policy. An on-chain positive state is never
   claimed before confirmation; until then the result is `PENDING`.
   - PERMANENT → confirmed ? `PERMANENT_VALID` : `PENDING`.
   - CONTINUING →
     - explicit end (valid StatusChangeAttestation with newest `statusSeq` = ENDED) → `ENDED`;
     - else a confirmed ProofPulse epoch proving the leaf ACTIVE has
       `anchoredAt >= now − pulseFreshnessDays` → `CURRENTLY_ATTESTED`;
     - else, a confirmed epoch has proven the leaf ACTIVE before → `STALE_NO_RECENT_ATTESTATION`;
     - else (never yet confirmed) → `PENDING`.
   - EXPIRING → `now >= validUntil` ? `EXPIRED` : (confirmed ? `VERIFIED` : `PENDING`).

Notes:
- A StatusChangeAttestation is *valid* when its signature recovers correctly, its
  signer passes the same key-history checks as above for the same Organisation, and
  its `statusSeq` is exactly one greater than the leaf's previous `statusSeq`.
- **Negative evidence is effective immediately; positive evidence requires
  confirmed anchoring.** A validly signed ENDED status change takes effect as soon
  as it is verified, even before the next ProofPulse epoch is anchored. A forged or
  invalid status change is ignored for state purposes and raises an integrity
  alert; it can never upgrade a state.
- `REVOKED` is checked against the chain (authoritative), not only the DB mirror.
  Because `credentialId` embeds `orgId`, only the issuing Organisation can create it.

### 6.2 Claim state derivation (what a profile shows)

`deriveClaimState(claim, now, policy)`:

1. Current ClaimVersion has an issuer-signed Credential → return
   `deriveCredentialState` of that Credential.
2. Else (rule A): open VerificationRequest (SUBMITTED / IN_REVIEW) or Credential
   AWAITING_SIGNATURE for the current version → `PENDING`.
3. Else → `SELF_DECLARED` (also the outcome after REJECTED / WITHDRAWN).

If an earlier ClaimVersion of the Claim was verified, the profile may show a
secondary note ("An earlier version was verified by {organisation}") linking to that
version's evidence. This note is not a verification state and never turns the
current, unsigned content into a verified badge.

### 6.3 Display labels (public/candidate UI)

| State | Default label |
|---|---|
| SELF_DECLARED | Self-declared |
| PENDING | Verification pending |
| VERIFIED | Verified · valid until {validUntil} |
| PERMANENT_VALID | Verified |
| CURRENTLY_ATTESTED | Verified · currently confirmed by {organisation} |
| STALE_NO_RECENT_ATTESTATION | Not recently confirmed by {organisation} |
| EXPIRED | Expired {validUntil} |
| ENDED | Verified · ended {statusEffectiveAt} |
| REVOKED | Revoked by {organisation} |
| MODIFIED | Superseded by a newer verified version |
| INVALID_PROOF | Verification failed |

Cryptographic detail (hashes, signer, key validity period, Merkle proof, anchor tx) is shown
only behind "View verification details".

### 6.4 Caching
Derived states may be cached for performance. A cache is never the source of truth,
must carry the evidence watermark it was computed from (latest block, latest
attestation id), and must be invalidated on any new evidence. No column such as
`isVerified` may be introduced.

---

## 7. Versioning and issuance rules

### 7.1 Editing
- Editing any Claim creates a new ClaimVersion. Previous versions remain readable
  in history forever.
- Editing while a request is open moves that request to SUPERSEDED.
- Editing a verified Claim does not touch the old Credential; the old Credential
  stays historically valid for the content it covered. The Claim's current
  (unsigned) version derives `SELF_DECLARED` or `PENDING` per §6.2.
- When the new version is attested, its Credential sets `supersedesCredentialId`
  to the previous Credential. The previous Credential then derives `MODIFIED`
  when evaluated directly.

### 7.1a Candidate input rules (Phase 4)
A Candidate proposes a lifecycle type on each ClaimVersion; the authoritative type is
fixed later on the Credential. Server-side validation: PERMANENT records need an end
date (a CERTIFICATION that never lapses may omit it) that is not in the future;
CONTINUING records have no end date, because ending a relationship is recorded by the
Organisation (ENDED), never by the Candidate; EXPIRING records need an expiry date after
the start date and have no end date. Dates are real calendar dates and a start date
cannot be in the future. A Claim's category never changes. A verification request
targets the Claim's latest ClaimVersion and an ACTIVE Organisation; a version that is
already APPROVED or already has a Credential cannot be requested again. An edit that
changes nothing creates no new version.

### 7.2 Issuer content rule
Issuers approve or reject a ClaimVersion **as submitted**. They do not edit
candidate content. A correction is requested via REJECT with a reason code
(e.g. `DATES_MISMATCH`), and the Candidate submits a new version.

### 7.2a Approval and rejection (Phase 5)
Approve and reject act only on an open (SUBMITTED | IN_REVIEW) request for the
reviewer's own Organisation and for the Claim's **current** ClaimVersion. APPROVE records
a ReviewDecision and creates the single Credential for that exact ClaimVersion in
`AWAITING_SIGNATURE`, with `lifecycleType` taken from the version's proposal (now
authoritative and immutable) and, for EXPIRING, `validUntil` = the start of the version's
expiry date (UTC). The salts, `credentialId`, digests, `validFrom` and `issuedAt` stay
null until signing (Phase 6). REJECT records a ReviewDecision with a reason code and
creates no Credential; the Candidate may later submit a fresh request. `notes` and
`sourceOfTruthReference` are internal to the Organisation and never returned to the
Candidate or to public views.

### 7.2b Signing, queuing and ending (Phases 6–7)
Approval leaves the Credential AWAITING_SIGNATURE. An Issuer of the same Organisation
*prepares* the signing payload (salts and identifiers are created once; the typed data is
built from database rows), the issuer's own wallet signs it, and the server *accepts* it
only if the recovered signer is a wallet of the credential's Organisation that was
authorised at the signed `issuedAt`, is still open and was never compromised. Only the
Claim's current ClaimVersion can be signed, and never by the Claim's own owner. A newer
attested version records `supersedesCredentialId` pointing at the previous SIGNED
credential. Ending a CONTINUING relationship is a signed StatusChangeAttestation
(ACTIVE → ENDED, `statusSeq` + 1, `effectiveAt` between the claim start and now): it
updates one ProofPulse leaf in place and creates **no** Revocation, **no** second
Credential and deletes nothing.

### 7.3 Cohort issuance (issuer-initiated)
For CohortProof batches such as a graduating cohort, the Issuer creates
Credentials from the Organisation's records. Each Credential's subject is bound to
a claim invitation; when the graduate claims it, the platform creates a Claim with
a ClaimVersion `authoredBy = ISSUER`. Scope and invitation mechanism are an open
decision (ROADMAP).

### 7.4 Self-approval
A ReviewDecision is rejected server-side if `issuerUserId == claim.candidate.userId`.

---

## 8. ENDED vs REVOKED vs EXPIRED vs MODIFIED

| | ENDED | REVOKED | EXPIRED | MODIFIED |
|---|---|---|---|---|
| Trigger | Issuer status change (relationship finished) | Issuer revocation transaction | Clock passes `validUntil` | A newer attested Credential version supersedes it |
| Lifecycle types | CONTINUING only | All | EXPIRING only | All |
| Was it ever true? | Yes | Must not be relied on | Yes, until expiry | Yes, for the older content |
| Recorded where | Signed StatusChangeAttestation + ProofPulse leaf | On-chain Revocation | Nothing (derived from time) | `supersedesCredentialId` in the newer signed attestation |
| Reversible? | No (re-hire = new Credential) | No | No (renewal = new Credential) | N/A |
| Typical tone | Neutral | Warning | Neutral | Informational |

---

## 9. Append-only and historical evidence

Never delete or rewrite: ClaimVersion, VerificationRequest, ReviewDecision,
Attestation, sealed CohortBatch and its leaves, PulseLeaf status history
(`statusSeq`), ProofPulseUpdate, anchored ProofPulse roots together with enough proof
material to verify historical proofs against them ([MERKLE_MODEL.md](MERKLE_MODEL.md)
§3.5 — may be archived out of the hot database), Anchor, Revocation, IssuerKey
history, BlockchainTransaction (status moves only by legal transitions), AuditEvent.

Allowed mutations: workflow status transitions defined in §5, profile text,
visibility flags, workflow and pipeline status advancement, ProofPulseLeaf/ProofPulseNode
projections, BlockchainTransaction status (legal transitions only, by server-side chain sync).

Privacy erasure (e.g. a deletion request) is handled by crypto-shredding — removing
off-chain content and salts so on-chain commitments become unlinkable — under a
policy still to be decided (ROADMAP). It never rewrites evidence rows in place.

---

## 10. Worked examples

**Degree (PERMANENT).** Candidate adds "B.Tech Computer Science, 2022–2026" →
SELF_DECLARED → requests verification → PENDING → registrar approves and signs →
PENDING (pipeline QUEUED_FOR_ANCHOR) → batch anchored and confirmed →
PERMANENT_VALID forever, unless revoked.

**Current job (CONTINUING).** Approved, signed, inserted into the employer's
ProofPulse tree, epoch anchored and confirmed → CURRENTLY_ATTESTED. Employer does not
anchor an epoch for longer than its freshness window (default 45 days) →
STALE_NO_RECENT_ATTESTATION. Employee leaves; Issuer signs ENDED → ENDED
immediately; the next epoch anchors the updated root. No separate "past employment"
Credential is created.

**Licence (EXPIRING).** Verified with `validUntil = 2027-03-31` → VERIFIED until
then → EXPIRED from 2027-03-31. Renewal → new ClaimVersion + Credential; old
Credential derives MODIFIED (superseded), new one VERIFIED.

**Edited title.** Verified "Software Engineer" edited to "Senior Software Engineer"
→ the Claim's current version is SELF_DECLARED (or PENDING once re-verification is
requested), with a note that an earlier version was verified; the original Credential
remains PERMANENT_VALID evidence for "Software Engineer". Once the new version is
attested, the original Credential derives MODIFIED when evaluated directly.

**Rejected request.** Issuer rejects with `DATES_MISMATCH` → request REJECTED,
ReviewDecision and AuditEvent retained internally; publicly the Claim is
SELF_DECLARED and the rejection is not shown.

**Fraud found.** Issuer revokes on-chain → REVOKED, regardless of lifecycle state.
