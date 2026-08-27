# Solidity Viva Preparation

Answers here are written against the actual contract in
`contracts/NotSoFarjiRegistry.sol` — every claim below is verifiably true
of the running code, not aspirational. For the full function-by-function
walkthrough, see `docs/SOLIDITY_EXPLANATION.md`.

## Language & platform fundamentals

**Why Solidity?**
It's the dominant language for the EVM, has first-class support in
Hardhat/OpenZeppelin, and its syntax (structs, mappings, modifiers) maps
directly onto the concepts we needed: a registry, access control, and
event logging.

**Why the EVM (Ethereum Virtual Machine)?**
It's the most widely deployed, widely audited execution environment for
smart contracts, with a huge tooling ecosystem (Hardhat, OpenZeppelin,
ethers.js) that let us build and test this project without inventing our
own infrastructure.

**Why Keccak-256 instead of SHA-256, or NIST SHA3-256?**
Keccak-256 is what the EVM's `keccak256()` opcode computes and what
Solidity's `keccak256()` function calls. It predates the NIST SHA-3
standardisation and uses different padding, so it is **not** the same
digest as SHA3-256 despite the similar name — we specifically verify this
distinction in `test/unit/hash.test.ts` against a known test vector. Using
anything else off-chain would produce hashes the contract could never
match.

**What is `bytes32`?**
A fixed-size, 32-byte (256-bit) value — exactly the size of a Keccak-256
hash, an Ethereum address padded conceptually, or a Merkle root. We use
it for organisation IDs, credential IDs, and all roots, specifically
because fixed size means predictable gas costs and simple mapping keys,
unlike an arbitrary-length `string`.

**What is `msg.sender`?**
The address that directly called the current function. We use it in
`anchorAttestation` and `revokeCredential` to check "is the wallet making
this call actually a currently authorised issuer?" — the chain itself
guarantees `msg.sender` is genuine, because producing a valid transaction
from an address requires that address's private key.

**What is `block.timestamp`?**
The Unix timestamp (seconds since 1970) of the block the current
transaction is included in, set by the block's miner/validator (loosely
trustworthy — off by at most a few seconds, never before the previous
block). We use it to record `validUntil` on revocation/rotation and
`anchoredAt`/`revokedAt` on attestations and revocations.

**What is a mapping?**
Solidity's key-value store type, e.g. `mapping(address => IssuerKeyRecord)`.
Unlike a real hash map, an unset key doesn't error — it returns the
zero value for that type (an empty struct, `false`, `0`), which is why
our code often checks a sentinel field (like `record.wallet == address(0)`)
to distinguish "never set" from "set to a zero-like value."

**What is a struct?**
A custom grouped type — our `IssuerKeyRecord`, `Attestation`, and
`RevocationRecord` are structs bundling related fields together so they
can be stored, returned, and passed around as one value instead of five
separate mappings.

## Access control

**Why use OpenZeppelin's `AccessControl` instead of a simple `owner` variable?**
`AccessControl` is a small, audited, industry-standard pattern that gives
us role checking (`onlyRole`) for free. We only use one role
(`DEFAULT_ADMIN_ROLE`) here, so it's barely more code than a hand-rolled
`onlyOwner` modifier, but it leaves room to add finer-grained roles later
without restructuring the contract.

**What does `onlyRole` do?**
It's a function modifier — code that runs before the function body — that
reverts the whole transaction if `msg.sender` doesn't hold the specified
role. Four admin functions (`registerOrganisation`, `authoriseIssuer`,
`revokeIssuer`, `rotateIssuerKey`) use `onlyRole(DEFAULT_ADMIN_ROLE)`.

**Why are `anchorAttestation` and `revokeCredential` NOT admin-only?**
Because the admin shouldn't be the one issuing credentials or anchoring
attestations — that's the issuer's job. These two functions are open to
call by anyone, but only succeed for a wallet that `isIssuerValidAt` says
is currently authorised. Anyone else's call simply reverts.

## Events

**What is an event?**
A log entry a contract emits, stored cheaply in the transaction receipt
rather than in contract storage. Storage only reflects *current* state;
events are the searchable record of *how it changed over time* — exactly
what a frontend needs for something like "show me every attestation this
organisation has ever anchored."

