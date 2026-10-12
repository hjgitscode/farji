# FARJI Roadmap

Each phase is executed in its own Claude Code session (or sequence of sessions).
Work only on the requested phase. A phase is complete only when its exit criteria
are met, relevant tests and the build pass, and the status table below is updated.

Rules that apply to every phase are in [../CLAUDE.md](../CLAUDE.md).

---

## Status

| Phase | Title | Status |
|---|---|---|
| 0 | Permanent project specification | ✅ Complete (2026-10-02; review corrections applied) |
| 1 | Application foundation | ✅ Complete |
| 2 | Production domain/database schema | ✅ Complete (verified on Supabase) |
| 3 | Authentication and RBAC | ✅ Complete (automated gates pass; live Supabase auth verification passed) |
| 4 | Candidate backend/workflow | ✅ Complete (automated gates and 49/49 DB tests pass; no schema change; signed-in candidate click-through PASSED: dashboard, My records, claim create, v1→v2 edit with v1 preserved, ACTIVE organisation selectable, request submit, history, withdraw with the withdrawn request retained) |
| 5 | Issuer backend/workflow | ⬜ Not started |
| 6 | Cryptography layer | ⬜ Not started |
| 7 | CohortProof + dynamic ProofPulse Merkle engines | ⬜ Not started |
| 8 | Final Solidity contract | ⬜ Not started |
| 9 | Real application-to-blockchain integration | ⬜ Not started |
| 10 | Verification/state engine | ⬜ Not started |
| 11 | Candidate professional UI | ⬜ Not started |
| 12 | Issuer/admin UI | ⬜ Not started |
| 13 | Public profile and verification UX | ⬜ Not started |
| 14 | Cloud/database deployment | ⬜ Not started |
| 15 | Public EVM testnet deployment | ⬜ Not started |
| 16 | Security review and testing | ⬜ Not started |
| 17 | Final polish/documentation/demo preparation | ⬜ Not started |

---

## Phase 0 — Permanent project specification
- **Delivered:** `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN_MODEL.md`,
  `docs/SECURITY_MODEL.md`, `docs/BLOCKCHAIN_MODEL.md`, `docs/MERKLE_MODEL.md`,
  `docs/ROADMAP.md`. No code.

## Phase 1 — Application foundation
- **Goal:** Empty-but-solid single repository/application matching ARCHITECTURE §4.
- **Scope:** One Next.js App Router application (TypeScript strict, Tailwind) — no
  pnpm workspaces, no `apps/`/`packages/`; empty `lib/core`, `lib/crypto`,
  `lib/merkle`, `lib/verification` and `contracts/` locations; Hardhat set up inside
  the same repository; lint, format, typecheck, unit-test runner; `.gitignore`
  covering secrets; `.env.example` with placeholders; CI running
  lint/typecheck/test/build.
- **Out of scope:** Domain models, auth, UI design, contract logic.
- **Exit:** `install`, `lint`, `typecheck`, `test`, `build` succeed from clean checkout.

## Phase 2 — Production domain/database schema
- **Goal:** Prisma schema implementing DOMAIN_MODEL §3 and the workflow statuses of §5.
- **Scope:** The 21-table model in DOMAIN_MODEL §3 (`prisma/schema.prisma`), enums,
  composite organisation-scoping foreign keys, unique constraints and partial indexes,
  CHECK constraints, append-only / write-once / no-delete triggers, RLS enabled with
  no policies, hand-written invariants appended to the initial migration, a lazy
  server-only Prisma client (`lib/database/client.ts`), and database tests that run in
  rolled-back transactions (`npm run test:db`). Application `User` row keyed by an
  internal UUID with a unique Supabase `authUserId`; separate OrganisationMember.
  No seed data.
- **Must not:** add any stored "verified" boolean or verification-state column used
  as truth.
- **Exit:** migration applies on a clean Supabase database; `prisma validate`, schema tests and the database invariant tests pass; lint, typecheck, build pass.
- **Result (COMPLETE):** the initial Prisma migration was applied to the real Supabase PostgreSQL database; 29/29 database invariant tests (`npm run test:db`) passed against it; RLS is enabled on the FARJI application tables with no policies added yet (policies are designed with application access in a later phase). `_prisma_migrations` is Prisma internal metadata, not a FARJI application table.

