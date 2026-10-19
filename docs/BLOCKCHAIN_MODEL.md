# FARJI Blockchain Model

Terminology follows [DOMAIN_MODEL.md](DOMAIN_MODEL.md). Merkle construction follows
[MERKLE_MODEL.md](MERKLE_MODEL.md). Security rules follow
[SECURITY_MODEL.md](SECURITY_MODEL.md).

---

## 1. What the chain is — and is not

**The chain is NOT the source of real-world truth.** Whether someone actually
worked somewhere is known only by the Organisation, which checks its own
source-of-truth records (HR system, registrar, licence register).

**The chain IS authoritative for:**
- which Organisations are registered;
- which issuer wallets were authorised for which Organisation, and when
  (issuer key history);
- which Merkle roots an Organisation anchored, in which attestation chain, and when
  (block timestamp);
- which Credentials the issuing Organisation revoked, and when.

In short: the chain preserves tamper-evident evidence of **what an authorised
issuer attested and when**. It stores commitments and minimal metadata, never
candidate personal data.

---

## 2. Network and tooling

- EVM-compatible public testnet; Sepolia initially (Phase 15).
- Local development and all automated tests: Hardhat network / local Hardhat node.
- Solidity 0.8.x, OpenZeppelin Contracts, Hardhat, ethers.js v6.
- One contract: **`FarjiRegistry`**, located under `contracts/`.
- **Non-upgradeable (decided).** Evidence contracts must not be silently changeable.
  A future major version would be a new deployment with documented migration.

---

## 3. Contract roles and key custody

| Role | Holder (MVP) | Can | Cannot |
|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Admin's browser wallet (deployer on local) | Grant/revoke `PLATFORM_ADMIN_ROLE` (OZ `AccessControlDefaultAdminRules`, with transfer delay) | Anything else directly |
| `PLATFORM_ADMIN_ROLE` | Admin browser wallets | Register/suspend Organisations; authorise, retire, rotate issuer wallets; mark wallets compromised; pause new anchoring | Anchor roots, sign attestations, **revoke credentials** |
| Issuer wallet (per Organisation, time-bounded) | Issuer's own browser wallet | Anchor its own Organisation's CohortProof roots and ProofPulse epochs; revoke its own Organisation's Credentials | Act for any other Organisation |
| Anyone | — | Read everything; verify proofs via view functions | Write |

Key custody (decided for the MVP / first Sepolia deployment):
- Candidates never need a wallet and have no on-chain role.
- Issuer and Admin blockchain actions use browser wallets (e.g. MetaMask).
- The FARJI server never stores, receives or uses issuer/admin private keys.
- **No relayer** in the MVP: every contract write is sent directly by the acting
  wallet (`msg.sender`).
- Multisig/Safe ownership of admin roles is a **future production-hardening**
  improvement, not a requirement for the first working Sepolia deployment.
- The deployment key exists only in the deployer's local, untracked environment
  (or a hardware wallet); after deployment, roles are granted to the Admin browser
  wallet(s) and the deployer renounces any role it does not need.

---

## 4. Identifiers

| Identifier | Derivation | Notes |
|---|---|---|
| `orgId` | Random `bytes32` assigned at onboarding | Not personal data |
| `credentialId` | `keccak256(abi.encode(CREDENTIAL_ID_TAG, orgId, credentialSalt))` | `credentialSalt` is random 32 bytes. Embeds the issuing Organisation, which is how **credential ownership by organisation** is enforced without storing every credential on-chain. |
| `attestationType` | `COHORT` or `PROOF_PULSE` | Selects an attestation chain |
| `chainRoot` | See §8.1 | Identifies one anchor; unique because it commits to the previous `chainRoot` |
| `subjectCommitment` | `keccak256(abi.encode(bytes32 SUBJECT_TAG, bytes16 platformSubjectId, bytes32 subjectSalt))` | Hides who the candidate is. `platformSubjectId` is the 16 raw bytes of the Candidate's internal `User.id` UUID; `subjectSalt` is per Credential, so one Candidate's Credentials are not linkable by commitment. Tags are `keccak256(utf8("FARJI_CREDENTIAL_ID_V1"))`, `keccak256(utf8("FARJI_SUBJECT_V1"))`. |

Each new attested ClaimVersion gets a new `credentialId`. Version lineage is linked
via `supersedesCredentialId` inside the signed attestation.