**What does `indexed` mean on an event parameter?**
Up to three parameters per event can be marked `indexed`, which lets a
client filter logs by that value directly (e.g. "every `IssuerAuthorised`
event for this `organisationId`") without downloading and scanning every
event the contract has ever emitted.

## Merkle trees & proofs

**What is a Merkle root?**
The single hash at the top of a Merkle tree, computed by repeatedly
hashing pairs of nodes together up from the leaves. Any change to any
leaf changes the root — a Merkle root is a compact, tamper-evident
fingerprint of an entire batch of data.

**Why store a Merkle root instead of every credential?**
Anchoring one root costs the same gas whether the batch has 4 credentials
or 4,000 — that's the entire point of CohortProof and ProofPulse: one
transaction attests to an arbitrarily large batch. Verifying one specific
credential's membership is then done off-chain with a Merkle proof — a
short list of sibling hashes — checked against the on-chain root.

**How does `lib/merkle/tree.ts` build the tree, exactly?**
Bottom-up: pairs of nodes are combined with `hashPair`, which sorts the
pair before hashing so that `hashPair(a, b) === hashPair(b, a)` — this
matches OpenZeppelin's `MerkleProof.sol` convention exactly, so a proof
built by our code would verify against the same library on-chain. When a
layer has an odd node out, it carries up unchanged to the next layer
rather than being paired with a duplicate of itself, which avoids a
known proof-forging issue with the "duplicate the last leaf" approach.

**What is a Merkle proof, concretely?**
An ordered list of sibling hashes. To verify, you start with your own
leaf hash and repeatedly combine it with the next sibling in the proof
(via the same sorted-pair `hashPair`) until you've climbed to the root —
if the result matches the known root, the leaf is proven to be part of
that tree, without needing any of the other leaves.

**Does this contract verify Merkle proofs?**
No — deliberately. The contract only stores the root; verification
happens off-chain, wherever a verifier needs to check inclusion (see
`/cohortproof` and `/proofpulse` in the app for a fully worked example).
This keeps the contract simple and keeps gas costs flat regardless of
batch size.

## Chained attestations

**What are "chained Merkle attestations"?**
Each new attestation's `chainRoot` is computed as
`keccak256(abi.encode(batchRoot, previousChainRoot, organisationId, attestationType, epoch))`
— it depends on the *entire* history before it, not just the new batch.
`anchorAttestation` requires the caller to supply the current chain head
as `previousChainRoot`, so submitting against a stale or wrong value
reverts. This makes a skipped, forged, or reordered epoch detectable.

**Does the latest chain root alone prove every historical credential is valid?**
No — and we're explicit about this in the design docs. The chain root
proves *continuity* (nothing in the history was silently altered).
Proving an *individual* credential still requires that credential's own
Merkle proof against the specific batch root it belongs to.

## Issuer keys & security

**What is an issuer wallet?**
An Ethereum address the admin has authorised (via `authoriseIssuer`) to
sign attestations and revocations on behalf of one specific organisation.
A signature alone only proves a private key was used — the on-chain
issuer registry is what lets a verifier know *whose* key it actually was.

**How is key rotation handled?**
`rotateIssuerKey` revokes the old wallet and authorises a new one in a
single transaction, emitting one `IssuerKeyRotated` event instead of two
separate ones.

**What happens if an old key is compromised?**
The admin calls `revokeIssuer` (or `rotateIssuerKey` if there's a
replacement ready). The compromised wallet's `validUntil` is set to
`block.timestamp`, so `isIssuerValidAt` returns `false` for it from that
moment on — but still returns `true` for timestamps *before* the
revocation, so it can't be used to retroactively invalidate everything
that wallet legitimately signed.

**Worked example: does a signature made before rotation stay valid?**
Yes. Say Wallet A is authorised January 2026 – it signs a credential in
June 2026, then gets rotated away in January 2027.
`isIssuerValidAt(walletA, <June 2026>)` still returns `true` after the
rotation, because June 2026 falls inside `[validFrom, validUntil)` =
`[Jan 2026, Jan 2027)`. But `isIssuerValidAt(walletA, <March 2027>)`
returns `false` — that's the whole point of checking a signature against
the wallet's status *at the time it was made*, not its status today. See
`test/contract/issuerRegistry.test.ts` for the executable version of this
exact scenario.

**What is revocation, and how is it different from key rotation?**
Key rotation retires an *issuer's wallet* (the signing key). Credential
revocation invalidates one *specific credential* the issuer signed. An
issuer can still be fully authorised while one of the credentials it
issued gets revoked (e.g. it turns out to have been fraudulent), and
vice versa.

## ProofPulse & CohortProof

**What is ProofPulse?**
A periodic (e.g. monthly) Merkle batch of currently-active continuing
claims (like current employment), anchored the same way as any other
attestation via `anchorAttestation` with `attestationType = PROOF_PULSE`.
One transaction refreshes the "still current" status of every credential
in the batch.

**Why isn't absence from a ProofPulse batch the same as "employment ended"?**
Because absence only tells you the issuer *hasn't recently re-attested*
that credential — maybe it was a clerical omission, maybe the batch
process hasn't run yet. Employment actually ending is recorded as an
explicit, separate action (setting an end date), which our state machine
(`lib/verification/stateMachine.ts`) checks *before* it even looks at
ProofPulse freshness. Absence alone can only ever produce
`STALE_NO_RECENT_ATTESTATION`, never `ENDED`.

**What is CohortProof?**
The same anchoring mechanism (`attestationType = COHORT`), used for
something permanent instead of recurring — e.g. one Merkle batch covering
an entire graduating class, anchored once, with each student getting
their own Merkle proof of inclusion.

## Design & novelty

**What exactly is novel in NotSoFarji, versus established cryptography?**
Keccak-256, ECDSA, EIP-712, Merkle trees/proofs, and blockchain anchoring
are all established techniques — we don't claim to have invented any of
them. What's actually new here is the *application-level design*:
ProofPulse (periodic re-attestation of continuing claims), CohortProof
(one-batch attestation for permanent claims), lifecycle-aware credential
typing with a derived state machine, chained institutional attestations,
and time-aware issuer key history. See the Novelty page in the app for
the full breakdown.

**Why do we need blockchain instead of just a PostgreSQL database?**
A database is trivially editable by whoever controls it — including
retroactively. The property we actually need is that once an issuer
attests something, *nobody, including the issuer,* can quietly rewrite
that history without it being detectable. That's what a blockchain (an
append-only, publicly verifiable ledger) provides that a private database
doesn't.

