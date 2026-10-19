# FARJI Merkle Model

FARJI uses two Merkle engines with different shapes because the evidence they
protect behaves differently:

| | CohortProof | ProofPulse |
|---|---|---|
| Protects | PERMANENT and EXPIRING Credentials | Current state of CONTINUING Credentials |
| Tree type | Static batch tree | Persistent, fixed-depth, incremental (dynamic) tree |
| Changes after anchoring? | Never — a sealed batch is immutable | Yes — affected leaf/path updates on each state change |
| On-chain | One root per batch | One root per epoch (snapshot of the already-current root) |
| Typical example | A university's graduating cohort | An employer's active staff |

Neither engine is novel; both are standard Merkle constructions. FARJI's
contribution is how they are applied to credential lifecycles. Do not describe
the primitives as novel anywhere.

Terminology follows [DOMAIN_MODEL.md](DOMAIN_MODEL.md). On-chain anchoring follows
[BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md).

---

## 1. Shared conventions

- Hash function: Keccak-256 (`keccak256`), identical in TypeScript and Solidity.
- Encoding: Solidity `abi.encode` (not `abi.encodePacked`) for every leaf preimage,
  to avoid ambiguous concatenation.
- **Domain separation**: every leaf preimage starts with a fixed `bytes32` tag
  (`COHORT_LEAF_V1`, `PULSE_LEAF_V1`), so a leaf from one engine can never verify
  in the other.
- **Second-preimage protection**: leaves are double-hashed —
  `leaf = keccak256(bytes.concat(keccak256(abi.encode(...))))` — so a leaf value
  can never equal an internal node value.
- **No personal data in leaves.** Leaves contain only commitments and metadata:
  `credentialId`, `subjectCommitment` (salted), `contentDigest` (EIP-712 hash of
  salted content), lifecycle fields and timestamps. Each Credential has **three
  distinct** 32-byte random salts: `credentialSalt` (feeds `credentialId`; becomes
  public if the credential is revoked), `contentSalt` (salts `contentDigest`; private)
  and `subjectSalt` (salts `subjectCommitment`; private). They must never be reused
  for one another, so publishing `credentialSalt` at revocation reveals nothing about
  claim content or subject.
- Content is canonicalised before hashing (deterministic normalisation, then
  EIP-712 `hashStruct`) — specified in Phase 6.
- All Merkle logic lives in `lib/merkle/` (pure, no I/O) and is consumed by the
  server, the Hardhat tests and any client-side verifier, so there is exactly one
  implementation.
- Golden test vectors (input → leaf → root → proof) are committed and checked by
  both TypeScript and Solidity tests.

---

## 2. CohortProof (static batches)

### 2.1 Leaf
```
COHORT_LEAF_V1, orgId, credentialId, subjectCommitment, contentDigest,
lifecycleType, validFrom, validUntil, issuedAt, schemaId
```
(`validUntil = 0` for PERMANENT.)

Exact formula (Phase 7, `lib/merkle/cohort.ts`):
```
leaf = keccak256(keccak256(abi.encode(
  bytes32 COHORT_LEAF_V1, bytes32 orgId, bytes32 credentialId, bytes32 subjectCommitment,
  bytes32 contentDigest, uint8 lifecycleType, uint64 validFrom, uint64 validUntil,
  uint64 issuedAt, bytes32 schemaId)))
COHORT_LEAF_V1 = keccak256(utf8("FARJI_COHORT_LEAF_V1"))
```
`validFrom` is the effective start date of the underlying claim; `issuedAt` is the actual
signature timestamp (they are different values and never interchanged). The leaf is
always rebuilt from the Credential row; a stored `leafHash` that no longer matches blocks
sealing. Only PERMANENT (0) and EXPIRING (2) credentials are accepted (CONTINUING is
rejected by the engine and by a database trigger).

### 2.2 Construction
- Compatible with OpenZeppelin `StandardMerkleTree` / `MerkleProof`:
  double-hashed leaves, **sorted-pair** internal hashing, deterministic leaf order.
  The library (pinned to an exact version) sorts leaves **by leaf hash**, so the root
  depends only on the leaf *set*, never on insertion or race order. Odd nodes follow the
  library's complete-binary-tree layout (a lone node is promoted; the last node is never
  duplicated). `CohortLeaf.position` is the **insertion sequence** (immutable at insert);
  the tree order comes from sorting.
- Duplicate credentials are rejected before building; an empty batch cannot be sealed; a
  single-leaf batch has root = leaf and an empty proof.