Each Organisation has exactly one ProofPulse tree (MVP, ROADMAP D23 decided), so a
ProofPulse tree is identified by its `orgId`; the leaf records the scope (EMPLOYMENT,
ENROLMENT, MEMBERSHIP). Each Organisation therefore has exactly one COHORT and one
PROOF_PULSE attestation chain. No `treeId` or sharding in the MVP; if multiple
ProofPulse trees or sharding are added later as a scalability extension, the chain
key must include `treeId`.

---

## 5. Storage model (sketch — finalised in Phase 8)

```solidity
enum AttestationType { COHORT, PROOF_PULSE }

struct Organisation { OrgStatus status; uint64 registeredAt; bytes32 metadataHash; }

// One record per wallet, ever. A wallet is authorised once; retiring or
// compromising it closes its validity period permanently. It is never re-authorised.
struct IssuerKey {
    bytes32 orgId;
    uint64  validFrom;        // block.timestamp of authorisation
    uint64  validUntil;       // 0 = still valid; set once on retirement
    uint64  compromisedAt;    // 0 = not compromised; set once
}

struct ChainHead { bytes32 chainRoot; uint64 epoch; }   // epoch 0 = empty chain

struct Anchor {               // keyed by chainRoot
    bytes32 orgId;
    AttestationType attestationType;
    bytes32 batchRoot;        // CohortProof batch root or ProofPulse tree root
    bytes32 previousChainRoot;
    uint64  epoch;            // position in this (orgId, attestationType) chain
    uint64  rootSeq;          // PROOF_PULSE only
    uint32  leafCount;
    bytes32 schemaId;         // COHORT only
    address anchoredBy;
    uint64  anchoredAt;       // block.timestamp
}

struct Revocation { bytes32 orgId; uint64 revokedAt; uint16 reasonCode; address revokedBy; }

mapping(bytes32 => Organisation)                          organisations;
mapping(address => IssuerKey)                             issuerKeys;         // one record per wallet, never re-created
mapping(bytes32 => mapping(AttestationType => ChainHead)) chainHeads;         // orgId => type => head
mapping(bytes32 => Anchor)                                anchors;            // chainRoot => Anchor
mapping(bytes32 => uint64)                                lastPulseRootSeq;   // orgId => rootSeq
mapping(bytes32 => Revocation)                            revocations;        // credentialId => Revocation
```

Nothing in storage contains names, emails, claim titles, dates of birth, employee
numbers or any other personal claim content.

---

## 6. Functions and checks

### 6.1 Platform admin (`PLATFORM_ADMIN_ROLE`)
| Function | Key checks |
|---|---|
| `registerOrganisation(orgId, metadataHash)` | orgId unused |
| `setOrganisationStatus(orgId, status)` | Suspension blocks new anchors; never alters history |
| `authoriseIssuerWallet(orgId, wallet)` | Org ACTIVE; **`issuerKeys[wallet]` must not exist** (a wallet that was ever authorised, retired or compromised is never re-authorised, for any Organisation); records `IssuerKey{validFrom = now}` |
| `retireIssuerWallet(wallet)` | Sets `validUntil = now` once. Past signatures stay valid. The wallet can never be authorised again. |
| `rotateIssuerWallet(orgId, oldWallet, newWallet)` | Atomic retire(old) + authorise(new) at the same timestamp; `newWallet` must be a **fresh** wallet (rotation never reuses an address) |
| `markIssuerWalletCompromised(wallet, compromisedAt)` | `validFrom <= compromisedAt <= now`; sets `compromisedAt` once and closes the validity period if still open. Additive — never deletes the record. |
| `pauseAnchoring()` / `unpauseAnchoring()` | Pauses new anchors and new authorisations only. **Never** blocks revocation, retirement or compromise marking. |

Admins have **no** function to revoke a Credential or anchor a root.

### 6.2 Issuer wallet (`msg.sender` must be an open (not retired), non-compromised `IssuerKey` of `orgId` at `block.timestamp`, and the Organisation must be ACTIVE)
| Function | Key checks |
|---|---|
| `anchorCohortRoot(orgId, batchRoot, leafCount, schemaId, expectedPreviousChainRoot)` | `expectedPreviousChainRoot == chainHeads[orgId][COHORT].chainRoot`; batchRoot non-zero; appends to the COHORT chain (§8.1) |
| `anchorProofPulseEpoch(orgId, batchRoot, rootSeq, leafCount, expectedPreviousChainRoot)` | `expectedPreviousChainRoot == chainHeads[orgId][PROOF_PULSE].chainRoot`; `rootSeq >= lastPulseRootSeq[orgId]`; if equal, `batchRoot` must equal the previously anchored ProofPulse root; appends to the PROOF_PULSE chain |
| `revokeCredential(orgId, credentialSalt, reasonCode)` | Computes `credentialId` from `orgId` and salt — so an issuer can only ever revoke IDs belonging to its own Organisation; not already revoked |

