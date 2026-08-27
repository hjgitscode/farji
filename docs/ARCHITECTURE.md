# NotSoFarji — Architecture & Review 2 Build Plan

*Because your resume should not be farji.*

This document is the single source of truth for the system design. It is
written to be readable by both developers during viva and by reviewers who
have not seen the project before.

## 1. The problem

Most blockchain credential systems answer:

> "Was this credential valid when it was issued?"

But professional information behaves differently depending on its nature.
"B.Tech degree awarded in 2026" is a permanent historical fact. "Currently
employed at XYZ" is a changing state — a valid old digital signature does
not prove the candidate still works there today.

**Research question:** can blockchain-based credential verification evolve
from a static proof of issuance into a lifecycle-aware proof of professional
state over time?

## 2. Established technologies vs. NotSoFarji's design contributions

NotSoFarji does **not** claim to invent cryptographic primitives. It combines
established building blocks into an application-level design that addresses
a gap in existing systems.

**Established technologies (not novel):**
Keccak-256 hashing, ECDSA (secp256k1), EIP-712 typed signing, nonces/replay
protection, Merkle trees, Merkle proofs, blockchain anchoring, smart
contracts, QR-based verification, revocation, expiration.

**NotSoFarji design contributions:**
1. **ProofPulse** — periodic Merkle-batched re-attestation of currently-active
   credentials, so continuing claims can be freshness-checked without
   re-verifying every candidate individually.
2. **CohortProof** — one Merkle-batched attestation covering an entire
   graduating cohort, replacing thousands of individual verification
   requests with one institutional action plus per-candidate proofs.
3. **Lifecycle-aware credential typing** (PERMANENT / CONTINUING / EXPIRING)
   with a state machine that derives status rather than having it hand-set.
4. **Chained institutional attestations** — successive Merkle roots linked
   into an application-level hash chain per organisation/attestation-stream,
   for tamper-evident continuity between epochs.
5. **Time-aware issuer key history** — key rotation where historical
   signatures remain evaluable against the key's validity window at the time
   of signing, not the key's current status.
6. **Explicit claim versioning** — edits never overwrite; they create a new
   version requiring fresh verification, with the old version preserved as
   historical evidence.
7. **Reduced institutional verification workload** as the practical outcome
   of (1) and (2).

## 3. System layers

```
Candidate / Issuer / Admin
        |
NotSoFarji Application (Next.js)
        |
Cryptographic Layer (canonicalisation, Keccak-256, EIP-712, Merkle engine)
        |
Solidity Smart Contract (NotSoFarjiRegistry.sol)
        |
EVM Blockchain (local Hardhat network for Review 2)
```

Blockchain is not the authority for real-world truth — the issuer is. The
chain preserves tamper-evident evidence of what an authorised issuer
attested, and when.

## 4. Domain model

- **Organisation** — `{ organisationId, name, registeredAt }`
- **IssuerKeyRecord** — `{ organisationId, wallet, validFrom, validUntil, revoked }` (append-only per organisation)
- **Credential** (off-chain canonical object) — `{ credentialId, candidateRef, claimType, organisationId, title, startDate, endDate, lifecycleType, version, previousVersionId }`
- **CredentialVersion** — version chain: `CREATED → VERIFIED → REFRESHED / ROLE_UPDATED → ENDED / REVOKED`
- **Attestation** (on-chain) — `{ organisationId, attestationType, epoch, batchRoot, previousChainRoot, chainRoot, anchoredAt, issuerWallet }`
- **MerkleBatch** (off-chain) — full leaf set + tree; only the root is anchored
- **VerificationResult** (computed, never stored) — the aggregated object the recruiter page renders

## 5. On-chain vs. off-chain data

**On-chain only:** organisation id/name, issuer wallet + validity window,
Merkle roots (batch + chain), epoch numbers, attestation timestamps,
credentialId + revocation flag/timestamp/issuer.

**Off-chain always:** the canonical credential JSON, candidate personal data,
full Merkle leaf sets and proofs, EIP-712 signatures, UI state.

**No personal data ever touches the chain.**

## 6. Smart contract design — `NotSoFarjiRegistry.sol`

One contract, OpenZeppelin `AccessControl` for admin-only functions, custom
time-bounded mappings for issuer validity (a plain role bit cannot express
"valid only between these two timestamps").

### Enums
```solidity
enum AttestationType { COHORT, PROOF_PULSE }
```

### Structs
```solidity
struct Organisation {
    string name;
    bool registered;
}

struct IssuerKeyRecord {
    bytes32 organisationId;
    address wallet;
    uint64 validFrom;
    uint64 validUntil;   // 0 = still open-ended (not yet revoked)
    bool revoked;
}

struct Attestation {
    bytes32 organisationId;
    AttestationType attestationType;
    uint64 epoch;
    bytes32 batchRoot;
    bytes32 previousChainRoot;
    bytes32 chainRoot;
    uint64 anchoredAt;
    address issuerWallet;
}

struct RevocationRecord {
    bool revoked;
    uint64 revokedAt;
    address issuer;
}
```

