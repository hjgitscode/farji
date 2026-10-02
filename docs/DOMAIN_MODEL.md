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
| **Issuer wallet** | An EVM account (secp256k1 key) authorised on-chain to act for one Organisation during a time window. "Issuer key" means the same thing when discussing key history. |
| **Issuer key history** | The append-only, on-chain list of time windows during which each issuer wallet was authorised for its Organisation. |
| **Claim** | A Candidate's logical professional record (one job, one degree, one licence). Has a stable identity across edits. |
| **ClaimVersion** | An immutable snapshot of a Claim's content. Editing a Claim creates a new ClaimVersion. |
| **VerificationRequest** | A Candidate's request asking one Organisation to verify one specific ClaimVersion. |
| **ReviewDecision** | An Issuer's recorded decision (APPROVE or REJECT) on a VerificationRequest, including source-of-truth review notes. |
| **Credential** | An Organisation-issued record covering exactly one ClaimVersion's content. Has a `credentialId`, a `lifecycleType` and an issuance pipeline status. |
| **Attestation** | An EIP-712 signature by an issuer wallet over a Credential (CredentialAttestation) or over a status change (StatusChangeAttestation). |
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
| **Proof bundle** | The exportable set of evidence (content, salts, attestation, Merkle proof, anchor reference) allowing independent verification. |

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

Fields listed are the domain-relevant ones; the Prisma schema (Phase 2) may add
technical columns. "Append-only" means rows are never updated in meaning-bearing
columns and never deleted by application code.

### 3.1 User
- `id` (equal to the Supabase Auth user id), `email`, `role` (CANDIDATE | ISSUER |
  ADMIN — one primary role per account), MFA status.
- Supabase Auth owns credentials and sessions; the application `User` row owns the
  role. The role is never read from client-editable auth metadata.
- Invariant: role changes are Admin-only and audited.

### 3.2 CandidateProfile
- `userId`, `handle` (public URL slug), `displayName`, `headline`, `about`, `location`,
  `visibility` (PUBLIC | UNLISTED | PRIVATE).
- Profile text is ordinary editable data (not versioned evidence).

### 3.3 Organisation
- `id`, `orgId` (bytes32 on-chain identifier), `slug`, `legalName`, `displayName`,
  `kind` (EMPLOYER | EDUCATION | LICENSING_BODY | ASSOCIATION | OTHER),
  `status` (PENDING_ONBOARDING | ACTIVE | SUSPENDED), `pulseFreshnessDays`
  (configurable; initial platform default **45**).
- Suspension blocks new issuance; it never erases or invalidates history.
- The freshness window is business policy: it is stored as configuration and passed
  to the verification engine as input, never hardcoded inside the engine.

### 3.4 OrganisationMembership
- `userId`, `organisationId`, `role` (ISSUER), `status` (INVITED | ACTIVE | REMOVED), timestamps.
- Removal is a status change, not a deletion.

### 3.5 IssuerWallet (off-chain mirror)
- `address`, `organisationId`, mirrored key-history windows (`validFrom`, `validUntil`,
  `compromisedSince`), linked membership (who operates it).
- **The chain is authoritative** for issuer key history. The DB copy is a cache
  rebuilt from chain events and must never be used to *grant* validity that the
  chain does not show.

### 3.6 Claim
- `id`, `candidateId`, `category` (EXPERIENCE | EDUCATION | CERTIFICATION | MEMBERSHIP),
  `organisationId` (nullable — free-text organisations cannot be verified),
  `currentVersionId`, `visibility`, `archivedAt` (soft-hide; never hard delete once
  any VerificationRequest exists).

### 3.7 ClaimVersion (append-only)
- `id`, `claimId`, `versionNumber` (1, 2, 3 … per Claim), `content` (typed per
  category: title, organisation name, location, start/end dates, degree/field,
  licence number, expiry, description …), `proposedLifecycleType`,
  `authoredBy` (CANDIDATE | ISSUER — ISSUER only for cohort issuance, §7.3),
  `createdAt`.
- Invariant: never updated after creation. An edit always inserts version N+1 and
  moves `Claim.currentVersionId`.

### 3.8 VerificationRequest (append-only history)
- `id`, `claimVersionId`, `organisationId`, `candidateId`, `status`,
  candidate-supplied matching hints (institutional identifier, institutional email,
  supporting note), timestamps.
