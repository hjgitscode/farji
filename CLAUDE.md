# CLAUDE.md — FARJI

FARJI is a lifecycle-aware professional credential verification platform.
Candidates build professional profiles; Organisations attest claims after checking
their own records; a public EVM chain preserves tamper-evident evidence of what an
authorised issuer attested and when; verification states are derived from evidence.

This file and `docs/` are the permanent specification. Every Claude Code session
must follow them.

---

## Before you write any code

Read, in this order:
1. This file.
2. [docs/ROADMAP.md](docs/ROADMAP.md) — find the requested phase, its scope, exit
   criteria and the open decisions it depends on.
3. [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) — canonical terminology and state rules.
4. The documents relevant to the phase:
   - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, layering, flows, stack
   - [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) — authorisation, threats, audit
   - [docs/BLOCKCHAIN_MODEL.md](docs/BLOCKCHAIN_MODEL.md) — `FarjiRegistry`, keys, anchoring, revocation, EIP-712
   - [docs/MERKLE_MODEL.md](docs/MERKLE_MODEL.md) — CohortProof and ProofPulse

If an open decision in ROADMAP blocks the phase, ask the user instead of choosing silently.

---

## Rules for every phase

1. Read CLAUDE.md and the relevant docs before coding.
2. Work on ONLY the requested phase.
3. Do not redesign unrelated architecture.
4. Do not weaken security checks to make tests pass.
5. Do not introduce mock blockchain state once real blockchain integration exists
   (Phase 9 onward). Never fabricate transaction hashes, block numbers or
   "anchored" flags in any phase.
6. Preserve historical credential, issuer-key and attestation evidence. Never delete
   or rewrite append-only records (DOMAIN_MODEL §9).
7. Never confuse ENDED with REVOKED.
8. Never treat blockchain as the authority for real-world truth.
9. Never rebuild the entire ProofPulse tree merely because a month changed.
10. Prefer small, testable services with clear responsibilities.
11. Run relevant tests and the build before declaring a phase complete.
12. Summarise exactly which files were changed.
13. Stop when the requested phase is complete.

---

## Non-negotiable invariants

- Verification state is **derived** (DOMAIN_MODEL §6). No `isVerified`-style
  boolean or stored state may act as truth.
- Precedence: not yet issuer-signed → SELF_DECLARED/PENDING; explicitly revoked →
  REVOKED; unauthorised signer or failed cryptography → INVALID_PROOF; superseded →
  MODIFIED; otherwise by lifecycle. Unsigned claims are never INVALID_PROOF.
- Operational statuses (APPROVED, AWAITING_SIGNATURE, SIGNED, QUEUED_FOR_ANCHOR,
  ANCHORED) are not verification states. No on-chain positive state is claimed
  before the anchor meets the confirmation/finality policy.
- Revocation overrides every positive state.
- An issuer wallet must have been authorised **for the issuing Organisation at the
  exact issuance timestamp**, per on-chain key history.
- Editing a claim creates a new ClaimVersion; old versions remain.
- Rejection is a status transition plus an append-only ReviewDecision — it never
  deletes the claim, version or request, and is not shown on public profiles.
- Ending a CONTINUING relationship makes the same Credential ENDED; never create a
  second PERMANENT Credential for it.
- Only the issuing Organisation can revoke its Credential (`credentialId` embeds
  `orgId`). Never write a revoke function that only checks "caller is some issuer".
- Admins govern Organisations and wallets; they never issue, end or revoke credentials.
- Candidates never need a wallet. No candidate personal data on-chain.
- Issuer/Admin chain actions use their own browser wallets (e.g. MetaMask). The
  server never stores issuer/admin private keys. No relayer in the MVP.
- `FarjiRegistry` is non-upgradeable. Anchors form independent attestation chains
  per (Organisation, attestation type) — never one global chain per Organisation.
- Authorisation is enforced server-side in services via `ActorContext`; UI hiding
  is not security. Organisation scope comes from the actor's membership, never
  from request input.
- ProofPulse updates only the affected leaf/path on a state change; anchoring an
  epoch snapshots the current root and never rebuilds. The freshness window is
  configurable policy (default 45 days), never hardcoded in the engine.
- Cryptographic primitives (Keccak-256, secp256k1 ECDSA, EIP-712, Merkle trees) are
  standard. Never describe them as novel.
- Secrets, private keys, mnemonics and `.env` files are never committed.

## Excluded from the public product

Developers page, Technology explainer, Novelty page, Contract explorer, educational
ProofPulse or CohortProof pages, and any review/demo/tutorial-only UI or wording.
These concepts may exist only in `docs/`.

## Known FARJI2 prototype weaknesses (never repeat)

- Any authorised issuer of any Organisation could revoke arbitrary credentials.
- Rejecting a request deleted the credential row.
- Verification stored as a boolean.
- Simulated blockchain interactions and educational/demo pages in the product.

---

## Conventions

- Terminology exactly as in DOMAIN_MODEL §1 (Candidate, Issuer, Admin, Organisation,
  Claim, ClaimVersion, VerificationRequest, ReviewDecision, Credential, Attestation,
  CohortProof, ProofPulse, Anchor, attestation chain, attestation type, Revocation,
  issuer wallet, issuer key history).
- British spelling for domain terms in docs and code identifiers: Organisation,
  authorise/authorised, enrolment, licence.
- Enum values `SCREAMING_SNAKE_CASE`, spelled exactly as in the docs.
- Single repository and application (no monorepo/workspaces). Shared deterministic
  logic lives in `lib/core`, `lib/crypto`, `lib/merkle`, `lib/verification` with no
  I/O; time and business policy are passed in, never read or hardcoded inside.
  Solidity lives in `contracts/`.
- Authentication is Supabase Auth; one primary application role per account, stored
  in the application `User` table; Organisation membership is separate.
- Every important mutation writes an AuditEvent in the same transaction.
- Every mutating service gets negative authorisation tests.

## Changing the specification

If implementation reveals a flaw in `docs/`, stop and raise it with the user. Update
the docs only with their agreement, in the same change, and keep terminology
consistent across all documents.

## Completing a phase

1. Exit criteria in ROADMAP met.
2. Relevant tests, lint, typecheck and build pass (report failures honestly).
3. Update the phase row in the ROADMAP status table.
4. Report: files changed (exact list), what was done, what was not, open issues.
5. Stop.

## Current status

Phase 0 (specification) complete. Next: Phase 1 — application foundation.