## Phase 3 — Authentication and RBAC
- **Goal:** Supabase Auth integration and the `ActorContext` authorisation framework.
- **Delivered (see D29–D32):** candidate sign-up, sign-in and sign-out through server
  actions; email-confirmation callback; `proxy.ts` session refresh and optimistic
  redirect; server-side guards (`requireAuthenticatedUser`, `requireCandidate`,
  `requireIssuer`, `requireAdmin`) in every private layout and page; User row
  synchronisation (always CANDIDATE, idempotent, audited); issuer
  OrganisationMember enforcement; open-redirect-safe `next` handling; public/publishable
  Supabase key validation; 58 focused tests (`tests/auth/`).
- **Deliberately not in Phase 3 (deferred, not done):** issuer invitations, admin
  provisioning / role assignment, MFA for Issuer and Admin, step-up re-authentication,
  and audit of role changes. These need the trusted administrative path (Admin UI,
  Phase 12) and are tracked as open decision D33.
- **Exit:** negative tests prove each role cannot reach others' routes (met);
  service-level negative tests are added with each mutating service in Phases 4–5.
- **Live verification (PASSED, against real Supabase Auth + the FARJI database):** real
  signup, login and logout work; a new self-signup creates a Supabase auth user and a
  FARJI `User` row with role CANDIDATE only; the candidate lands on `/candidate` and
  cannot access `/issuer` or `/admin`. For local verification, email confirmation was
  temporarily disabled because Supabase's default SMTP did not deliver the confirmation
  email; this does not change the FARJI role model or RBAC design. A custom SMTP
  provider is needed before enabling email confirmation for production (Phase 14).

## Phase 4 — Candidate backend/workflow
- **Goal:** Candidate-side services.
- **Delivered (see D34–D36):** `server/candidate/claims.ts` services (create claim,
  edit-as-new-version, list/get own claims, list requestable organisations, submit and
  withdraw verification requests); pure draft validation in `lib/core/claims.ts`; thin
  Server Actions in `app/candidate/actions.ts`; minimal functional pages under
  `/candidate/claims`; an AuditEvent in the same transaction for every mutation; 20
  database-backed tests (`tests/db/candidate-workflow.test.ts`) plus 36 unit/structural
  tests. No schema change and no new migration.
- **Not in Phase 4 (deferred):** Profile editing and claim/profile visibility settings
  (the Profile table exists; its CRUD and public-profile logic belong with Phases 11 and
  13), supporting-document upload (D12), claim archiving UI, and the final candidate UI
  (Phase 11).
- **Exit:** met — edit creates a new version and keeps the old one unchanged; the
  candidate cannot create a Credential, ReviewDecision, Attestation or any issuer
  evidence; candidates cannot reach each other's data.

## Phase 5 — Issuer backend/workflow
- **Goal:** Issuer-side services up to the signing boundary.
- **Scope:** Organisation-scoped request queue; review notes and source-of-truth
  reference; approve (creates Credential `AWAITING_SIGNATURE`); reject (status
  transition + append-only ReviewDecision + AuditEvent, **no deletion**, not public);
  self-approval block; end-relationship and revocation *service entry points* that
  require the Phase 6/9 evidence to complete.
- **Must not:** fake signatures, tx hashes or anchoring; create a second PERMANENT
  Credential when a CONTINUING relationship ends.
- **Exit:** cross-Organisation and self-approval negative tests; rejection preserves rows.

## Phase 6 — Cryptography layer
- **Goal:** `lib/crypto` canonicalisation and EIP-712.
- **Scope:** Deterministic normalisation (Unicode NFC, trimming, date format, enum
  casing); `CredentialContent` schemas per category with `schemaId`; salts;
  `subjectCommitment`; `credentialId` derivation; off-chain `chainRoot` computation;
  EIP-712 domain and types (BLOCKCHAIN_MODEL §10); sign/verify helpers; nonce
  generation; server-side signature acceptance in issuance and status-change services.
- **Exit:** golden vectors; tamper tests; cross-chain/contract replay tests.