Revocation is permitted even if the Organisation is SUSPENDED, provided the
caller's key is open and not compromised.

### 6.3 Views
- `isIssuerAuthorisedAt(orgId, wallet, timestamp) → bool`
- `getIssuerKey(wallet) → IssuerKey`
- `getAnchor(chainRoot)`, `getChainHead(orgId, attestationType)`
- `getRevocation(credentialId)`
- `computeCredentialId(orgId, credentialSalt)`
- `verifyCohortInclusion(chainRoot, leaf, proof) → bool` (OpenZeppelin `MerkleProof`)

---

## 7. Time-aware issuer key history

- Key history is **append-only**: each wallet has exactly one `IssuerKey` record
  (`validFrom`, `validUntil`, `compromisedAt`). Its validity period is closed once and
  never reopened; compromise marking sets one field once. There are no multiple
  windows per wallet.
- A signature is valid only if the signer was authorised **for that Organisation at
  the exact issuance timestamp** (`issuedAt` inside the signed message), judged
  against the key's original validity period:
  `validFrom <= issuedAt` and (`validUntil == 0` or `issuedAt < validUntil`).
- Because `issuedAt` is chosen by the signer, it is bounded by anchoring time:
  `issuedAt <= anchoredAt <= issuedAt + maxAnchorDelay`. A positive on-chain state
  requires an anchor, so a retired or stolen key cannot silently backdate a new
  credential.
- **Rotation** (planned key change): the old wallet is retired and a **new** `IssuerKey`
  is created for a fresh wallet. Old signatures remain valid forever.
- **Compromise**: any evidence anchored at or after `compromisedAt` that relies on
  the compromised key is `INVALID_PROOF`; evidence anchored before it remains valid.
- A wallet address is bound to one Organisation for life. Once retired or compromised
  it is **never re-authorised** in FARJI — not for the same Organisation, not for another.

---

## 8. Anchoring and chained attestations

### 8.1 Independent attestation chains
Anchors form **independent hash chains per (Organisation, attestation type)**.
There is no single global chain per Organisation:

```
ORG-XYZ + COHORT       : genesis → C1 → C2 → C3 …
ORG-XYZ + PROOF_PULSE  : genesis → P1 → P2 → P3 …
```

Conceptual commitment (exact Solidity encoding decided in Phase 8):
```
chainRoot = keccak256(batchRoot, previousChainRoot, organisationId, attestationType, epoch)
```
Phase 7 prepared the off-chain side: `lib/crypto/chain-root.ts` computes
`keccak256(abi.encode(bytes32 batchRoot, bytes32 previousChainRoot, bytes32 orgId,
uint8 attestationType, uint64 epoch))` (COHORT = 0, PROOF_PULSE = 1, `epoch` from 1) and
has a committed golden vector (`tests/vectors/crypto.json`) that the Phase 8 Solidity
implementation must reproduce — or both sides change together.
- `previousChainRoot` is `0x0` for epoch 1.
- `epoch` is the anchor's position in its own chain (1, 2, 3 …), not a calendar period.
- The contract computes `chainRoot` itself from the stored head and the submitted
  `batchRoot`, then advances the head. The caller passes
  `expectedPreviousChainRoot` so a stale submission reverts instead of forking.
- Omitted, reordered or forked anchors within a chain are detectable by recomputing
  the chain.

### 8.2 CohortProof
One `anchorCohortRoot` per sealed batch, appended to the Organisation's COHORT chain.
The full tree stays off-chain.

### 8.3 ProofPulse
`anchorProofPulseEpoch` snapshots the already-current ProofPulse root and appends it
to the Organisation's PROOF_PULSE chain. A ProofPulse epoch is exactly one anchor in
that chain. The contract enforces monotonic `rootSeq`; the platform never rebuilds
the tree to anchor.

### 8.4 Concurrency
- CohortProof and ProofPulse anchors are in different chains and **never block each
  other**.
