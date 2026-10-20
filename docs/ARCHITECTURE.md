# FARJI Architecture

FARJI is a lifecycle-aware professional credential verification platform.
Candidates build a professional profile; Organisations attest claims after checking
their own records; a public EVM chain preserves tamper-evident evidence of what an
authorised issuer attested and when; anyone can view a profile and see a derived,
honest verification state for each claim.

Companion documents:
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — terminology, entities, lifecycle, verification states (canonical)
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — threats, authorisation, audit
- [BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md) — `FarjiRegistry`, key history, attestation chains, revocation, EIP-712
- [MERKLE_MODEL.md](MERKLE_MODEL.md) — CohortProof and ProofPulse
- [ROADMAP.md](ROADMAP.md) — phases and decisions

---

## 1. Authority model

| Question | Authority |
|---|---|
| Did this person really work/study/hold a licence here? | The **Organisation**, checking its own source-of-truth records |
| What exactly did the Candidate claim, and in which version? | FARJI database (append-only ClaimVersions) |
| Which wallet could speak for an Organisation at time T? | **Chain** (issuer key history) |
| What did an authorised issuer attest, and when? | Issuer EIP-712 signature + **chain** anchor timestamp |
| Was a Credential revoked? | **Chain** (revocation registry) |
| What verification state should be shown now? | **Derived** by the verification state engine from all of the above; never stored as truth |

The blockchain is never the authority for real-world truth.

---

## 2. Product surfaces

### 2.1 Public (unauthenticated)
| Route (planned) | Purpose |
|---|---|
| `/` | Product landing page (plain product messaging; no technology/novelty explainer) |
| `/p/[handle]` | Public professional profile |
| `/verify/[credentialRef]` | Credential verification page with "View verification details" |
| `/sign-in`, `/sign-up` | Authentication (Supabase Auth) |