## Phase 7 — CohortProof + dynamic ProofPulse Merkle engines
- **Goal:** Both engines per MERKLE_MODEL.
- **Scope:** Pure engines in `lib/merkle`; Prisma persistence for batches, leaves,
  the single per-Organisation ProofPulse tree, roots, epochs and historical proof
  material (strategy chosen here — MERKLE_MODEL §3.5); optimistic concurrency on
  `rootSeq`; historical proofs; golden vectors.
- **Must not:** rebuild ProofPulse trees on a schedule, per calendar month or during
  anchoring.
- **Exit:** MERKLE_MODEL §6 tests pass, including incremental == reference property test.

## Phase 8 — Final Solidity contract
- **Goal:** Non-upgradeable `FarjiRegistry` in `contracts/` per BLOCKCHAIN_MODEL.
- **Scope:** Organisation registry, time-aware key history, rotation, compromise,
  CohortProof anchoring, ProofPulse epoch anchoring, independent attestation chains
  per (Organisation, attestation type) with exact `chainRoot` encoding,
  Organisation-bound revocation, events, views; deploy scripts for local node.
- **Exit:** BLOCKCHAIN_MODEL §14 tests pass; static analysis clean or findings documented.

## Phase 9 — Real application-to-blockchain integration
- **Goal:** Real browser wallet → contract → server confirmation loop on a local
  Hardhat node.
- **Scope:** Chain adapter (reads, receipt/log confirmation, confirmation/finality
  policy), ChainTransaction tracking, event sync job, browser-wallet (MetaMask)
  connection for Issuer/Admin, anchoring (with stale-head retry), revocation and
  wallet-governance flows wired end-to-end; integration tests driving real
  local-chain transactions. No relayer; no server-held issuer/admin keys.
- **Must not:** introduce mock blockchain state or claim confirmation before it occurs.
- **Exit:** end-to-end tests (approve → sign → anchor → revoke; insert → end → epoch)
  against a local Hardhat node.

## Phase 10 — Verification/state engine
- **Goal:** `deriveCredentialState` / `deriveClaimState` in `lib/verification` and the
  server-side evidence loader.
- **Scope:** DOMAIN_MODEL §6 exactly (precedence A–E), policy inputs (freshness window
  default 45 days, `maxAnchorDelay`, confirmation/finality policy) never hardcoded,
  check list output, caching with evidence watermark, proof bundle export format.
- **Exit:** table-driven tests for every state and every precedence rule; tamper of
  signed evidence → `INVALID_PROOF`; unsigned/self-declared claims never `INVALID_PROOF`;
  no positive on-chain state before confirmation.

## Phase 11 — Candidate professional UI
- **Goal:** Candidate experience: profile editor, experience/education/certifications,
  version history, requests, sharing.
- **Exit:** accessible, responsive; badges use derived states only; operational
  statuses shown as progress, not verification.

## Phase 12 — Issuer/admin UI
- **Goal:** Issuer dashboard (requests, review, approve/reject, sign, CohortProof,
  ProofPulse, end relationship, revoke, attestation history) and Admin dashboard
  (Organisations, members, wallet authorise/retire/rotate/compromise, key history,
  audit, oversight). All chain actions real, through browser wallets.
- **Exit:** e2e tests of key flows against local chain.

## Phase 13 — Public profile and verification UX
- **Goal:** `/p/[handle]`, `/verify/[credentialRef]`, "View verification details",
  proof bundle download, visibility enforcement, rate limiting. Rejections not shown.
- **Must not:** add Developers/Technology/Novelty/Contract-explorer/educational pages.

## Phase 14 — Cloud/database deployment
- **Goal:** Supabase production DB and Auth, Vercel project, secrets, migrations
  pipeline, Supabase Data API locked down, backups, scheduled sync job.

## Phase 15 — Public EVM testnet deployment
- **Goal:** Deploy non-upgradeable `FarjiRegistry` to Sepolia; grant admin roles to
  the Admin browser wallet(s) (multisig not required for this deployment); verify
  source; configure app; register first Organisations and issuer wallets.

## Phase 16 — Security review and testing
- **Goal:** Full SECURITY_MODEL §13 pass; authorisation matrix tests; contract static
  analysis; dependency and secret scans; findings fixed or documented.

