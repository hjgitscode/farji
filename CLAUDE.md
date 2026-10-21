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
  in the application `User` table (internal UUID id + unique `authUserId`);
  Organisation membership is separate.
- Auth (Phase 3): Supabase Auth is identity only. `User.role` in the FARJI database is
  the sole authority; never read `user_metadata`/`app_metadata` for decisions. Self-signup
  is always CANDIDATE. Call `requireCandidate/requireIssuer/requireAdmin` (lib/auth/guards)
  in EVERY private layout, page and (later) server action — layouts alone do not gate
  pages. Issuer organisation comes from the ACTIVE OrganisationMember row (and the
  Organisation itself must be ACTIVE), never from input. Validate any `next`/redirect target with `safeInternalPath`. Web app uses only
  the Supabase publishable key; never a service-role key.
- Candidate services (Phase 4): live in `server/candidate/`, take the guard's `Actor`,
  assert CANDIDATE first, own everything via `actor.userId` only, and write an
  AuditEvent in the same transaction. Pure claim validation is `lib/core/claims.ts`.
  Edits insert ClaimVersion N+1 (never mutate); candidate code never creates Credentials,
  decisions or attestations.
- Issuer services (Phase 5): live in `server/issuer/`, take the guard's `Actor`, assert ISSUER
  with organisation, member and ACTIVE organisation first (re-checked inside the transaction),
  scope every query by `actor.organisationId`, and write an AuditEvent in the same transaction.
  The first write of approve/reject is the conditional open → terminal status update. Approve
  creates exactly one `AWAITING_SIGNATURE` Credential and nothing cryptographic; issuer code
  never creates Attestations, Anchors, transactions or Merkle leaves. Notes and
  source-of-truth references are never returned to candidates.
- Crypto and Merkle (Phases 6–7): hashing, EIP-712 and Merkle code is pure (`lib/crypto`,
  `lib/merkle`: no I/O, clock or randomness); salts and nonces come from `server/issuance/random.ts`.
  **The server never holds, generates or uses a private key** — it builds typed data from database
  rows and recovers signers; test wallets exist only in `tests/fixtures/` (a structural test
  enforces this). JSON is never hashed (canonical fields → EIP-712 `hashStruct`). `Credential.validFrom`
  is the *effective start date of the underlying professional claim*; `Credential.issuedAt` is the
  *actual cryptographic signature timestamp* — never conflate them. ENDED is a ProofPulse status
  change, never a Revocation. ProofPulse updates only a leaf's path (O(depth)); sealed cohort
  batches and the `ProofPulseUpdate` log are immutable. EIP-712 domain config
  (`FARJI_CHAIN_ID`, `FARJI_REGISTRY_ADDRESS`) has no default.
- Chain (Phases 8–9): the browser wallet supplies ONLY the account, a signature and a tx hash; every
  other value (organisation, credential, salts, digests, roots, leaf count, sequence numbers, calldata)
  is built by the server from the database (`server/chain/actions.ts` is the single resolver for both
  BUILD and RECORD). The server never signs, sends a transaction or holds a key. A reported hash is
  re-fetched from the server's own RPC and its calldata must equal the resolver's. Positive FARJI
  evidence (IssuerKey, Anchor, Revocation, Organisation status, Credential ANCHORED) is written only by
  `server/chain/mirror.ts`, inside the transaction that moves a BlockchainTransaction to FINALIZED;
  transaction status changes only in `server/chain/sync.ts`. D46: an IssuerKey has authority only via a
  FINALIZED authorisation transaction plus the chain's own answer. `credentialId` is derived from the
  caller's `orgId` on-chain (no revoke-by-id). Local `FARJI_FINALITY`: `depth:0` dev, `depth:2` tests;
  Sepolia: `finalized`. Env var names must not contain `SECRET`/`SERVICE_ROLE` (use `*_TOKEN`).
- Verification state (Phase 10): the state is **derived, never stored** - `lib/verification` (pure; no I/O, clock,
  randomness or database) returns it as a function of RAW evidence + policy + `now` and recomputes every hash,
  signature, Merkle fold and chain-root link itself; `server/verification` only reads (a structural test forbids
  writes). Precedence is fixed: A unsigned -> PENDING/SELF_DECLARED, B finalized revocation -> REVOKED, C any
  cryptographic/evidence failure -> INVALID_PROOF, D verified successor -> MODIFIED, E lifecycle. Only FINALIZED
  chain evidence is positive; evidence of another Organisation never verifies; compromise is judged at ANCHOR time
  (`wasKeyValidForEvidence`); D7 window (30 days, inclusive) applies to the first qualifying anchor; freshness uses
  the Organisation's own `pulseFreshnessDays`. Results never contain salts, claim content, signatures, notes or
  audit data. Pages show the derived state, never `pipelineStatus`.