- Within one chain, two simultaneous submissions from the same Organisation race on
  `expectedPreviousChainRoot`; the second reverts cleanly and is retried against the
  new head. The UI must handle this retry; it never corrupts evidence. Within the
  PROOF_PULSE chain this is rare (one tree per Organisation, periodic epochs).

### 8.5 Submission
Anchors are submitted by the Issuer's own browser wallet. No relayer in the MVP.

---

## 9. Revocation and ownership

- Only the issuing Organisation may revoke its Credential — enforced by
  `credentialId` derivation from `orgId`, checked on-chain.
- Revocation is irreversible. A mistaken revocation is remedied by issuing a new
  Credential.
- Revocation is distinct from ENDED. ENDED is a ProofPulse status change; it never
  calls `revokeCredential`.
- **Prohibited (FARJI2 weakness):** any function of the form
  `revoke(credentialId)` that only checks "caller is some authorised issuer". That
  allowed any issuer of any Organisation to revoke arbitrary credentials.

---

## 10. EIP-712 off-chain attestations

Domain:
```
name: "FARJI", version: "1", chainId: <network>, verifyingContract: <FarjiRegistry>
```

Types (final, Phase 6; ROADMAP D39–D40):
```
CredentialContent(
  uint8 category, string title, string organisationName, string startDate,
  string endDate, string expiryDate, string description, string location,
  string fieldOfStudy, string credentialNumber, bytes32 contentSalt)

CredentialAttestation(
  bytes32 credentialId, bytes32 orgId, bytes32 subjectCommitment,
  CredentialContent content, bytes32 schemaId, uint8 lifecycleType,
  uint64 validFrom, uint64 validUntil, bytes32 supersedesCredentialId,
  uint64 issuedAt, bytes32 nonce)

StatusChangeAttestation(
  bytes32 credentialId, bytes32 orgId, uint32 leafIndex, uint8 newStatus,
  uint64 effectiveAt, uint32 statusSeq, uint64 issuedAt, bytes32 nonce)
```
- **`content` is a nested struct, not a `bytes32 contentDigest`.** In EIP-712 a nested
  struct is encoded as its `hashStruct`, so
  `contentDigest = hashStruct(CredentialContent)` (salted with `contentSalt`) is exactly
  the value that would otherwise have been signed — while the issuer's wallet now shows
  the real title, dates and organisation instead of an opaque hash. The content is never
  sent on-chain.
- **One universal V1 content struct** serves all four categories; per-category field
  rules (`fieldOfStudy` only for EDUCATION, `credentialNumber` only for CERTIFICATION,
  `endDate` only for PERMANENT, `expiryDate` exactly for EXPIRING) are enforced by
  canonicalisation, not by separate structs. `schemaId` is the type hash of
  `CredentialContent` (`keccak256(utf8(encodeType))`); a future schema change is a new
  struct string, hence a new `schemaId`.