### Mappings
```solidity
mapping(bytes32 => Organisation) public organisations;
mapping(address => IssuerKeyRecord) public issuerRecords;
mapping(bytes32 => address[]) private issuerWalletsByOrg; // exposed via getIssuerHistory()
mapping(bytes32 => mapping(AttestationType => bytes32)) private currentChainRoot; // exposed via getCurrentChainRoot()
mapping(bytes32 => mapping(AttestationType => mapping(uint64 => Attestation))) private attestations; // exposed via getAttestation()
mapping(bytes32 => mapping(AttestationType => uint64[])) private epochsByOrgAndType; // exposed via getEpochs()
mapping(bytes32 => RevocationRecord) public revocations;
```
Using `AttestationType` directly as a mapping key (rather than casting to
`uint8`) is type-safe and just as cheap — Solidity stores an enum as its
underlying integer either way. The array-valued mappings are kept
`private` with a dedicated view function each, because a `public`
mapping of arrays only lets you fetch one element at a time, not the
whole array.

### Events
```solidity
event OrganisationRegistered(bytes32 indexed organisationId, string name);
event IssuerAuthorised(bytes32 indexed organisationId, address indexed wallet, uint64 validFrom);
event IssuerRevoked(bytes32 indexed organisationId, address indexed wallet, uint64 revokedAt);
event IssuerKeyRotated(bytes32 indexed organisationId, address indexed oldWallet, address indexed newWallet, uint64 rotatedAt);
event AttestationAnchored(bytes32 indexed organisationId, AttestationType attestationType, uint64 epoch, bytes32 batchRoot, bytes32 chainRoot, address indexed issuerWallet);
event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer, uint64 revokedAt);
```

### Functions

**Admin-only** (`onlyRole(DEFAULT_ADMIN_ROLE)`):
`registerOrganisation`, `authoriseIssuer`, `revokeIssuer`, `rotateIssuerKey`.

**Issuer-only** (caller must be `isIssuerValidAt(msg.sender, block.timestamp)`
for the organisation it claims):
`anchorAttestation`, `revokeCredential`.

**Public views:**
`isIssuerValidAt`, `isCredentialRevoked`, `getAttestation`,
`getCurrentChainRoot`, `getEpochs`, `getIssuerHistory`.

**Known Review 2 simplification:** the contract never records which
organisation a given `credentialId` belongs to (credential content,
including ownership, lives entirely off-chain by design). So
`revokeCredential` only checks that the caller is *some* currently
authorised issuer, not specifically the issuer of that credential.
Review 3 could add a `credentialOwner` mapping, populated when a
credential's batch is anchored, to restrict revocation to the issuing
organisation.

Full function-by-function rationale lives in `docs/SOLIDITY_EXPLANATION.md`.

## 7. Data flows

**CohortProof:** ERP mock records → canonicalise each credential → keccak256
each → Merkle tree → root → issuer signs & calls
`anchorAttestation(..., COHORT, epoch, root, prevChainRoot)` → each student's
proof stored off-chain → recruiter verification recomputes the root from the
provided proof + leaf and compares to the on-chain root.

**ProofPulse:** HR/mock "currently active" list (monthly) → Merkle tree →
root → `anchorAttestation(..., PROOF_PULSE, epoch, root, prevChainRoot)` →
verifier checks whether the candidate's leaf is in the most recent epoch's
tree **and** whether that epoch is recent enough → `CURRENTLY_ATTESTED`;
otherwise `STALE_NO_RECENT_ATTESTATION`. Reaching `ENDED` requires a separate,
explicit end-employment action — absence from ProofPulse never implies it.

**Key rotation:** Admin calls
`rotateIssuerKey(orgId, oldWallet, newWallet, now)` → old record's
`validUntil = now`, `revoked = true` → new record created with
`validFrom = now`, `validUntil = 0`. `isIssuerValidAt(oldWallet, t)` remains
true for `t` before rotation and false after — this is what lets a
historical signature stay `VALID AT ISSUANCE TIME` even after the signing
key is later revoked.

## 8. Credential lifecycle state machine

| Lifecycle Type | Possible states | Trigger |
|---|---|---|
| PERMANENT | `SELF_DECLARED → PENDING → VERIFIED → PERMANENT_VALID`; → `REVOKED` / `MODIFIED` anytime | issuer approval; new version supersedes |
| CONTINUING | `...VERIFIED → CURRENTLY_ATTESTED ↔ STALE_NO_RECENT_ATTESTATION`; → `ENDED`; → `REVOKED` | ProofPulse presence/absence; explicit end action |
| EXPIRING | `...VERIFIED →` valid → `EXPIRED` after expiry date | wall-clock vs. `endDate` |
| any | → `INVALID_PROOF` | signature/hash/Merkle verification fails at check time (a computed verdict, never a stored state) |

State is **derived at verification time** from lifecycle type + latest
attestation epoch + revocation flag + expiry date + version — never
hand-set by a UI toggle.

## 9. Merkle / chained-root architecture