- Status machine in §5.1. **Rejection never deletes the request, the Claim or the
  ClaimVersion.**

### 3.9 ReviewDecision (append-only)
- `id`, `verificationRequestId`, `issuerUserId`, `decision` (APPROVE | REJECT),
  `reasonCode`, `notes`, `sourceOfTruthReference` (an internal reference to the
  Organisation's own record — never a copy of the record), `decidedAt`.

### 3.10 Credential
- `id`, `credentialId` (bytes32, see [BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md) §4),
  `credentialSalt`, `organisationId`, `claimVersionId`, `lifecycleType`,
  `subjectCommitment`, `contentDigest`, `validFrom`, `validUntil` (EXPIRING only),
  `supersedesCredentialId` (nullable), `pipelineStatus` (§5.2), `issuedAt`.
- One Credential covers exactly one ClaimVersion. A ClaimVersion has at most one
  non-revoked Credential.
- `lifecycleType` is fixed at issuance and never changes.

### 3.11 Attestation (append-only)
- `id`, `type` (CREDENTIAL | STATUS_CHANGE), `credentialId`, `signerAddress`,
  `typedDataHash`, `signature`, `nonce`, `issuedAt`, `chainId`, `verifyingContract`.
- Unique on (`signerAddress`, `nonce`).

### 3.12 CohortBatch / CohortLeaf
- Batch: `id`, `organisationId`, `label`, `status` (OPEN | SEALED | ANCHORED),
  `root`, `leafCount`, `chainRoot` (of its Anchor), timestamps. Leaves:
  `credentialId`, `leafHash`, `position`. Sealed batches are immutable.

### 3.13 PulseTree / PulseLeaf / PulseRoot / PulseEpoch
- Tree: one per Organisation (MVP): `organisationId`, `depth`, `currentRoot`,
  `currentRootSeq`.
- Leaf: `leafIndex`, `credentialId`, `scope` (EMPLOYMENT | ENROLMENT | MEMBERSHIP),
  `status` (ACTIVE | ENDED), `statusSeq`, `statusEffectiveAt`, `leafHash`.
- Roots, epochs and historical proof material: see
  [MERKLE_MODEL.md](MERKLE_MODEL.md) §3.5.

### 3.14 Anchor (off-chain mirror)
- `chainRoot`, `attestationType` (COHORT | PROOF_PULSE), `organisationId`,
  `batchRoot`, `previousChainRoot`, `epoch`, `rootSeq` (PROOF_PULSE only),
  `anchoredBy`, `blockNumber`, `blockTimestamp`, `txHash`,
  `finality` (SUBMITTED | INCLUDED | FINALISED | DROPPED).

### 3.15 Revocation (off-chain mirror)
- `credentialId`, `organisationId`, `reasonCode`, `revokedBy`, `revokedAt`,
  `txHash`, `finality`. Irreversible.

### 3.16 ChainTransaction
- `txHash`, `purpose`, `fromAddress`, `status`, `blockNumber`, `confirmations`.
- Never fabricated: a row exists only for a transaction actually broadcast.

### 3.17 AuditEvent (append-only)
- `id`, `actorUserId`, `actorRole`, `organisationId` (if any), `action`, `targetType`,
  `targetId`, `beforeDigest`, `afterDigest`, `requestMeta` (IP hash, user agent),
  `occurredAt`. See [SECURITY_MODEL.md](SECURITY_MODEL.md) §8.

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

Cryptographic detail (hashes, signer, key window, Merkle proof, anchor tx) is shown
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

### 7.2 Issuer content rule
Issuers approve or reject a ClaimVersion **as submitted**. They do not edit
candidate content. A correction is requested via REJECT with a reason code
(e.g. `DATES_MISMATCH`), and the Candidate submits a new version.

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
(`statusSeq`), PulseEpoch, anchored ProofPulse roots together with enough proof
material to verify historical proofs against them ([MERKLE_MODEL.md](MERKLE_MODEL.md)
§3.5 — may be archived out of the hot database), Anchor, Revocation, IssuerWallet key
history, ChainTransaction, AuditEvent.

Allowed mutations: workflow status transitions defined in §5, profile text,
visibility flags, `Claim.currentVersionId`, pipeline status advancement.

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
