# Solidity Contract Explanation — `NotSoFarjiRegistry.sol`

This document walks through every part of `contracts/NotSoFarjiRegistry.sol`
in plain language, so either developer can explain it during the Review 2
viva without having memorised anything they don't actually understand.

For the overall design rationale (why one contract, why bytes32 IDs, why
this data model) see `docs/ARCHITECTURE.md` section 6. This document is
about the mechanics: what each piece of code actually does.

---

## The big picture

The contract has exactly one job: **be a public, tamper-evident record of
what an authorised issuer attested, and when.** It never stores what a
credential actually says (no names, no job titles, no dates of birth) —
only:

- which wallets are currently (and were historically) authorised to sign
  on behalf of which organisation,
- Merkle roots representing batches of credentials an issuer vouched for,
  chained together so a skipped or forged batch is detectable, and
- a public "this credential is revoked" flag, keyed by a hash of the
  credential's ID.

Everything else — the actual claim content, the candidate's name, the
Merkle proof for one specific credential — lives off-chain, in
`lib/mock-data` and `lib/merkle` for this prototype (a real database in
Review 3). The blockchain's job is narrow on purpose.

## Enums

```solidity
enum AttestationType { COHORT, PROOF_PULSE }
```

There are two kinds of batch attestation NotSoFarji anchors: a
**CohortProof** (a one-time batch for something permanent, like a
graduating class) and a **ProofPulse** (a recurring batch re-attesting
which continuing claims — like current employment — are still active).
This enum just tags which kind a given `Attestation` is. Solidity stores
an enum as its underlying integer (`COHORT` = 0, `PROOF_PULSE` = 1), so
using it as a mapping key is exactly as cheap as using a `uint8` directly,
but type-safe — the compiler won't let you pass `2` where an
`AttestationType` is expected.

## Structs

```solidity
struct Organisation {
    string name;
    bool registered;
}
```
A minimal record of a registered organisation. `registered` exists
because Solidity mappings can't distinguish "never set" from "set to the
zero value" — without it, an unregistered organisation and one named `""`
would look identical.

