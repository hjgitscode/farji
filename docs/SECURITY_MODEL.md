# FARJI Security Model

Terminology follows [DOMAIN_MODEL.md](DOMAIN_MODEL.md). On-chain controls are
specified in [BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md).

---

## 1. Security goals

1. A Credential can only be attested by an issuer wallet authorised for the issuing
   Organisation at the issuance timestamp.
2. Only the issuing Organisation can end or revoke its Credentials.
3. Candidates can never verify, approve or upgrade their own claims.
4. Verification states are derived from evidence and cannot be forged by editing
   database rows.
5. Historical evidence (claim versions, decisions, attestations, key history,
   anchors, revocations, audit events) is preserved and tamper-evident.
6. No candidate personal data is written on-chain.
7. Private keys and secrets never enter the repository or the server's custody
   (except deployment secrets in the hosting secret store).

---

## 2. Actors and trust

| Actor | Trust level | Notes |
|---|---|---|
| Public viewer | Untrusted | Read-only, rate-limited, sees only what candidates made public |
| Candidate | Untrusted for verification | Fully trusted only for authoring their own self-declared content |
| Issuer | Trusted **only** for their own Organisation | Must check the Organisation's own source of truth before approving |
| Admin | Highly privileged governance | Trust root for which wallets speak for which Organisation; cannot issue or revoke credentials |
| FARJI server | Trusted to run workflow; **not** trusted to forge evidence | Cannot sign attestations or anchor (holds no issuer keys); evidence it serves is independently re-verifiable |
| Chain | Trusted for ordering, timestamps and integrity of what was written | Not trusted for real-world truth |
| RPC provider | Semi-trusted | Use a reputable provider; critical reads use `finalized` tag |

---

## 3. Threat model

| # | Threat | Mitigation |
|---|---|---|
| T1 | Candidate self-verifies (API call, form tampering) | Server-side role + ownership checks in every service; no candidate path to ReviewDecision/Attestation |
| T2 | Issuer of Org A approves/ends/revokes for Org B | Service layer derives `organisationId` from the actor's membership, never from request input; on-chain `credentialId` embeds `orgId`; wallet bound to one Org for life |
| T3 | **Any issuer revokes arbitrary credentials (FARJI2 weakness)** | `revokeCredential(orgId, credentialSalt, …)` recomputes the ID and requires the caller's key for that `orgId`; tests prove cross-org revocation reverts |
| T4 | Rejection destroys history (FARJI2 weakness) | REJECT is a status transition + ReviewDecision row; no delete of Claim/ClaimVersion/Request |
| T5 | Stored boolean "verified" flipped in DB | No such column; state derived from signatures, chain anchors and revocations on read |
| T6 | DB tampering of evidence | Signatures and Merkle proofs re-verified on every evaluation; mismatch → `INVALID_PROOF`; audit log append-only |
| T7 | Stolen/retired issuer key backdates a credential | `issuedAt` must lie inside the key's validity period; a retired wallet is never re-authorised; positive state requires anchoring within `maxAnchorDelay`; compromise marking invalidates later anchors |
| T8 | Replay of old attestation / ProofPulse rollback / forked anchor history | EIP-712 domain, unique nonces, `statusSeq`, monotonic `rootSeq`, contract-computed `chainRoot` per (Organisation, attestation type) with `expectedPreviousChainRoot` check |
| T9 | Brute-forcing claim content from on-chain digests; learning content from a revoked credential's public salt | Three distinct per-credential random salts (`credentialSalt`, `contentSalt`, `subjectSalt`); only `credentialSalt` can become public; no plaintext on-chain; DB CHECK forbids equal salts |
| T10 | Rogue/compromised Admin authorises own wallet for an Organisation | MVP: Admin browser wallet + mandatory MFA + step-up re-auth; audit + on-chain events; Organisation notified of every wallet change. Multisig and timelock are future production hardening (accepted residual risk for the first Sepolia deployment) |
| T11 | Issuer approves their own claim via the same account | Server rejects if `issuerUserId == claim owner userId`; residual risk with second accounts is an Organisation governance issue (documented) |
| T12 | Impersonation — candidate claims to be someone in the Org's records | Issuer must match against source of truth using institutional identifiers; optional institutional email proof; Issuer accountable via audit |
| T13 | Server compromise | No issuer/admin private keys on server; evidence independently verifiable via proof bundle; least-privilege DB role |
| T14 | Public data scraping / enumeration | Opaque handles and IDs, rate limiting, profile visibility controls |
| T15 | Supabase auto-generated REST API exposes tables | Disable the Data API for app schemas or enable RLS deny-all on every table; app accesses DB only via server-side Prisma |
| T16 | Mock/simulated chain data presented as real | Prohibited; tx records only from real broadcasts; on-chain positive states only after the confirmation/finality policy is met |
| T17 | Chain reorg displays a non-existent anchor | Confirmation/finality policy (default `finalized` blocks) before any on-chain positive state |
| T18 | Operational status (APPROVED / SIGNED / QUEUED_FOR_ANCHOR) shown as a verification result | Only derived verification states are rendered as badges; operational statuses are labelled as progress |
| T19 | Role escalation via editable auth metadata | Role stored in the application `User` table (server-written), never read from Supabase user-editable metadata |