- Proof format, written once at sealing: `{ "v": 1, "treeIndex": n, "siblings": ["0x…"] }`.
- Sealing locks the Organisation row, rebuilds every leaf from its Credential and builds
  the tree once. A late entrant never mutates a sealed batch: it joins the next OPEN
  batch (a supplementary batch).
- A batch is OPEN while approved+signed Credentials accumulate (it may contain a
  single Credential), then SEALED (no further changes), then ANCHORED.
- The **full tree** (all leaves, all layers or enough to rebuild deterministically)
  is persisted off-chain. **Only the root** (plus leafCount and metadata) goes
  on-chain.

### 2.3 Proof and verification
- A proof is the sibling path from leaf to root. Verifier recomputes the leaf from
  the presented Credential evidence, folds the proof, compares to the anchored
  `batchRoot`, and confirms the Anchor is in the issuing Organisation's COHORT
  attestation chain.
- Revocation is **not** expressed by changing the tree. Sealed trees are never
  rebuilt. Revocation uses the on-chain revocation registry.

### 2.4 Cost
| Operation | Cost |
|---|---|
| Build batch of n | O(n) hashes, once |
| Anchor | 1 transaction, O(1) storage |
| Proof size / verify | O(log n) |

---

## 3. ProofPulse (dynamic, event-driven)

### 3.1 Core principles (non-negotiable)
1. **Event-driven.** The tree changes only when protected state changes
   (a new CONTINUING Credential joins, or a status change ends one).
2. **Path-only updates.** A change recomputes only the affected leaf and its
   path to the root: O(depth) hashes. The full tree is never rebuilt for a
   state change.
3. **No calendar rebuilds.** A month (or any time period) passing is not an event.
   Nothing is recomputed because the date changed.
4. **Persistent off-chain state.** The full current tree state (leaves and node
   values) is persisted in PostgreSQL. Historical proof material is retained as
   described in §3.5.
5. **New root on protected change only.** Each protected change produces a new
   root with an incremented `rootSeq`.
6. **Anchoring is a snapshot.** Anchoring an epoch writes the *already-current*
   root on-chain. Anchoring must never rebuild or recompute the tree.
7. **History is kept.** Old anchored roots remain valid historical checkpoints,
   and proofs against them remain verifiable.
8. **Freshness is policy, not tree work.** The freshness window
   (`pulseFreshnessDays`, configurable, initial default 45) is evaluated by the
   verification engine against epoch anchor times. It never causes tree changes.

### 3.2 Tree shape
- One ProofPulse tree per Organisation (MVP). Each leaf records its scope
  (EMPLOYMENT, ENROLMENT or MEMBERSHIP). This matches the single PROOF_PULSE
  attestation chain per Organisation (BLOCKCHAIN_MODEL §8), so ProofPulse epochs and
  chain epochs correspond one-to-one. No `treeId` or sharding in the MVP (ROADMAP
  D23, decided).
- Future scalability extension (not MVP): multiple ProofPulse trees or sharding per
  Organisation. If introduced, the attestation chain key must become
  (Organisation, attestation type, `treeId`).
- Fixed-depth binary tree (initial depth 20 → 1,048,576 leaves; final depth is a
  Phase 7 decision). Empty positions use precomputed zero-subtree hashes
  (`zero[0] = keccak256(PULSE_EMPTY_V1)`, `zero[i+1] = H(zero[i], zero[i])`).
- **Positional** hashing: `node = keccak256(abi.encode(PULSE_NODE_V1, left, right))`,
  left/right determined by index bits. (Unlike CohortProof, pairs are not sorted,
  because the leaf index is meaningful and stable.)
- Leaves are assigned the next free index on insertion and **keep that index forever**.
  ENDED leaves stay in the tree with status ENDED; they are never removed, because
  the ENDED state itself is evidence.

### 3.3 Leaf
```
PULSE_LEAF_V1, orgId, leafIndex, credentialId, subjectCommitment, contentDigest,
scope, status (ACTIVE | ENDED), statusEffectiveAt, statusSeq
```
- `statusSeq` starts at 1 on insertion and increases by exactly one with every
  status change for that leaf. It matches the `statusSeq` inside the issuer's
  StatusChangeAttestation and prevents replay/rollback (an old ACTIVE attestation
  cannot restore an ENDED leaf).