```solidity
struct IssuerKeyRecord {
    bytes32 organisationId;
    address wallet;
    uint64 validFrom;
    uint64 validUntil;
    bool revoked;
}
```
One entry in an organisation's key history. `validUntil == 0` means "not
yet revoked" — safe, because `block.timestamp` is never realistically 0
(that's January 1970). This is the struct that makes key rotation and
historical validity possible: a wallet's record says exactly which window
of time it was trusted for.

```solidity
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
```
One anchored Merkle batch. `batchRoot` is the actual Merkle root computed
off-chain (by `lib/merkle`). `previousChainRoot` and `chainRoot` are what
make successive attestations chain together — see **Attestation
Anchoring** below.

```solidity
struct RevocationRecord {
    bool revoked;
    uint64 revokedAt;
    address issuer;
}
```
A public record of a revocation: whether it happened, when, and which
wallet did it.

## Mappings (storage)

```solidity
mapping(bytes32 => Organisation) public organisations;
mapping(address => IssuerKeyRecord) public issuerRecords;
mapping(bytes32 => address[]) private issuerWalletsByOrg;
mapping(bytes32 => mapping(AttestationType => bytes32)) private currentChainRoot;
mapping(bytes32 => mapping(AttestationType => mapping(uint64 => Attestation))) private attestations;
mapping(bytes32 => mapping(AttestationType => uint64[])) private epochsByOrgAndType;
mapping(bytes32 => RevocationRecord) public revocations;
```

A few design notes worth being able to explain:

- **Organisation and credential IDs are `bytes32`, not `string`.** Off-chain,
  an organisation is `"ORG-XYZ"` and a credential is `"CRED-002"` — short,
  readable strings. Before anything touches the contract, they're hashed
  with Keccak-256 (`lib/crypto/hash.ts`) into a fixed-size `bytes32`. This
  keeps every mapping key the same size regardless of how long the
  original ID string was, and keeps gas costs predictable.
- **`issuerRecords` holds one record per wallet, not per organisation.**
  A wallet belongs to exactly one organisation for its entire lifetime —
  once revoked or rotated away from, it's never reused. This is a
  deliberate simplification matching real-world key hygiene (never reuse
  a retired key) and it's what makes `isIssuerValidAt` a single mapping
  lookup instead of a search.
- **The array-valued mappings (`issuerWalletsByOrg`, `attestations`,
  `epochsByOrgAndType`) are `private`, each with its own `view` function.**
  A `public` mapping of arrays only lets you fetch one element at a time
  (Solidity auto-generates an index-based getter, not a whole-array one),
  which isn't useful for "give me this organisation's entire key
  history." A dedicated function that returns the whole array is what
  the Admin Dashboard and Issuer Dashboard actually need.

## Events

```solidity
event OrganisationRegistered(bytes32 indexed organisationId, string name);
event IssuerAuthorised(bytes32 indexed organisationId, address indexed wallet, uint64 validFrom);
event IssuerRevoked(bytes32 indexed organisationId, address indexed wallet, uint64 revokedAt);
event IssuerKeyRotated(bytes32 indexed organisationId, address indexed oldWallet, address indexed newWallet, uint64 rotatedAt);
event AttestationAnchored(bytes32 indexed organisationId, AttestationType attestationType, uint64 epoch, bytes32 batchRoot, bytes32 chainRoot, address indexed issuerWallet);
event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer, uint64 revokedAt);
```

Events are how a frontend (or anyone) cheaply reconstructs history without
re-reading every storage slot. A smart contract's storage only tells you
the *current* state; events are the searchable log of *how it got there*.
The `indexed` parameters (up to three per event) let a client filter
logs by, say, "every event for this organisationId" without downloading
and scanning every event the contract has ever emitted.

## Access control

```solidity
contract NotSoFarjiRegistry is AccessControl {
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
}
```

The contract inherits OpenZeppelin's `AccessControl`, which gives it a
`DEFAULT_ADMIN_ROLE` (a `bytes32` constant, actually just `0x00...00`) and
an `onlyRole(...)` modifier for free. The constructor grants that role to
whoever deploys the contract. Four functions — the ones that manage the
issuer registry itself — are restricted to this role with
`onlyRole(DEFAULT_ADMIN_ROLE)`. Two functions — anchoring an attestation
and revoking a credential — are deliberately **not** admin-only; they're
open to call, but only have any effect for a wallet that's currently an
authorised issuer (checked inside the function via `isIssuerValidAt`).

**Why not just use a plain `owner` address (a simpler pattern)?**
`AccessControl` is barely more code than a hand-rolled `onlyOwner`
modifier here (we only ever use one role), but it's the standard,
audited OpenZeppelin pattern, and it leaves room to add more granular
roles later (e.g. a separate role that can register organisations but
not authorise issuers) without changing the contract's shape.

---

## Function-by-function

### `registerOrganisation(bytes32 organisationId, string calldata name)`

1. **What it does:** creates a new organisation record.
2. **Who can call it:** only the admin (`onlyRole(DEFAULT_ADMIN_ROLE)`).
3. **Parameters:** `organisationId` — Keccak-256 hash of the org's string
   ID (e.g. hash of `"ORG-XYZ"`); `name` — a human-readable display name.
4. **State changes:** writes `organisations[organisationId]`; emits
   `OrganisationRegistered`.
5. **Why blockchain is required:** a public, permanent record of which
   organisations exist means a verifier doesn't have to trust NotSoFarji's
   own website about which organisations are "real" — anyone can read the
   chain directly.
6. **Security concern it solves:** without a registry, `authoriseIssuer`
   below would have no way to check "is this a real organisation" before
   handing out issuer authority.
7. **Example input:** `organisationId = keccak256("ORG-XYZ")`,
   `name = "XYZ Technologies Demo"`.
8. **Example result:** `organisations[organisationId] = { name: "XYZ Technologies Demo", registered: true }`.

### `authoriseIssuer(bytes32 organisationId, address wallet, uint64 validFrom)`

1. **What it does:** grants a wallet the authority to sign attestations
   and revocations on behalf of an organisation, starting at `validFrom`.
2. **Who can call it:** admin only.
3. **Parameters:** `organisationId`, `wallet` — the address to authorise,
   `validFrom` — a Unix timestamp.
4. **State changes:** creates `issuerRecords[wallet]`; appends `wallet` to
   `issuerWalletsByOrg[organisationId]`; emits `IssuerAuthorised`.
5. **Why blockchain is required:** a signature only proves a private key
   was used — it says nothing about *whose* key it is. This function is
   what lets a verifier answer "was this wallet actually IIT Delhi's
   issuer wallet?" from public, admin-controlled data instead of trusting
   an off-chain claim.
6. **Security concern it solves:** without this registry, anyone could
   generate a wallet, sign a fake "degree" attestation, and there'd be no
   on-chain way to tell it apart from a real one.
7. **Example input:** `organisationId = keccak256("ORG-XYZ")`,
   `wallet = 0x7099...`, `validFrom = 1767225600` (2026-01-01).
8. **Example result:** `issuerRecords[0x7099...] = { organisationId, wallet: 0x7099..., validFrom: 1767225600, validUntil: 0, revoked: false }`.

### `revokeIssuer(address wallet)`

1. **What it does:** immediately ends a wallet's authority to issue.
2. **Who can call it:** admin only.
3. **Parameters:** `wallet` — the wallet to revoke.
4. **State changes:** sets `issuerRecords[wallet].revoked = true` and
   `validUntil = block.timestamp`; emits `IssuerRevoked`.
5. **Why blockchain is required:** revocation needs to be just as public
   and tamper-evident as authorisation was — otherwise a compromised key
   could keep signing convincingly forever with no way for a verifier to
   learn otherwise.
6. **Security concern it solves:** key compromise. If an issuer's private
   key leaks, this is how the damage window is closed for *future*
   signatures (past ones are still evaluated fairly — see
   `isIssuerValidAt`).
7. **Example input:** `wallet = 0x7099...`.
8. **Example result:** that wallet's record now has `revoked: true` and a
   `validUntil` timestamp; any future signature from it fails
   `isIssuerValidAt`.

### `rotateIssuerKey(bytes32 organisationId, address oldWallet, address newWallet, uint64 newValidFrom)`

1. **What it does:** revokes `oldWallet` and authorises `newWallet` for
   the same organisation, in a single transaction.
2. **Who can call it:** admin only.
3. **Parameters:** `organisationId`, `oldWallet`, `newWallet`,
   `newValidFrom`.
4. **State changes:** same as `revokeIssuer(oldWallet)` plus
   `authoriseIssuer(organisationId, newWallet, newValidFrom)`'s effects,
   done together; emits `IssuerKeyRotated` (not the two separate events).
5. **Why blockchain is required:** the *history* of key rotation needs to
   be public and ordered, so a verifier checking an old signature can see
   exactly when the old key stopped being trusted.
6. **Security concern it solves:** this is the function that answers the
   viva's favourite question — **"what happens if a key rotates? Does an
   old signature become invalid?"** No: `isIssuerValidAt(oldWallet, t)`
   still returns `true` for any `t` before the rotation. Only signatures
   claiming a timestamp *after* rotation fail. See the worked example in
   `docs/SOLIDITY_VIVA.md`.
7. **Example input:** `organisationId = keccak256("ORG-XYZ")`,
   `oldWallet = 0x7099...`, `newWallet = 0x3C44...`,
   `newValidFrom = 1798761600` (2027-01-01).
8. **Example result:** `0x7099...` is now revoked as of the rotation
   timestamp; `0x3C44...` is authorised from 2027-01-01 onward; both
   appear in `issuerWalletsByOrg[organisationId]`.

### `isIssuerValidAt(address wallet, uint64 timestamp) view`

1. **What it does:** answers "was `wallet` an authorised issuer for its
   organisation at `timestamp`?"
2. **Who can call it:** anyone — it's a `view` function, free to call
   off-chain, and it's also used internally by `anchorAttestation` and
   `revokeCredential` to check `msg.sender`.
3. **Parameters:** `wallet`, `timestamp`.
4. **State changes:** none — it only reads.
5. **Why blockchain is required:** this is the actual trust check every
   other part of the system depends on; it has to read from the same
   tamper-evident registry everything else writes to.
6. **Security concern it solves:** this single function is what makes
   time-aware key history *usable* rather than just *recorded* — every
   caller checks against a specific point in time, not just "is this
   wallet currently active."
7. **Example input:** `wallet = 0x7099...`, `timestamp` = some moment in
   June 2026.
8. **Example result:** `true`, because that wallet's `validFrom` (Jan
   2026) ≤ timestamp < `validUntil` (Jan 2027, when it was later
   rotated).