---

## 4. Authorisation matrix

| Action | Candidate | Issuer (own Org) | Issuer (other Org) | Admin | Public |
|---|---|---|---|---|---|
| Edit own profile / claims (new ClaimVersion) | ✅ own | ❌ | ❌ | ❌ | ❌ |
| Submit / withdraw VerificationRequest | ✅ own | ❌ | ❌ | ❌ | ❌ |
| View request queue & candidate-shared request data | ❌ | ✅ | ❌ | ✅ read-only oversight | ❌ |
| Approve / reject request | ❌ | ✅ (not own claim) | ❌ | ❌ | ❌ |
| Sign CredentialAttestation | ❌ | ✅ with authorised wallet | ❌ | ❌ | ❌ |
| Create / seal / anchor CohortProof batch | ❌ | ✅ | ❌ | ❌ | ❌ |
| End CONTINUING relationship / anchor ProofPulse epoch | ❌ | ✅ | ❌ | ❌ | ❌ |
| Revoke Credential | ❌ | ✅ | ❌ | ❌ | ❌ |
| Manage Organisations, memberships | ❌ | ❌ | ❌ | ✅ | ❌ |
| Authorise / retire / rotate / mark-compromised wallets | ❌ | ❌ | ❌ | ✅ | ❌ |
| View audit history | own actions | own Org | ❌ | ✅ all | ❌ |
| View public profile / verify credential | ✅ | ✅ | ✅ | ✅ | ✅ (if public) |

---

## 5. Enforcement architecture

- **Server-side is the only enforcement point.** UI hiding is cosmetic. Middleware
  may redirect unauthenticated users but is never the authorisation check.
- Every application service function takes an `ActorContext`
  (`userId`, `role`, `organisationId?`, session assurance level) resolved on the
  server from the session — never from request bodies, query params or headers set
  by the client.
- Each service performs: (1) role check, (2) ownership / Organisation-scope check
  against the target row loaded from the DB, (3) state-machine check, (4) mutation,
  (5) audit event — inside one DB transaction.
- Organisation scope is derived from the actor's ACTIVE membership. A request
  carrying an `organisationId` different from the actor's is rejected.
- Wallet-backed actions additionally require the signing/sending address to be an
  authorised issuer wallet of the actor's Organisation **on-chain**, and linked to
  that actor's membership off-chain.
- All inputs validated with schemas (e.g. Zod) at the boundary; unknown fields rejected.
- Tests must include negative authorisation tests for every mutating endpoint.
  **Never weaken or delete a security check to make a test pass.**

---

## 6. Authentication

- **Supabase Auth** (decided, ROADMAP D1), integrated server-side with Next.js.
  Secure, HttpOnly, SameSite cookies; session validated on the server for every
  request; session rotation on privilege change.
- One primary application role per account (CANDIDATE, ISSUER or ADMIN), stored in
  the application `User` table. Organisation membership is a separate record.
- Candidates: email/OAuth sign-in; no wallet.
- Issuers: invitation-only; MFA required.
- Admins: provisioned out-of-band; MFA required; recent re-authentication (step-up)
  for sensitive actions (wallet authorisation, Organisation suspension, role changes).