## Phase 17 — Final polish/documentation/demo preparation
- **Goal:** UX polish, user-facing help text (no tutorial/demo pages in the product),
  operator runbooks, final docs, demo data plan using real testnet transactions.

---

## Cross-phase notes

- Phases 4–8 run without chain integration. During that time, Credentials simply
  remain `AWAITING_SIGNATURE` / `SIGNED` / `QUEUED_FOR_ANCHOR` (operational
  statuses); nothing pretends to be anchored or confirmed, and no stored state
  substitutes for the Phase 10 engine.
- Signing appears in the Phase 5 workflow, but signature verification is implemented
  in Phase 6 and wallet interaction in Phase 9; the Phase 12 UI only presents them.
- Any change to the specification must be made explicitly in `docs/` with the user's
  agreement — not implied by code.

---

## Decided

| # | Decision | Outcome |
|---|---|---|
| D1 | Auth provider | **Supabase Auth** for the initial production implementation — Supabase PostgreSQL is already planned, keeping infrastructure simple. |
| D2 | Account roles | **One primary application role per account** for the MVP: CANDIDATE, ISSUER or ADMIN. Organisation membership modelled separately. |
| D3 | Repository structure | **Single repository/application**, no pnpm workspaces. Shared deterministic logic in `lib/core`, `lib/crypto`, `lib/merkle`, `lib/verification`; Solidity in `contracts/`. |
| D4 | Meaning of `VERIFIED` | Positive state for EXPIRING Credentials before expiry (precedence step E). |
| D5 | Edited verified claims | Resolved by the precedence order: the unsigned current version derives `SELF_DECLARED`/`PENDING` (rule A); `MODIFIED` applies only to a Credential superseded by a newer attested version (rule D). |
| D6 | Freshness window | Configurable per Organisation; **initial default 45 days**; passed to the engine as policy. Epoch cadence is an Issuer reminder only; ProofPulse stays event-driven. |
| D8 | Key custody | Browser wallets (e.g. MetaMask) for Issuer/Admin; candidates need none; server never stores issuer/admin keys; **no relayer in the MVP**. |
| D9 | Admin governance | Admin browser wallet for the first Sepolia deployment. **Multisig is future production hardening**, not an MVP requirement. Timelock likewise deferred. |
| D10 | Contract upgradeability | **Non-upgradeable.** |
| D13 | Past employment | **No automatic second PERMANENT Credential** when a CONTINUING relationship ends; the same Credential becomes ENDED and stays historically verifiable. |
| D14 | Public rejections | **Not public by default**; retained internally via append-only ReviewDecision/AuditEvent. |
| D20 | Chained attestations | **Independent chains per (Organisation, attestation type)** — e.g. ORG-XYZ + COHORT and ORG-XYZ + PROOF_PULSE — with `chainRoot = keccak256(batchRoot, previousChainRoot, organisationId, attestationType, epoch)`; exact Solidity encoding in Phase 8. Version lineage via `supersedesCredentialId`. |
| D21 | ProofPulse historical storage | Retain anchored roots and enough evidence to verify historical proofs; no requirement to keep every historical intermediate node in the hot DB; archiving/versioning strategy chosen in Phase 7. |
| D23 | ProofPulse trees per Organisation | **Exactly one ProofPulse tree per Organisation** for the MVP; it may hold many CONTINUING Credentials, with scope/type in each leaf. Each Organisation therefore has one COHORT and one PROOF_PULSE attestation chain. No `treeId`/sharding in the MVP; multiple trees or sharding are a possible later scalability extension, in which case the chain key must include `treeId`. |
| D24 | Canonical entity naming | Claim / ClaimVersion / Credential; **Attestation** = EIP-712 signature evidence; **Anchor** = observed Merkle/chain entry. |
| D25 | Issuer key lifecycle | **No IssuerKeyWindow.** One `IssuerKey` row per wallet authorisation lifecycle (`organisationId`, `walletAddress` globally unique, `validFrom`, `validUntil` nullable, `compromisedAt` nullable, `createdAt`). A retired or compromised wallet is **never re-authorised** in FARJI; rotation creates a new row for a fresh wallet. Historical checks use the key's original validity period. |
| D26 | Three salts | `credentialSalt` (public if revoked), `contentSalt` and `subjectSalt` (private) are distinct per Credential. |
| D27 | Pending-transaction targets | `BlockchainTransaction` carries `targetType` / `targetId` / `targetSequence` (no AnchorIntent table); status PENDING → CONFIRMED → FINALIZED, or FAILED / DROPPED, changed only by server-side chain sync. An Anchor/Revocation row exists only once its transaction is observed (CONFIRMED or FINALIZED). |
| D29 | Authoritative role | `User.role` in the FARJI database decides every authorization. Supabase `user_metadata` / `app_metadata` are never read; only the server-verified Supabase user id (`auth.getUser()`) is used. |
| D30 | Self-signup | Always CANDIDATE. The signup form reads only email and password; no `options.data` is sent to Supabase; `syncAppUser` has no role parameter. ISSUER and ADMIN are obtainable only through a future trusted administrative path. |
| D31 | Route protection layers | `proxy.ts` (Next.js 16) refreshes the session and optimistically redirects anonymous visitors from `/candidate`, `/issuer`, `/admin`; the real boundary is the server-side guard called in every private layout AND page (layouts alone do not gate pages). A test fails if a private page/layout lacks its guard. |
| D32 | Issuer access | Requires `User.role = ISSUER`, an ACTIVE `OrganisationMember`, `organisationId` is derived server-side from that row, never from the request. The organisation itself must also be `ACTIVE`; a SUSPENDED or PENDING_ONBOARDING organisation denies issuer dashboard access (`/access-denied?reason=organisation_inactive`). Suspended/deactivated users are denied everywhere. |
| D34 | Candidate input rules | Lifecycle rules enforced server-side in `validateClaimDraft`: PERMANENT needs an end date (except a never-lapsing CERTIFICATION) and cannot end in the future; CONTINUING has no end date (ending is an organisation act); EXPIRING needs an expiry date after the start and has no end date; start date cannot be in the future; real calendar dates only; a claim's category never changes. |
| D35 | Request targeting | A request targets the claim's LATEST ClaimVersion and an ACTIVE Organisation chosen by validated id; the candidate never supplies a member or issuer key. The claim is linked to that organisation on first request and cannot be sent to a different one. A version that is APPROVED or already has a Credential cannot be requested again. Editing supersedes any open request (DOMAIN_MODEL §7.1). |
| D36 | Candidate visibility of rejections | A candidate sees their own request statuses and rejection reason code; internal reviewer notes and source-of-truth references are never returned. Request statuses are operational labels, not verification states. |
| D28 | Database target and identity keys | Supabase-hosted PostgreSQL via Prisma 7 (driver adapter `pg`). UUID internal keys (v7); `User.authUserId` links Supabase Auth; email is not duplicated; current ClaimVersion = highest `versionNumber`; one Credential per ClaimVersion. |
| D22 | Positive state + anchoring | APPROVED / SIGNED / QUEUED_FOR_ANCHOR are operational; an on-chain positive verification is claimed only after the relevant anchor meets the confirmation/finality policy. |

## Open human decisions

| # | Decision | Needed by | Proposed default |
|---|---|---|---|
| D33 | Trusted issuer/admin provisioning path, MFA for Issuer/Admin, step-up re-authentication, role-change audit (deferred from Phase 3) | Phase 12 (Admin UI) | Admin-only invitation flow using a server-only Supabase admin credential; Supabase MFA |
| D7 | `maxAnchorDelay` (signature-to-anchor bound) | Phase 8 | e.g. 30 days, configurable |
| D11 | Issuer-initiated cohort issuance + claim invitations in v1 scope? | Phase 5 | In scope, mechanism TBD |
| D12 | Supporting document uploads (object storage) in v1? | Phase 4 | Optional |
| D15 | Data retention / erasure (crypto-shredding) policy; applicable law (DPDP, GDPR) | Phase 14 | Crypto-shredding |
| D16 | Organisation onboarding / legitimacy (KYB) process | Phase 12 | Manual Admin review |
| D17 | Exact confirmation/finality policy (`finalized` vs. N confirmations) | Phase 9 | `finalized` |
| D18 | RPC provider | Phase 9 | — |
| D19 | Client-side independent verification on the public page vs. proof bundle only | Phase 13 | Proof bundle; client-side optional |