### `getIssuerHistory(bytes32 organisationId) view`

Returns the full array of every wallet ever authorised for an
organisation, in authorisation order. Used by the Admin Dashboard's "View
issuer key history" feature. No access restriction — issuer history is
meant to be publicly auditable.

### `anchorAttestation(bytes32 organisationId, AttestationType attestationType, uint64 epoch, bytes32 batchRoot, bytes32 previousChainRoot)`

1. **What it does:** records a CohortProof or ProofPulse batch's Merkle
   root on-chain, linked to the organisation's previous attestation of
   the same type.
2. **Who can call it:** anyone can *call* it, but it only succeeds for a
   wallet that `isIssuerValidAt` says is currently authorised **for the
   specific `organisationId` given** — an issuer from one organisation
   cannot anchor on behalf of another.
3. **Parameters:** `organisationId`, `attestationType`, `epoch` (a
   sequential batch number per stream), `batchRoot` (computed off-chain
   by `lib/merkle`), `previousChainRoot` (must equal the stream's current
   head).
4. **State changes:** writes a new `Attestation` into `attestations`,
   updates `currentChainRoot[organisationId][attestationType]`, appends
   `epoch` to `epochsByOrgAndType`; emits `AttestationAnchored`.
5. **Why blockchain is required:** this is the actual anchoring — the
   one action that turns an off-chain Merkle batch into a public,
   timestamped, hard-to-forge commitment. Without a blockchain, "we
   attested this batch on this date" is just a claim the issuer could
   quietly change later.