- Product layer (Phases 11-13): the UI shows ONLY derived states, in plain language (`lib/verification/present.ts`); technical evidence is
  behind "View verification details". Imported profile data (pasted text / CSV, `lib/import` + `server/candidate/import.ts`) is **not
  verification**: it is previewed, confirmed per record and created as PRIVATE SELF_DECLARED claims through `createClaim`, never as a
  Credential/Attestation/Anchor/Organisation; FARJI has no LinkedIn API access and does not scrape. Visibility uses the existing schema
  (`Profile.visibility`, `Claim.visibility`; default PRIVATE; handle = public identity). Public pages (`/p/[handle]`, `/verify/...`) read no
  session, list nothing, answer private/unknown/malformed identically, and use the Phase 10 engine; the proof bundle excludes salts, nonce,
  content and candidate identity. Every private page calls its role guard; areas do not import each other's actions.
- Deployment (Phases 14-15): `docs/DEPLOYMENT.md` is the operator guide; `config/production-env.ts` (`npm run env:check`) validates the environment by NAME only; no private key,
  mnemonic or service-role credential may exist in the environment, repository or browser bundle (tests scan for all three). Sepolia is the only public network (mainnet is refused),
  `FARJI_FINALITY` must be `finalized` there, and `server/chain/ready.ts` proves the RPC chain id and registry code before any chain read/write. `/api/chain/sync` is token-protected,
  idempotent and returns no detail. Rate limiting is per instance only and is documented as such. The Sepolia deployer is a throw-away wallet in an encrypted local keystore
  (`npm run chain:keystore`, `npm run chain:deploy:sepolia`, `npm run chain:check`); the deployer keeps no contract authority. A deployed address, an RPC URL or a live wallet result is
  never invented: if it was not produced by a real run it is reported as NOT DONE.
- Issuer wallets: one `IssuerKey` row per wallet; a retired or compromised wallet is
  never re-authorised (rotation = new row, fresh wallet). No IssuerKeyWindow.
- Each Credential has three distinct salts (`credentialSalt`, `contentSalt`,
  `subjectSalt`); only `credentialSalt` may ever become public.
- Database: Prisma 7 + Supabase PostgreSQL. History tables are append-only via
  triggers; never add cascade deletes, stored verification state or a verified flag.
  Chain status of a transaction changes only through server-side chain sync.
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