Exact formulas (Phase 7, `lib/merkle/pulse.ts`):
```
leaf = keccak256(keccak256(abi.encode(
  bytes32 PULSE_LEAF_V1, bytes32 orgId, uint32 leafIndex, bytes32 credentialId,
  bytes32 subjectCommitment, bytes32 contentDigest, uint8 scope, uint8 status,
  uint64 statusEffectiveAt, uint32 statusSeq)))
node = keccak256(abi.encode(bytes32 PULSE_NODE_V1, bytes32 left, bytes32 right))   // positional
zero[0] = keccak256(PULSE_EMPTY_V1);  zero[i+1] = node(zero[i], zero[i])
```
- `scope`: EMPLOYMENT 0 · ENROLMENT 1 · MEMBERSHIP 2, from the claim category
  (EXPERIENCE → EMPLOYMENT, EDUCATION → ENROLMENT, MEMBERSHIP and CERTIFICATION →
  MEMBERSHIP; ROADMAP D42). `status`: ACTIVE 0 · ENDED 1.
- On insertion `status = ACTIVE`, `statusSeq = 1`, `statusEffectiveAt` = the credential's
  `validFrom` (the effective start of the claim, not the signing time; ROADMAP D43). An
  ENDED leaf carries the `effectiveAt` and `statusSeq` of the signed StatusChangeAttestation.
- Level 0 holds the leaf hashes and level `depth` the root; the node on a leaf's path at
  level `l` is at position `leafIndex >> l` and its sibling at `(leafIndex >> l) ^ 1`. A
  node that was never written equals `zero[level]`. Depth is 20 (capacity 1,048,576); a
  full tree refuses new leaves and leaves the credential SIGNED.

### 3.4 Operations
| Operation | Trigger | Work |
|---|---|---|
| `insertLeaf` | CONTINUING Credential SIGNED | Write leaf at next index, recompute its path: O(depth). `rootSeq += 1`. |
| `updateLeafStatus` | Valid StatusChangeAttestation (e.g. ENDED) | Rewrite one leaf, recompute its path: O(depth). `rootSeq += 1`. |
| `getProof(leafIndex)` | Verification against the current root | Read O(depth) sibling nodes. |
| `getHistoricalProof(leafIndex, epoch)` | Verification against an older anchored root | From retained proof material (§3.5). |
| `anchorEpoch` | Issuer action (periodic or after changes) | Read `currentRoot` + `currentRootSeq`; submit on-chain. No hashing of the tree. |

Every mutation runs in one database transaction that (a) locks the tree row and reads
its fresh state, then checks the expected `currentRootSeq` (optimistic concurrency, so
two concurrent updates cannot both derive from the same old root), (b) writes the leaf,
(c) writes the `depth + 1` recomputed path nodes, (d) records whatever proof material
§3.5 requires, (e) advances `currentRoot`/`currentRootSeq`. In the implementation the
conditional advance of `currentRootSeq` is the first write, so a writer working from a
stale snapshot is rejected cleanly before anything else is written.

### 3.5 Persistence and history
Required (permanent):
- `ProofPulseUpdate(treeId, rootSeq, kind, leafIndex, newLeafHash, previousRoot,
  newRoot, causedByAttestationId)` — append-only log of every tree change; this is the
  permanent root history (Phase 2 reserves it; Phase 7 populates it).
- A ProofPulse epoch is an `Anchor` row of type PROOF_PULSE (`epoch` = position in the
  Organisation's PROOF_PULSE attestation chain, `rootSeq` = the tree state it
  snapshots). There is no separate epoch table.
- `ProofPulseLeaf` and `ProofPulseNode` hold the *current* leaf states and node
  hashes (a rewritable projection/cache, derivable from the update log).
- Every anchored root, and **enough evidence to verify inclusion proofs against it**
  for every leaf it contained, e.g. "Aarav was ACTIVE as of the January checkpoint".

**Strategy chosen in Phase 7 (ROADMAP D21 closed): replay of the append-only update log.**
`ProofPulseUpdate` (one row per change, with `rootSeq`, `leafIndex`, `newLeafHash`,
`previousRoot`, `newRoot` and the causing Attestation) is the permanent history. A proof
against the root at any `rootSeq` is rebuilt by replaying the log up to that `rootSeq`
into a sparse in-memory tree (O(n·depth)); the replay must reproduce every recorded
`newRoot`, so a corrupt log fails loudly instead of yielding a plausible proof. No
historical intermediate nodes are stored, no schema addition is needed, and the leaf
preimage at that time is rebuilt from the Credential plus the Attestation named by
`causedByAttestationId`. Archiving or snapshots can be added later without changing
verification.

Not required:
- There is **no** permanent requirement that every historical intermediate Merkle
  node stays in the hot production database. The implementation (Phase 7) may
  choose any sound strategy — e.g. append-only node versions, per-epoch proof
  snapshots, or compact leaf-set snapshots from which proofs are recomputed — and
  may archive older proof material to cheaper storage, as long as historical proofs
  for anchored roots remain retrievable and verifiable.