6. **Security concern it solves:** the `previousChainRoot` check is what
   makes a skipped or forked epoch detectable — see **Chain continuity**
   below. The duplicate-epoch check (`anchoredAt == 0`) stops the same
   epoch number from being anchored twice.
7. **Example input:** `organisationId = keccak256("ORG-XYZ")`,
   `attestationType = PROOF_PULSE`, `epoch = 1`, `batchRoot` = the real
   Merkle root of August's active-employee batch, `previousChainRoot` =
   `bytes32(0)` (this is the first epoch for this stream).
8. **Example result:** a new `Attestation` stored at
   `attestations[orgId][PROOF_PULSE][1]`; `currentChainRoot[orgId][PROOF_PULSE]`
   updated to the newly computed `chainRoot`.

#### Chain continuity, worked through

```solidity
bytes32 chainRoot = keccak256(
    abi.encode(batchRoot, previousChainRoot, organisationId, attestationType, epoch)
);
```

Each new `chainRoot` is a hash of the new batch root **plus** the
previous `chainRoot` plus identifying context (org, type, epoch). That
means each attestation's chain root depends on the entire history before
it — you can't recompute epoch 5's chain root without knowing epoch 4's,
which depends on epoch 3's, and so on back to the start. If someone tried
to insert, remove, or reorder a historical epoch, every chain root after
that point would change, which is immediately checkable because
`anchorAttestation` requires the caller to supply the *current* head as
`previousChainRoot` — get it wrong (because history was tampered with, or
just a mistake) and the transaction reverts with `"Invalid previous chain
root"`.

### `getAttestation(...)`, `getCurrentChainRoot(...)`, `getEpochs(...) view`

Read-only lookups matching the three private mappings above. No access
restriction — every attestation is meant to be publicly verifiable.

### `revokeCredential(bytes32 credentialId)`

1. **What it does:** marks a specific credential (by its hashed ID)
   revoked.
2. **Who can call it:** any wallet that `isIssuerValidAt` currently
   authorises for *some* organisation (see the limitation below).
3. **Parameters:** `credentialId` — Keccak-256 hash of the credential's
   string ID.
4. **State changes:** writes `revocations[credentialId]`; emits
   `CredentialRevoked`.
5. **Why blockchain is required:** revocation needs to be a public,
   permanent, negative assertion nobody (including the original issuer)
   can quietly reverse — exactly the kind of fact a blockchain is good
   for recording.
6. **Security concern it solves:** without on-chain revocation, an
   issuer's only way to invalidate a wrongly-issued or outdated
   credential would be some off-chain announcement a verifier might never
   see.
7. **Known Review 2 limitation:** the contract has no on-chain record of
   which organisation issued a given `credentialId` (credential content —
   including which org it belongs to — lives entirely off-chain by
   design). So this check is "is the caller *some* currently authorised
   issuer," not "is the caller *that credential's* issuer." A production
   version would track credential-to-organisation ownership at anchoring
   time so revocation could be restricted to the issuing org — deferred
   to Review 3.
8. **Example input:** `credentialId = keccak256("CRED-005")`.
9. **Example result:** `revocations[credentialId] = { revoked: true, revokedAt: <timestamp>, issuer: <caller> }`.

### `isCredentialRevoked(bytes32 credentialId) view`

Returns `revocations[credentialId].revoked`. Public, no restriction —
revocation status must be checkable by anyone, with no login and no
special access, which is exactly what the public recruiter verification
page relies on.

---

## What this contract deliberately does *not* do

- It never verifies a Merkle proof itself. Proof verification happens
  off-chain (`lib/merkle`), against the root the contract stored. The
  contract's job is to be a trustworthy place to *look up* that root, not
  to do the verification math.
- It never checks an EIP-712 signature. Anchoring and revocation are
  authenticated by `msg.sender` — the issuer's wallet directly sends the
  transaction, so the chain itself (via the transaction's signature)
  already proves who called it. The EIP-712 flow in `lib/crypto/eip712.ts`
  is used for a different purpose: an issuer's off-chain attestation that
  one specific candidate's claim is genuine, which a verifier checks
  independently of anything on-chain.
- It never stores candidate names, job titles, dates, or any other claim
  content. Only hashes, Merkle roots, and revocation flags.