Standard Merkle tree (sorted-pair hashing, compatible with OpenZeppelin's
`MerkleProof.verify`) per batch. Chain continuity is an
**application-level** wrapper, not a Merkle property:

```
chainRoot(n) = keccak256(abi.encode(
  batchRoot, previousChainRoot, organisationId, attestationType, epoch
))
```

Enforced on-chain by requiring the submitted `previousChainRoot` to equal
the stored `currentChainRoot` before accepting a new epoch. This makes a
skipped or forked epoch detectable. It does **not** by itself prove every
historical credential — individual Merkle proofs still do that job.

## 10. EIP-712 signing structure

```
domain: { name: "NotSoFarji", version: "1", chainId, verifyingContract }

type CredentialAttestation {
  credentialId: bytes32
  claimHash: bytes32
  organisationId: bytes32
  version: uint256
  nonce: uint256
  timestamp: uint64
}
```

The issuer signs this struct over the claim hash. A nonce map prevents
replay of the same signed attestation.

## 11. Canonical credential format

Before hashing, credentials are canonicalised: deterministic field order,
ISO dates, normalised whitespace, uppercase enums, explicit null
representation, explicit version, UTF-8 deterministic serialisation.

```json
{
  "credentialId": "CRED-001",
  "candidateRef": "CAND-001",
  "claimType": "EMPLOYMENT",
  "organisationId": "ORG-001",
  "title": "SOFTWARE_ENGINEER",
  "startDate": "2026-01-01",
  "endDate": null,
  "lifecycleType": "CONTINUING",
  "version": 1
}
```

## 12. Review 2 build plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1 | Folder skeleton, README, doc stubs | Repo scaffolds compile/lint clean |
| 2 | Next.js UI + mock data, all pages stubbed | Pages render with placeholder content |
| 3 | Credential domain model + canonicalisation | Same object → same canonical string regardless of key order |
| 4 | Keccak-256 hashing service | Hash changes on any field change |
| 5 | EIP-712 typed data + signing/verification | Correct signer recovered; tampered payload fails |
| 6 | Hardhat project + `NotSoFarjiRegistry.sol` skeleton, deploy script | Contract deploys locally |
| 7 | Issuer registry + key rotation + historical validity | Hardhat tests pass |
| 8 | Merkle engine (build tree, generate/verify proof) | Unit tests pass, matches OZ `MerkleProof` |
| 9 | CohortProof end-to-end | Mock cohort → tree → root → anchor → per-student proof works locally |
| 10 | ProofPulse end-to-end | Aug/Sep mock snapshots → anchor → state check works locally |
| 11 | Chained attestation history | Valid chain accepted, wrong `previousChainRoot` rejected |
| 12 | Revocation + full lifecycle state engine | Tests cover all states |
| 13 | Public verifier | All 6 recruiter-facing verdicts walk through correctly |
| 14 | `SOLIDITY_EXPLANATION.md` + `SOLIDITY_VIVA.md` | Both developers can explain every function from the docs |
| 15 | Full test suite green, demo rehearsed | `npx hardhat test` green; demo flow runs without live code edits |

**Status:** all 15 phases are complete and verified. Phases 1-5 and 8-14
are verified via unit tests, build, lint, typecheck, and live smoke
tests. Phases 6, 7, 9-11's on-chain half (`NotSoFarjiRegistry.sol` and
its Hardhat tests) compiles cleanly and passes all 35 tests
(`npm run hardhat:compile && npm run hardhat:test`).

`lib/contract/` (ethers.js bindings from the UI to a deployed contract)
still carries its Phase-1 `README.md` stub — the Review 2 UI stays
mock-data-driven throughout, with the contract verified independently
via Hardhat rather than wired live into the running Next.js app.

## 13. Testing plan

**Hardhat/Solidity** (`test/contract/`): issuer authorisation, unauthorised
issuer rejection, issuer revocation, key rotation, historical issuer
validity, cohort attestation, ProofPulse attestation, correct chain root,
invalid previous chain root, duplicate epoch handling, credential
revocation, Merkle proof success/failure, modified credential hash, EIP-712
correct/incorrect signer, nonce replay attempt.

**TypeScript unit tests** (`test/unit/`): canonicalisation, hashing, EIP-712
signing, Merkle engine, lifecycle state machine (permanent/continuing
current/continuing stale/expiring/ended/revoked).

## 14. Demo plan

The Review 2 demonstration follows a fixed 25-step script (see
`docs/DEMO_SCRIPT.md`, written in Phase 15): candidate dashboard → issuer
approval → canonical hash → EIP-712 signature → CohortProof creation and
per-student proof → ProofPulse creation, staleness, and explicit
employment-end → issuer key rotation with historical validity preserved →
credential revocation → recruiter verification page → Solidity source
walkthrough → Hardhat test run.

## 15. Deferred to Review 3

Supabase Auth/Postgres/Storage, real ERP/API integration, LinkedIn
integration, Vercel deployment, Sepolia/Amoy testnet deployment, production
issuer accounts, HSM/secure signing infrastructure, production key
management. Full list and rationale: `docs/REVIEW3_FUTURE_WORK.md`.