### 2.2 Candidate (`/candidate/...`)
Profile editing (name, headline, about), experience, education, certifications,
memberships; claim version history; verification requests and their status
(including the Candidate's own rejection reasons, privately); sharing/visibility;
proof bundle export.

### 2.3 Issuer (`/issuer/...`)
Incoming verification requests; source-of-truth review workflow; approve / reject;
sign (wallet); CohortProof batches; the Organisation's ProofPulse tree and epochs;
end continuing relationship; revoke credential; attestation history.

### 2.4 Admin (`/admin/...`)
Organisations; Organisation members; issuer wallet authorisation, retirement,
rotation, compromise marking; issuer key history; audit history; platform oversight.

### 2.5 Explicitly excluded from the public product
Developers page, Technology explainer, Novelty page, Contract explorer, educational
ProofPulse page, educational CohortProof page, any review/demo/tutorial-only UI or
language. These concepts live only in `docs/`.

### 2.6 UX direction
Professional career platform with an information hierarchy inspired by LinkedIn
(name → headline → about → experience → education → certifications, with
verification badges), but with its own visual identity — not a clone. Cryptographic
detail is hidden behind "View verification details". Rejections are never shown on
public profiles by default.

---

## 3. System components

```
                  ┌──────────────────────── Browser ────────────────────────┐
                  │  Public / Candidate UI        Issuer & Admin UI         │
                  │  (no wallet)                  + browser wallet, e.g.     │
                  │                                 MetaMask (ethers)        │
                  └───────────────┬───────────────────────────┬─────────────┘
                                  │ HTTPS (Server Actions /    │ signed txs / EIP-712
                                  │ Route Handlers)            │ signatures (direct,
                                  │                            │ no relayer)
┌─────────────────────────────────▼───────────────────────────┐│
│ Single Next.js (App Router) application on Vercel           ││
│  ┌───────────────┐  ┌────────────────────────────────────┐  ││
│  │ Supabase Auth │  │ Application services (per use case)│  ││
│  │ + RBAC        │─►│ claims · requests · review ·       │  ││
│  │ ActorContext  │  │ issuance · cohort · pulse ·        │  ││
│  └───────────────┘  │ revocation · orgs · wallets ·      │  ││
│                     │ verification · audit               │  ││
│                     └───────┬───────────────┬────────────┘  ││
│                             │               │               ││
│        ┌────────────────────▼──┐   ┌────────▼────────────┐  ││
│        │ lib/ (pure, no I/O)   │   │ Chain adapter       │  ││
│        │ core · crypto ·       │   │ (ethers, read-only  │◄─┘│
│        │ merkle · verification │   │ RPC, tx confirmation│   │
│        └───────────────────────┘   │ event sync)         │   │
│        ┌───────────────────────┐   └────────┬────────────┘   │
│        │ Prisma repositories   │            │                │
│        └──────────┬────────────┘            │                │
└───────────────────┼─────────────────────────┼────────────────┘
                    ▼                         ▼
          PostgreSQL (Supabase)       EVM chain (Hardhat local → Sepolia)
          workflow + off-chain        FarjiRegistry (non-upgradeable)
          evidence + audit
```

---

## 4. Repository layout (planned; created from Phase 1)

**Decided (ROADMAP D3):** a single repository and a single application — no pnpm
workspaces, no `apps/` or `packages/` split — to avoid unnecessary monorepo
complexity for a single full-stack project.

```
/
├─ CLAUDE.md
├─ docs/                  permanent specification
├─ app/                   Next.js App Router routes: (public), candidate/, issuer/, admin/
├─ components/            UI components
├─ server/                application services, authorisation (ActorContext),
│                         Prisma repositories, chain adapter, evidence loader
├─ lib/                   shared deterministic logic — pure TypeScript, no I/O
│  ├─ core/               domain types, enums, constants, shared helpers
│  ├─ crypto/             canonicalisation, salts/commitments, credentialId,
│  │                      EIP-712 domain/types, sign/verify helpers, chainRoot
│  ├─ merkle/             CohortProof and ProofPulse engines, golden vectors
│  └─ verification/       deriveCredentialState / deriveClaimState
├─ prisma/                schema and migrations
└─ contracts/             Solidity: FarjiRegistry.sol, Hardhat tests, deploy scripts
```

Exact placement of the Hardhat configuration (repository root or `contracts/`) and
whether routes live under `src/` are Phase 1 details, provided the single-repository
decision and the `lib/*` responsibilities above are preserved.

---

## 5. Layering rules

1. **UI** (React Server/Client Components) — renders; never decides authorisation.
2. **Entry points** (Server Actions, Route Handlers) — parse/validate input, build
   `ActorContext` from the Supabase Auth session, call one application service.
3. **Application services (`server/`)** — enforce authorisation, state machines,
   transactions, audit. Small, single-responsibility, unit-testable.
4. **Shared deterministic logic (`lib/`)** — pure functions: no DB, no network, no
   clock (time passed in as `now`), no hardcoded business policy (e.g. freshness
   window passed in). Same code runs on the server, in the browser and in contract
   tests.
5. **Infrastructure adapters (`server/`)** — Prisma repositories, chain adapter,
   storage, email. Behind interfaces so services are testable.

Dependencies point downward only. `lib/` never imports from `server/`, `app/` or
`components/`.

---

## 6. Key flows

### 6.1 Candidate-initiated verification (PERMANENT / EXPIRING)
1. Candidate creates Claim → ClaimVersion v1 → `SELF_DECLARED`.
2. Candidate submits VerificationRequest to a registered Organisation → `PENDING`.
3. Issuer reviews against the Organisation's source of truth → ReviewDecision.
   - REJECT: request REJECTED, ReviewDecision + AuditEvent retained internally,
     Claim untouched, public state `SELF_DECLARED` (rejection not shown publicly).
   - APPROVE: Credential created (pipeline `AWAITING_SIGNATURE`; state `PENDING`).
4. Issuer signs CredentialAttestation in their browser wallet → server verifies
   signature and on-chain authorisation → pipeline `SIGNED` (state still `PENDING`).
5. Credential leaf added to the Organisation's OPEN CohortProof batch → pipeline
   `QUEUED_FOR_ANCHOR` (state still `PENDING`).
6. Issuer seals the batch and anchors it to the Organisation's COHORT attestation
   chain from their wallet → server confirms the tx → anchor meets the
   confirmation/finality policy → pipeline `ANCHORED` → state `PERMANENT_VALID` /
   `VERIFIED`.

### 6.2 Issuer-initiated cohort (CohortProof)
Issuer creates Credentials from Organisation records for a cohort, signs, seals and
anchors one root to the COHORT chain; graduates claim their Credentials via
invitation (scope open — ROADMAP D11).

### 6.3 Continuing relationship (ProofPulse)
Steps 1–4 as 6.1 with lifecycle `CONTINUING` → leaf inserted into the Organisation's
ProofPulse tree (path-only update, new root) → Issuer anchors an epoch to the
PROOF_PULSE chain (snapshot of the current root) → confirmed → `CURRENTLY_ATTESTED`.
Epochs within the freshness window (configurable, default 45 days) keep it fresh;
otherwise `STALE_NO_RECENT_ATTESTATION`. No tree work happens because time passes.

### 6.4 Ending a relationship
Issuer signs StatusChangeAttestation (ENDED, next `statusSeq`) → server verifies →
leaf updated (path-only) → new root → state `ENDED` immediately → next epoch anchors
it. No second PERMANENT Credential is created.

### 6.5 Revocation
Issuer calls `revokeCredential(orgId, credentialSalt, reasonCode)` from their wallet →
server confirms → mirror updated → state `REVOKED`.

### 6.6 Public verification
Viewer opens `/verify/[credentialRef]` → server evidence loader gathers DB rows,
chain reads and Organisation policy → `deriveCredentialState` in `lib/verification`
→ state + check list rendered; proof bundle downloadable for independent
verification.

### 6.7 Wallet governance (Admin)
Admin authorises / retires / rotates / marks compromised via `FarjiRegistry` from the
Admin's browser wallet → events synced → key history visible in Admin and Issuer UIs.

---

## 7. Data stores

| Store | Holds | Notes |
|---|---|---|
| PostgreSQL (Supabase, managed) | Users, profiles, claims & versions, requests, decisions, credentials, attestations, Merkle state and historical proof material, chain mirrors, audit | Accessed only server-side via Prisma; Supabase Data API disabled or RLS deny-all |
| Archive storage (optional, later) | Older ProofPulse historical proof material | Allowed by MERKLE_MODEL §3.5 as long as historical proofs stay verifiable |
| EVM chain | Organisations, key history, attestation chains (anchors), revocations | Commitments and metadata only |
| Object storage (optional) | Supporting documents for requests | Private; scope open |

---

## 8. Chain integration

- ethers.js v6 everywhere (server reads, browser wallet writes).
- Writes come directly from the Issuer's/Admin's own browser wallet (e.g. MetaMask).
  **No relayer in the MVP.** The server never stores or uses issuer/admin private
  keys and never signs on their behalf. Candidates need no wallet.
- Server confirms every transaction by reading the receipt/logs from its own RPC.
- On-chain positive verification states are claimed only after the anchor meets the
  confirmation/finality policy (default `finalized`). Operational pipeline statuses
  never stand in for confirmation.
- Anchors form independent attestation chains per (Organisation, attestation type);
  CohortProof and ProofPulse anchoring never block each other.
- Event sync runs as scheduled polling (Vercel Cron or equivalent), idempotent by
  (block, logIndex).
- Local development and CI use a local Hardhat node; Sepolia from Phase 15.
- **As built (Phase 9):** `lib/blockchain` (ABI + calldata/log codecs), `server/chain` (config, read-only
  RPC and chain reader, action resolver, build/record, sync state machine, finalised-evidence mirror,
  queries), `server/issuance/wallet-binding.ts`, minimal wallet UI under `/admin/*` and `/issuer/*`
  (`components/wallet`), `POST /api/chain/sync`. Hardhat 2.26 (CommonJS) lives beside the app
  (`hardhat.config.ts`, `contracts/`, `scripts/`).
- No mock chain state once Phase 9 exists.

---

## 9. Verification state engine

- Lives in `lib/verification/` as pure functions `deriveCredentialState` and
  `deriveClaimState` ([DOMAIN_MODEL.md](DOMAIN_MODEL.md) §6), using `lib/crypto` and
  `lib/merkle` for checks.
- A server-side evidence loader gathers inputs (DB rows, chain reads, current time,
  Organisation policy such as `pulseFreshnessDays`) and passes them in.
- Output is a primary state plus the full list of checks, used by "View verification
  details" and by the proof bundle.
- **As built (Phase 10).** `lib/verification` = `types`, `evidence` (signature, anchor-chain, window and
  key-at-anchor primitives), `permanent` (CohortProof path shared with EXPIRING), `expiring`, `continuing`
  (ProofPulse path: log replay, freshness, ENDED), `precedence` (A–E in fixed order), `derive` (public API) and
  `labels` (display text). `server/verification/load.ts` maps database rows to the engine's raw-evidence input
  (read-only; per-call cache of anchors and update logs); `server/verification/service.ts` supplies policy
  (`maxAnchorDelay` 30 days, the Organisation's `pulseFreshnessDays`, the configured EIP-712 domain) and exposes
  `deriveStateForCredential` and `deriveCandidateClaimStates` (own claims only). The candidate record pages
  show the derived state; the state is recomputed on each request and never stored. Decisions D53–D59.

---

## 10. Technology stack

| Concern | Choice |
|---|---|
| Web framework | Next.js App Router, TypeScript (strict), single application |
| Styling | Tailwind CSS |
| Database | PostgreSQL (Supabase managed) + Prisma ORM |
| Auth | **Supabase Auth** (decided) + application RBAC; one primary role per account |
| Chain client | ethers.js v6 |
| Wallets | Browser wallets (e.g. MetaMask) for Issuers and Admins only |
| Contracts | Solidity 0.8.x, OpenZeppelin, Hardhat; non-upgradeable |
| Network | Local Hardhat → Sepolia |
| Hosting | Vercel |
| Tests | Unit/integration (e.g. Vitest), Hardhat tests, end-to-end (e.g. Playwright) |

---

## 11. Environments

| Env | DB | Chain | Purpose |
|---|---|---|---|
| Local | Local Postgres (or Supabase dev project) | Local Hardhat node | Development, CI |
| Preview | Supabase preview/staging | Sepolia (staging deployment) | PR previews |
| Production | Supabase production | Sepolia (until a mainnet/L2 decision) | Public product |

Sepolia is a testnet: the UI must not imply mainnet-grade permanence.

---

## 12. Non-goals

- Proving real-world truth on-chain.
- Candidate wallets, tokens, NFTs or any on-chain candidate identity.
- Novel cryptography.
- Educational, demo or explorer pages in the public product.
- Rebuilding Merkle trees on a calendar.
- Relayers, multisig governance and monorepo tooling in the MVP.

---

## 13. Architectural decisions (summary)

| ID | Decision |
|---|---|
| AD-01 | Verification state is derived from evidence; no stored verified boolean. |
| AD-02 | Chain is authoritative only for key history, anchors and revocations. |
| AD-03 | `credentialId` embeds `orgId` so only the issuing Organisation can revoke. |
| AD-04 | Issuer key history is append-only and time-aware; authorisation checked at `issuedAt` and bounded by anchor time. |
| AD-05 | CohortProof (static) for PERMANENT/EXPIRING; ProofPulse (incremental, event-driven) for CONTINUING. |
| AD-06 | ProofPulse epoch anchoring snapshots the current root; never rebuilds. |
| AD-07 | Negative evidence (ENDED) is effective on valid signature; on-chain positive states require anchors meeting the confirmation/finality policy. |
| AD-08 | Editing creates a new ClaimVersion; rejection is a status transition with retained internal history; nothing is deleted. |
| AD-09 | Server holds no issuer/admin keys; Issuers and Admins act through their own browser wallets; no relayer in the MVP. |
| AD-10 | Single repository and application; shared deterministic logic in `lib/core`, `lib/crypto`, `lib/merkle`, `lib/verification`; Solidity in `contracts/`. |
| AD-11 | Independent attestation chains per (Organisation, attestation type): `chainRoot = keccak256(batchRoot, previousChainRoot, organisationId, attestationType, epoch)`. |
| AD-12 | `FarjiRegistry` is non-upgradeable. |
| AD-13 | Supabase Auth; one primary application role per account; Organisation membership modelled separately. |
| AD-14 | Verification precedence: not signed → SELF_DECLARED/PENDING; REVOKED; INVALID_PROOF; MODIFIED; lifecycle. |
| AD-15 | Freshness window is configurable policy (initial default 45 days), not hardcoded in the engine. |
| AD-16 | One ProofPulse tree per Organisation in the MVP (scope recorded per leaf). |