Phases 0 (specification), 1 (application foundation) and 2 (production domain/database schema) are COMPLETE. Phase 2 was verified against the real Supabase PostgreSQL database: the initial Prisma migration applied successfully, 29/29 database invariant tests passed, and RLS is enabled on all FARJI application tables with no policies added yet (`_prisma_migrations` is Prisma internal metadata, not a FARJI table). Phase 3 (Supabase Auth + RBAC) is COMPLETE: candidate sign-up/sign-in/sign-out, `proxy.ts`, server-side guards, issuer enforcement (ACTIVE OrganisationMember of an ACTIVE Organisation), 61 auth tests; lint, typecheck, 70 tests, build and db:validate pass. Live Supabase auth verification PASSED: real signup, login and logout work; self-signup creates a Supabase auth user and a FARJI User row with role CANDIDATE only; the candidate lands on /candidate and cannot access /issuer or /admin. (Email confirmation was temporarily disabled for local verification because Supabase's default SMTP did not deliver mail; this does not change the role model or RBAC.) Deferred to ROADMAP D33: issuer/admin provisioning path, MFA, step-up re-auth. Phase 4 (candidate backend/workflow) is COMPLETE: claim create/edit-as-new-version/list/get, verification request submit/withdraw, supersession on edit, minimal /candidate/claims pages, no schema change; lint, typecheck, 106 unit tests, build, db:validate and 49/49 database tests (20 new) pass. Signed-in Phase 4 candidate click-through PASSED (dashboard, My records, claim create, edit to Version 2 with Version 1 preserved, ACTIVE organisation selectable, request submit, request history, withdraw with the withdrawn request retained). Phase 5 (issuer review + credential issuance workflow) automated verification is COMPLETE: `server/issuer/review.ts`, `lib/core/review.ts`, `app/issuer/*` minimal pages and actions; approve creates one AWAITING_SIGNATURE Credential with no cryptographic material, reject retains everything; no schema change; lint, typecheck, 140 unit tests, build, db:validate and 78/78 database tests pass. The signed-in issuer browser smoke test is DEFERRED, not failed and not passed: the development account that owns the test claim was provisioned as the issuer, and FARJI correctly prohibits self-review, so the live click-through needs a separate candidate account. Phases 6 and 7 (cryptographic issuance; CohortProof and ProofPulse) are COMPLETE at the automated level (no browser wallet exists until Phase 9, so verification is by unit, golden-vector and rollback-only database tests with test wallets): `lib/crypto`, `lib/merkle`, `server/issuance`, `server/merkle`; prepare/accept signing, ENDED status changes, OPEN/SEALED cohort batches, one incremental ProofPulse tree per Organisation, historical proofs by update-log replay; no schema change; `ethers@6` and `@openzeppelin/merkle-tree@1.0.8` added; decisions D39–D46; lint, typecheck, 295 unit tests (+1 skipped vector generator), 163/163 database tests, build and db:validate pass. Phases 8 and 9 (final `FarjiRegistry` contract; real application ↔ blockchain integration) are COMPLETE at the automated level: `contracts/FarjiRegistry.sol` (non-upgradeable; 56 Hardhat tests incl. Solidity ↔ TypeScript golden vectors), Hardhat 2.26.5 (CommonJS; root package stays CommonJS), `lib/blockchain`, `server/chain/*` (server-built transactions, reported-hash verification, `PENDING → CONFIRMED → FINALIZED | FAILED | DROPPED` state machine with `txNonce` replacement detection and reorg handling, finalised-evidence mirror), wallet proof of possession, D46 enforced, minimal admin/issuer wallet pages, additive migration `20261019120000_chain_tx_nonce`; decisions D47–D52. Verified by unit tests, rollback-only DB tests and a real local Hardhat-node suite (`npm run test:chain`); there has been NO live MetaMask click-through and NO public-testnet deployment (Phase 15). Slither was not run (Phase 16). Phase 10 (verification/state engine) is COMPLETE at the automated level: pure `lib/verification` (precedence A–E, 11 derived states, reasons + full check list) over raw evidence, read-only `server/verification` loader/service, derived state shown on the candidate record pages; no schema change; nothing about verification is stored; decisions D53–D59; 420 unit tests (+1 skipped vector generator), 247 rollback-only DB tests, 16 real-local-chain tests and 56 contract tests pass, plus lint, typecheck, build and db:validate. Not done: evidence-watermarked caching and the proof-bundle export (Phase 13), a live chain re-read on the public path (Phase 13), and any live MetaMask / testnet verification. Phases 11, 12 and 13 (candidate experience; issuer/admin experience; public profile, verifier, sharing and evidence export) are COMPLETE at the automated level: shared UI kit and plain-language state presentation; candidate dashboard (counts of real derived states), records by category, detail with version/request history, visibility controls, the "earlier version verified" note, profile and sharing (link + QR); professional-profile import from pasted text or CSV (previewed, confirmed, created as PRIVATE SELF_DECLARED claims through `createClaim`; no LinkedIn API, no scraping, never verification); restyled issuer pages (pipeline dashboard, requests, signing, batches, current relationships, revocation/end confirmations, history) and admin pages (organisations, members, wallets, transactions); public `/p/[handle]`, `/verify`, `/verify/[credentialRef]` and a public JSON proof bundle, all using the Phase 10 engine; no schema change (existing `Profile.visibility`, `Claim.visibility`, `Profile.handle`); new dependency `qrcode@1.5.4`; decisions D60–D66; 481 unit tests (+1 skipped), 267 rollback-only DB tests, 16 real-local-chain tests and 56 contract tests pass, plus lint, typecheck, build and db:validate. Not done: rate limiting and Vercel/Supabase deployment (Phase 14), a signed-in browser or live MetaMask click-through, evidence-watermarked caching (verification is recomputed, never stale). Phases 14 and 15 (cloud wiring; Sepolia deployment) are PREPARED, not finished: deployment configuration, validation, rate limiting, sync wiring, public-origin handling, secure cookies, error handling, the Sepolia deploy/check scripts and the full operator guide are built and tested (542 unit, 22 real-local-node chain tests, plus the existing suites), with no schema change. NOT done because external input was unavailable: the Vercel project and its environment, Supabase dashboard settings (Site/Redirect URLs, custom SMTP), a Sepolia RPC URL, a funded deployer wallet, the Sepolia deployment itself (no deployed address exists), the live MetaMask smoke test, a real signed/anchored/finalized credential on Sepolia. Next: complete those manual steps from docs/DEPLOYMENT.md, then Phase 16 — security review and testing (not started).