- **`validFrom` is the effective start date of the underlying professional claim**
  (the claim's `startDate` at 00:00:00 UTC). It is NOT the credential issuance or
  signing time. **`issuedAt` is the actual cryptographic issuance (signature)
  timestamp** and is the instant against which issuer-key validity is judged (§7). The
  two are separate fields everywhere (canonical data, message, leaves, helpers, docs) and
  are never conflated. `validUntil` is the expiry (start of the expiry date, UTC) for
  EXPIRING credentials and `0` otherwise.
- **Canonical content** (`lib/crypto/canonical.ts`): JSON is never hashed. Nine string
  fields are normalised (Unicode NFC, `\r\n`/`\r` → `\n`, trim, control characters
  rejected, absent/`null`/empty → `""`), dates must be strict `YYYY-MM-DD`, unknown keys
  and non-string values make the content invalid, and enum codes are fixed
  (`category`: EXPERIENCE 0 · EDUCATION 1 · CERTIFICATION 2 · MEMBERSHIP 3;
  `lifecycleType`: PERMANENT 0 · CONTINUING 1 · EXPIRING 2; `newStatus`: ACTIVE 0 ·
  ENDED 1). `orgId` is the Organisation's bytes32 (never its database id).
- Issuers sign in their own wallet; the server only BUILDS the message from database
  rows (the client returns just the signature plus the `issuedAt` and `nonce` it was
  given) and RECOVERS the signer. Signatures must be canonical: 65 bytes, `v ∈ {27, 28}`,
  low-`s` (the malleable high-`s` twin is rejected).
- The EIP-712 domain has no default: `FARJI_CHAIN_ID` and `FARJI_REGISTRY_ADDRESS` must
  be configured, and every environment uses its own deployment, so signatures cannot be
  replayed across chains, contracts or environments.
- Signatures are verified server-side (ethers `verifyTypedData`) before acceptance,
  and again by the verification engine on every evaluation (Phase 10).
- A signature is accepted only if the recovered wallet is an `IssuerKey` of the
  credential's own Organisation that was authorised at `issuedAt`, is still open now,
  and is not compromised (`lib/crypto/keys.ts`). Retiring a key later never invalidates
  a signature made while it was valid.
- Before Phase 9, acceptance trusts the `IssuerKey` mirror rows (test fixtures; manual
  rows in development only). From Phase 9 it must also require an observed authorisation
  transaction (ROADMAP D46); the chain remains authoritative for key history.

## 11. Nonce and replay protection

| Threat | Protection |
|---|---|
| Cross-chain / cross-contract replay | EIP-712 domain includes `chainId` and `verifyingContract` |
| Re-submitting the same attestation | Random 32-byte `nonce`; unique on (`signer`, `nonce`) in DB |
| Rolling a ProofPulse leaf back (old ACTIVE after ENDED) | `statusSeq` per leaf, inside the signature, must increase by exactly one |
| Re-anchoring an old ProofPulse root | Contract-enforced monotonic `rootSeq` |
| Forking or reordering an attestation chain | Contract-computed `chainRoot` + `expectedPreviousChainRoot` check per (Organisation, attestation type) |
| On-chain transaction replay | Native EVM account nonces (all writes are direct `msg.sender` calls) |

If signature-authorised (relayed) contract calls are ever added after the MVP, they
must carry an on-chain consumed-nonce mapping and a deadline.

---

## 12. Events

Every state change emits an event: `OrganisationRegistered`,
`OrganisationStatusChanged`, `IssuerWalletAuthorised`, `IssuerWalletRetired`,
`IssuerWalletRotated`, `IssuerWalletCompromised`, `CohortRootAnchored`,
`ProofPulseEpochAnchored` (both carrying `orgId`, `attestationType`, `epoch`,
`batchRoot`, `previousChainRoot`, `chainRoot`), `CredentialRevoked`,
`AnchoringPaused/Unpaused`. The off-chain mirror is rebuilt from these events.

---

## 13. Application ↔ chain consistency

- Writes: the browser wallet submits the transaction; the server records a
  `BlockchainTransaction` (PENDING) from the returned hash, then confirms it by reading
  the receipt and event logs from its own RPC — never trusting a client claim.
- **Confirmation/finality policy:** a verification result may claim an on-chain
  positive state only after the relevant anchor reaches the required policy
  (default: Ethereum `finalized` block tag; see ROADMAP D17). Before that the
  derived state is `PENDING`, whatever the operational pipeline status says.
- Dropped/replaced/reorged transactions are detected and their records marked
  DROPPED; evidence is never shown as anchored on the basis of an unconfirmed tx.
- Sync: scheduled log polling from the last processed block (serverless-friendly),
  plus on-demand reads during verification. Revocation and key-history checks on the
  public verification path read the chain (with short caching), not only the mirror.
- **No mock blockchain state** once Phase 9 exists. No fabricated transaction
  hashes, block numbers, confirmations or "anchored" flags, in any environment.
  Tests use a real local Hardhat chain.

---

## 14. Testing requirements (Phase 8)

- Every function: success path, every revert path, and emitted events.
- Cross-organisation revocation attempt reverts.
- Admin cannot revoke or anchor.
- Retired/compromised/not-yet-authorised wallets cannot anchor or revoke.
- `isIssuerAuthorisedAt` correct at validity-period boundaries (`validFrom`, `validUntil`,
  `compromisedAt`).
- A retired or compromised wallet can never be authorised again (same or other Organisation).
- Wallet cannot be re-bound to another Organisation.
- ProofPulse `rootSeq` monotonicity and equal-seq/same-root rule.
- `chainRoot` computation matches the off-chain implementation; stale
  `expectedPreviousChainRoot` reverts; COHORT and PROOF_PULSE chains of the same
  Organisation advance independently.
- Pause never blocks revocation, retirement or compromise marking.
- Golden Merkle vectors (`lib/merkle`) and `chainRoot` / `credentialId` vectors
  (`lib/crypto`) verify identically on-chain.
- Gas report for anchor and revoke functions.