- Wallet connection is **not** authentication; it is an additional factor for
  on-chain actions.

---

## 7. Keys and secrets

- Never commit: `.env*` (except `.env.example` with placeholder values), private
  keys, mnemonics, RPC keys, DB URLs, auth secrets. `.gitignore` in Phase 1 must
  cover these.
- Deployment secrets live only in the hosting provider's secret store.
- Candidates have no wallet and no keys.
- Issuer and Admin keys live in their holders' browser wallets (e.g. MetaMask;
  hardware wallet recommended). The FARJI server never stores, receives or uses them.
- No relayer in the MVP: every contract write is sent by the acting wallet itself.
- The contract deployment key exists only in the deployer's local, untracked
  environment (or a hardware wallet); after deployment, roles are granted to the
  Admin browser wallet(s). Multisig ownership is future hardening, not an MVP
  requirement.
- Secret scanning in CI (Phase 16).

---

## 8. Audit trail

- Every important mutation writes an AuditEvent in the same DB transaction:
  claim versioning, request submission/withdrawal, review decisions (approvals and
  rejections — rejection history is retained internally), signatures
  accepted, batch seal/anchor, status changes, revocations, membership changes,
  wallet changes, Organisation status changes, role changes, admin views of
  sensitive data.
- AuditEvent is append-only: the application DB role has no UPDATE/DELETE grant on
  it (enforced by DB privileges or triggers), and events may be hash-chained.
- Audit records reference IDs and digests, not full personal content.

---

## 9. Historical evidence

- Append-only entities listed in [DOMAIN_MODEL.md](DOMAIN_MODEL.md) §9 are never
  deleted or rewritten by application code. Hard deletes of these tables are
  prohibited in services and migrations.
- Rejection, withdrawal, supersession, ending and revocation are all **new records
  or status transitions**, never deletions.
- Privacy erasure uses crypto-shredding under a documented policy (open decision),
  not silent row deletion.

---

## 10. Privacy

- On-chain: only `orgId`, `credentialId`, salted commitments, roots, timestamps,
  wallet addresses, reason codes.
- Off-chain personal data minimised; evidence documents (if supported) stored in
  private object storage with signed, short-lived URLs.
- Candidates control profile visibility and per-claim visibility. Rejections are
  not shown on public professional profiles by default (decided); they remain in
  the internal append-only ReviewDecision/AuditEvent history.
- Applicable data-protection law (e.g. India DPDP Act 2023, GDPR for EU users) to be
  confirmed before Phase 14.

---

## 11. Known FARJI2 prototype weaknesses — must not be repeated

| Weakness | FARJI rule |
|---|---|
| Any authorised issuer from any Organisation could revoke arbitrary credentials | Revocation bound to issuing Organisation via `credentialId` derivation (BLOCKCHAIN_MODEL §9) |
| Rejecting a request deleted the credential row | Rejection is a status transition with a ReviewDecision record |
| Verification as a stored boolean | Derived verification states only |
| Simulated / demo blockchain interactions in UI | Real transactions only; no fabricated tx data |
| Educational/demo pages in the public product (Developers, Technology, Novelty, Contract explorer, ProofPulse/CohortProof explainers) | Not shipped; concepts live in internal docs only |
| Full Merkle rebuild per period (implied anti-pattern) | Event-driven ProofPulse with path-only updates |

---

## 12. Web application baseline

- CSRF protection (Server Actions origin checks / tokens for route handlers).
- Output encoding; no `dangerouslySetInnerHTML` with user content.
- Strict Content-Security-Policy, HSTS, `X-Frame-Options`/`frame-ancestors`.
- Rate limiting on auth, request submission, public verification endpoints.
- Dependency audit and lockfile committed.
- Error messages never leak stack traces, SQL or secrets in production.

---

## 13. Security testing (Phase 16, plus per-phase negative tests)

- Authorisation test suite covering every cell of §4.
- Contract tests per [BLOCKCHAIN_MODEL.md](BLOCKCHAIN_MODEL.md) §14 plus static
  analysis (e.g. Slither).
- Tamper tests: modify DB evidence → `INVALID_PROOF`.
- Replay tests: reused nonce, old `statusSeq`, old `rootSeq`.
- Secret scanning, dependency audit, header checks.