- Proof material for intermediate roots that were never anchored need not be kept.

### 3.6 Epoch anchoring and freshness
- An Issuer anchors an epoch by calling `anchorProofPulseEpoch` with
  `(batchRoot = currentRoot, rootSeq = currentRootSeq, expectedPreviousChainRoot)`
  from their authorised wallet. The contract requires `rootSeq >= lastPulseRootSeq`,
  and if equal, the same root (re-affirming an unchanged root), then appends the
  Anchor to the Organisation's PROOF_PULSE attestation chain.
- If nothing changed since the last epoch, the new epoch snapshots the **same**
  root. This is cheap and is how an Organisation re-confirms "still current"
  without touching the tree.
- Freshness: a CONTINUING Credential is `CURRENTLY_ATTESTED` only if an epoch
  proving its leaf ACTIVE was anchored and confirmed within the Organisation's
  `pulseFreshnessDays` (configurable; initial default 45); otherwise
  `STALE_NO_RECENT_ATTESTATION` ([DOMAIN_MODEL.md](DOMAIN_MODEL.md) §6.1). The value
  is supplied to the engine as policy input, not hardcoded.
- A recommended cadence (e.g. monthly) is a reminder to the Issuer, not a rebuild.
  A calendar month changing never rebuilds or recomputes the tree.

### 3.7 Issuer-side root check (recommended)
Before anchoring, the Issuer's browser can verify each root transition cheaply:
given the old root, the changed leaf's old value, new value and sibling path,
recompute both roots. This lets the Issuer confirm that the platform server
changed only the intended leaves, without downloading the whole tree.

---

## 4. Worked example (Aarav / Keshav / Priya)

Tree: Acme's ProofPulse tree (leaves with scope EMPLOYMENT), depth d.
Epoch numbers below are positions in Acme's PROOF_PULSE attestation chain.

**January**
- Aarav (index 0), Keshav (1), Priya (2) inserted as ACTIVE — three path updates.
- Current root = **Root A** (`rootSeq = 3`).
- Issuer anchors Epoch 1 → on-chain snapshot of Root A.

**February**
- No hires, no departures. **No tree work at all.**
- Root A remains current. If the Issuer anchors Epoch 2 (to keep freshness), it
  snapshots Root A again (`rootSeq = 3`). Nothing is rebuilt.

**March**
- Aarav leaves. Issuer signs StatusChangeAttestation
  `{credentialId: Aarav, newStatus: ENDED, statusSeq: 2, effectiveAt: 2026-03-15}`.
- Aarav's credential derives `ENDED` immediately (negative evidence).
- Only leaf 0 and its d ancestors are recomputed → **Root B** (`rootSeq = 4`).
  Keshav's and Priya's leaves are untouched.
- Issuer anchors Epoch 3 → on-chain snapshot of Root B.

**Afterwards**
- Root A remains a historical checkpoint: a proof that Aarav was ACTIVE as of
  Epoch 1/2 is still valid and verifiable from retained proof material.
- Root B is the newer checkpoint and proves Aarav ENDED, Keshav and Priya ACTIVE.
- Aarav's state is ENDED — **not** REVOKED.

---

## 5. Prohibited patterns

- Rebuilding a ProofPulse tree from scratch on a schedule, per month, or as part of
  anchoring.
- Deleting or "zeroing out" an ENDED leaf.
- Recomputing a historical anchored root and overwriting its stored root or proof
  material.
- Discarding the proof material needed to verify proofs against an anchored root.
- Expressing revocation by mutating a sealed CohortProof batch.
- Using `abi.encodePacked` with multiple dynamic fields in leaf preimages.
- Putting names, emails, titles or any personal claim content in leaves unsalted
  or on-chain.
- Separate, divergent Merkle implementations for server, client and contracts.

---

## 6. Test requirements (Phase 7)

- Golden vectors shared between TypeScript and Solidity.
- CohortProof: build/verify for n = 1, 2, 3, odd, large; tampered leaf/proof fails;
  OpenZeppelin `MerkleProof.verify` compatibility.
- ProofPulse: insert/update recompute exactly the leaf and its `depth` path nodes; untouched
  leaves keep their leaf values, and their proofs change only in siblings that lie
  on the updated path; anchoring
  performs zero hashing of the tree; advancing the clock by a month performs no tree
  work; proofs against old anchored roots still verify after later updates (including
  after any archiving step); `statusSeq` rollback rejected; concurrent update on stale
  `rootSeq` rejected.
- Property test: after any sequence of operations, the incremental root equals a
  from-scratch reference build (the reference build exists only in tests).