**Why do we still need an issuer at all — can't the blockchain just decide if a degree is real?**
No. A blockchain can only tell you what was recorded and by whom — it has
no way to independently know whether a university actually awarded a
particular degree. Real-world truth still has to come from a trusted,
identifiable issuer (the university); the blockchain's job is only to
make that issuer's attestation tamper-evident and permanently checkable.

**Why use EIP-712 instead of just signing a raw hash?**
A raw `keccak256` signature doesn't say *what* it's a signature over, or
in what context — it could be replayed against a different contract, a
different chain, or misinterpreted entirely. EIP-712 (`lib/crypto/eip712.ts`)
defines a typed, human-readable structure and binds the signature to a
specific domain (contract name, version, chain ID), so a signature made
for NotSoFarji on one network can't be replayed as if it meant something
else elsewhere.

**What is replay protection, and what's the nonce for?**
Replay protection stops a legitimately-signed message from being reused
in a context it wasn't intended for. Our EIP-712 struct
(`CredentialAttestation`) includes a `nonce` field precisely so the same
signed attestation can't be resubmitted twice and mistaken for a new one.

**What happens if a candidate edits a verified credential?**
It becomes a new version (`version` increments, `previousVersionId` links
back). The state machine marks the *old* version `MODIFIED` — it remains
as historical evidence, but is no longer the currently valid claim — and
the new version starts over at `SELF_DECLARED`/`PENDING`, requiring fresh
issuer verification. The old signature is never silently reused for the
new content, because the new content hashes to a different value
entirely (Phase 3/4's canonicalisation + Keccak-256).

**How is this different from Blockcerts (or similar existing systems)?**
Systems like Blockcerts already do hashing, signing, and blockchain
anchoring for individual certificates — we don't dispute that or claim to
improve on the cryptography. What they don't generally address is that
*not all professional claims behave the same way over time*: a degree is
a permanent fact, but "currently employed" is a state that can change
without the original signature becoming false. NotSoFarji's contribution
is the lifecycle-aware layer on top — ProofPulse, CohortProof, and a
state machine that treats permanent, continuing, and expiring claims
differently, rather than treating every credential as a single static
proof-of-issuance the way most existing systems do.
