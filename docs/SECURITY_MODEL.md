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
| T19 | Role escalation via editable auth metadata | Role stored in the application `User` table (server-written), never read from Supabase user-editable metadata; signup sends no metadata; a test forbids reading `user_metadata`/`app_metadata` in `lib/auth` |
| T20 | Open redirect via `next` / returnTo | `next` accepted only as a same-site absolute path (no scheme, host, `//`, `\`, `..`, query) AND only inside the signed-in user's own role area; login-redirect URLs are rebuilt from validated paths |
| T21 | Private page reachable because only its layout was checked | Guard called in every private layout and page; a structural test fails if any page/layout/route under `app/candidate|issuer|admin` lacks its guard call |
| T22 | Issuer acts without an organisation, or for the wrong one | Guard requires an ACTIVE `OrganisationMember`; `organisationId` comes only from that row, never from request input |
| T23 | Service-role key leaks to the browser or is used by the web app | Only the publishable key is read; secret/service-role keys are rejected by env validation; a test forbids reading `SERVICE_ROLE`/`SECRET` env vars in app code |
| T24 | Account enumeration through login errors | One generic message for unknown email and wrong password; signup returns the same "check your email" outcome when confirmation is on |

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

## 5a. Candidate services (Phase 4)

- Every candidate service (`server/candidate/claims.ts`) requires an actor with
  `role = CANDIDATE`, checked before any database access, and uses `actor.userId`
  (from the Phase 3 guard) as the only owner id. Server Actions read an allowlist of
  form fields; user id, role, organisation-member and issuer-key values are never read
  from input, and a test enforces that.
- Another candidate's claim, version or request is indistinguishable from a missing one
  (`NOT_FOUND`), so ids cannot be probed.
- Candidate code cannot create or change a Credential, ReviewDecision, Attestation,
  IssuerKey, Anchor or Revocation (structural test). Request organisations must exist and
  be ACTIVE. Withdrawal and supersession use conditional updates so a concurrent issuer
  decision is never overwritten.
- Candidates see their own request statuses and rejection reason codes only; reviewer
  notes and source-of-truth references are never selected.

---

## 5b. Issuer review services (Phase 5)

- Every issuer service (`server/issuer/review.ts`) requires an actor with `role = ISSUER`,
  an organisation, a member id and an ACTIVE organisation, checked before any database
  access. Mutations re-confirm, inside the transaction, that the member is still ACTIVE in
  that organisation and the organisation is still ACTIVE, so a stale actor cannot decide.
- The Organisation scope is always `actor.organisationId`. Another organisation's request
  is indistinguishable from a missing one (`NOT_FOUND`). Server Actions read an allowlist
  of form fields (`notes`, `sourceOfTruthReference`, `rejectionReason`); no organisation,
  member, key or candidate value is read from input, and a test enforces that.
- A reviewer cannot decide their own claim (service check plus the database trigger).
- Approve and reject start with a conditional open → terminal status update, so concurrent
  decisions are serialised by the row lock and exactly one wins. `ReviewDecision` is unique
  per request and `Credential` unique per ClaimVersion as database backstops; terminal
  requests never change status (trigger).
- Phase 5 code cannot create an Attestation, Anchor, BlockchainTransaction, Revocation,
  IssuerKey, Merkle leaf or any cryptographic material, and cannot update or delete a
  Credential (structural tests). AuditEvents carry ids only, never notes or references.
- Reviewer `notes` and `sourceOfTruthReference` are returned only to the issuing
  Organisation, never to Candidates.

---

## 5c. Issuance and Merkle services (Phases 6–7)

- Every service in `server/issuance/` and `server/merkle/` requires an ISSUER actor with
  an ACTIVE member of an ACTIVE organisation (checked before any database access and
  re-checked inside the transaction). Scope is always `actor.organisationId`; another
  organisation's credential, batch, leaf or proof is `NOT_FOUND`. A credential cannot be
  signed by the owner of its claim or while its ClaimVersion is not the current one.
- **No private keys, anywhere in production code.** The server builds EIP-712 typed data
  and recovers signers; it never signs. Test wallets live only in `tests/fixtures/`, and a
  structural test fails if `lib/`, `server/`, `app/` or `components/` mention a private
  key, mnemonic, `new Wallet(`, `.signTypedData(` or a 32-byte hex literal.
- **Replay and malleability.** The domain binds `chainId` and `verifyingContract` (no
  default; per-environment deployment); the message binds `orgId`, `credentialId`,
  `issuedAt` and a random `nonce` (unique per signer); signatures must be canonical
  low-`s` 65-byte values; `issuedAt` must be recent (10 minutes past, 2 minutes future);
  one CREDENTIAL attestation per credential and one STATUS_CHANGE per `statusSeq` are
  database-unique; the next `statusSeq` is never taken from the client.
- **Issuer keys.** The recovered wallet must be an `IssuerKey` of the credential's own
  organisation, authorised at `issuedAt`, open now and not compromised; a wallet bound to a
  different member (`operatorMemberId`) is refused. Retirement never invalidates earlier
  signatures. Before Phase 9 the `IssuerKey` rows are a trusted mirror (ROADMAP D46); the
  chain stays authoritative.
- **Secrets.** `contentSalt` and `subjectSalt` are private. They never appear in audit
  metadata, Attestations, logs or public/candidate reads; `credentialSalt` is the only
  salt that may ever become public (on revocation). Three distinct salts per credential
  (CHECK).
- **Merkle integrity.** Leaves are rebuilt from Credential rows (never client input);
  double-hashed, domain-tagged leaves prevent second-preimage and cross-engine confusion;
  cohort and pulse writes are serialised per organisation by row locks, with a conditional
  `currentRootSeq` advance, unique `(treeId, rootSeq)` / `(treeId, leafIndex)` and
  append-only history as backstops. A sealed batch and the update log are immutable;
  nothing in these services deletes evidence.

---

## 5d. Application ↔ chain (Phases 8–9)

- **Trust boundary.** The browser wallet signs EIP-712 attestations and sends transactions; it supplies
  only the connected account, a signature and a transaction hash (plus `issuedAt`/`nonce` echoed from
  a prepare step). Organisation, credential, salt, digest, Merkle root, leaf count, root sequence,
  schema id and owner always come from server/database state; Server Actions' parameter lists are
  tested to carry none of them. The server never signs, never sends a transaction and never holds a
  private key (structural tests over `lib/`, `server/`, `app/`, `components/`).
- **Reported transactions are re-derived, not trusted.** The server fetches the transaction from its own
  RPC and requires: the configured chain id and registry address, a registry function decoded from the
  calldata, calldata byte-equal to what the resolver builds from the database (only the chain head the
  contract itself enforces is taken from the transaction), and a sender that is a platform-admin
  wallet on-chain (admin purposes) or a mirrored, FINALIZED-authorised issuer wallet of the actor's
  own organisation (issuer purposes; bound operator must be the actor).
- **Positive evidence only at finality.** Anchor, Revocation, IssuerKey, Organisation status and
  Credential ANCHORED are written by one module (`server/chain/mirror.ts`) inside the transaction that
  moves CONFIRMED → FINALIZED; a reorg before then returns the transaction to PENDING with nothing to
  undo. Events come only from the configured registry address; a `chainRoot` that disagrees with the
  TypeScript formula is refused; unmatched chain facts are audited and transition nothing.
- **Revocation ownership.** `credentialId` is rebuilt on-chain from the caller's own `orgId`; there is
  no revoke-by-id entry point; the app additionally refuses revocation calldata for any Credential that
  is not a known Credential of the issuer's organisation. The mirror will only mark such a Credential.
- **Role separation on-chain.** Admin wallets can never be issuer wallets (and vice versa), so an admin
  can never anchor, sign or revoke; a retired or compromised wallet is never re-authorised.
- **Replacement/DROPPED detection** uses the sender's recorded nonce, so a slow transaction is never
  mislabelled and a replaced one is never left PENDING forever; the scheduled sync endpoint is guarded
  by a constant-time shared token and refuses everything when none is configured.
- **Known limits.** Static analysis of the contract (Slither) is a Phase 16 task. Before the public
  deployment the RPC provider (D18) is a trust assumption of the server's observations. Revocation
  while an Organisation is suspended works on-chain but is blocked in the web app (D32).

## 5e. Verification-state engine (Phase 10)

- **State is derived, never stored.** There is no `isVerified`, score or state column anywhere (a structural
  test scans the schema); `lib/verification` returns the state as a function of raw evidence, a policy and
  `now`. The service and loader (`server/verification`) only read, and a structural test forbids any write.
- **Nothing is trusted because it is stored.** The engine recomputes `credentialId`, content digest, subject
  commitment, dates, the EIP-712 hash, the recovered signer, the Merkle leaf and fold, every `chainRoot` link
  and the ProofPulse roots (by replaying the append-only log). `Credential.pipelineStatus`, Organisation status
  and any single column are never sufficient for a positive state.
- **Only FINALIZED chain evidence is positive** (D17): CONFIRMED anchors give `PENDING`; a not-yet-final
  revocation is surfaced as a note and not applied. A key authorisation must itself be FINALIZED (D46).
- **Organisation scope.** An anchor, signer wallet or revocation belonging to a different Organisation is
  rejected (`INVALID_PROOF`) or ignored (revocation); a proof from another Organisation's chain never verifies.
- **Precedence is total** (A pending → B revoked → C invalid proof → D modified → E lifecycle), so a lower rule
  can never override a higher one; unsigned or self-declared work is never `INVALID_PROOF`.
- **Compromise** is judged at anchor time (twin of the on-chain `isEvidenceKeyValid`); a later retirement never
  invalidates evidence. **D7** window is inclusive at both ends and applied to the first qualifying anchor.
- **Privacy.** A result contains states, timestamps, human-readable reasons and a check list only: never salts,
  claim content, signatures, nonces, the candidate id, reviewer notes, source-of-truth references or audit
  metadata (tested against the JSON of results). The loader never selects review decisions, notes or audit rows.
  A candidate can derive states only for their own claims (`deriveCandidateClaimStates` scopes by `actor.userId`).
- **Fail-closed configuration.** With no chain id / registry configured the service reports verification
  unavailable instead of guessing an EIP-712 domain.
- **Known limits.** The finalised database mirror is the evidence source; a live chain re-read on the public
  path (key history and revocation) and evidence-watermarked caching are Phase 13/14 work. Per-credential
  ProofPulse log replay is O(log length); acceptable for the MVP, a snapshot cache is a later optimisation.

## 5f. Product layer: import, public profile, public verifier (Phases 11-13)

- **Import is not verification.** The importer (`lib/import`) is pure: it reads pasted text or a CSV and never calls a network
  service, scrapes, automates a login or holds a LinkedIn credential (structural tests). The preview persists nothing. The confirm
  step runs inside one transaction under a per-candidate advisory lock, requires an explicit per-record confirmation, repeats
  validation through `createClaim` and refuses duplicates of the candidate's existing records or earlier records of the same
  batch, so a retry or double-submit creates nothing twice. The candidate id is `actor.userId`; ids, roles and organisations in
  the payload are ignored. Imported claims are PRIVATE SELF_DECLARED.
- **Public reads have no actor, so the rules live in the queries.** Only records the owner marked PUBLIC are listed; a private,
  unlisted-elsewhere, unknown or malformed profile/credential is answered identically (404). No query lists or searches people
  or credentials; a 32-byte credential reference or a handle is the only way in. Results never contain a user id, claim id,
  credential row id, salt, nonce, reviewer note, source reference or pipeline status (rendered HTML and JSON are tested).
- **Verification shown to the public is the Phase 10 derivation** over FINALIZED evidence. A stored "ANCHORED" status without
  finalized evidence renders as pending. A pending request is not attributed to an organisation publicly.
- **Evidence bundle.** Public by construction: signer wallet, signed-message hash and signature (the signer is recoverable from them),
  commitments, inclusion proof, anchor and transaction identifiers, derived state and checks. Excluded: salts, the signing nonce,
  claim content, candidate identity, notes, audit data. Full re-derivation of the signed message would need the private content and salt, which
  the holder keeps; that is deliberate.
- **Private areas** keep per-page server guards (every page calls its role guard; areas do not import each other's actions). Destructive
  or exceptional actions (revocation, ending a relationship, suspension, marking a wallet compromised) require a confirmation dialog and
  explain their consequence. The browser still supplies only account, signature and transaction hash.
- **Known limits.** There is no application-level rate limiting yet (Phase 14, with the hosting platform); verification is recomputed per
  request (no cache, so never stale) and a ProofPulse log replay is linear in the log; QR codes and links use `FARJI_PUBLIC_URL` or the
  request host; no live browser-wallet click-through has been run.

---

## 6. Authentication

- **Supabase Auth** (decided, ROADMAP D1), integrated server-side with Next.js 16
  through `@supabase/ssr`. Tokens live in HttpOnly cookies managed by the library
  (never localStorage). Sign-in, sign-up and sign-out are Server Actions (Next.js
  checks the request origin); FARJI never handles or hashes passwords.
- **Identity vs authorization.** Supabase supplies identity only: the user id returned
  by `auth.getUser()`, which validates the token with the Supabase Auth server
  (`getSession()` is never trusted for decisions). `user_metadata` and `app_metadata`
  are never read for authorization; a test enforces this.
- One primary application role per account (CANDIDATE, ISSUER or ADMIN), stored in
  the application `User` table (`User.role` is the only authority). Organisation
  membership is a separate record.
- **Account provisioning.** The first time a verified Supabase user is seen, a `User`
  row is created with role CANDIDATE and an audit event (`USER_CREATED`), idempotently
  (unique `authUserId`, concurrent-create safe). An existing row is never modified, so
  ISSUER/ADMIN roles survive repeated logins. Signup input is allowlisted to email and
  password: no role can be requested, and no metadata is sent to Supabase.
  An administrator must create the ISSUER/ADMIN `User` row before that person's first
  login; otherwise they are created as CANDIDATE and need an audited role change.
- **Route protection.** `proxy.ts` refreshes the session and optimistically redirects
  anonymous visitors away from `/candidate`, `/issuer`, `/admin`. The enforcement point
  is the server-side guard (`lib/auth/guards.ts`) called in every private layout and
  page; Next.js layouts do not re-render on client navigation and do not gate their
  children. Issuers must also hold an ACTIVE `OrganisationMember` of an ACTIVE
  Organisation (suspended or not-yet-onboarded organisations are denied); the
  organisation id is read from that row. Suspended/deactivated users are denied.
- **Redirects.** Post-login destinations come from the database role. A `next` value is
  accepted only as a plain same-site path inside the user's own role area; denial
  pages show fixed text selected by a whitelisted code.
- **Supabase keys.** Only the project URL and the publishable (or legacy anon) key are
  used by the web app; a `sb_secret_…` or `service_role` key is rejected at startup.
- **RLS.** Unchanged: enabled on every FARJI table with no policies. The app reaches
  the database only through server-side Prisma; Supabase's Data API stays locked out.
- Candidates: email + password; no wallet.
- **Not yet implemented (ROADMAP D33):** issuer invitations / admin provisioning path,
  MFA for Issuers and Admins, and step-up re-authentication for sensitive admin actions.
  The target design remains: Issuers invitation-only with MFA; Admins provisioned
  out-of-band with MFA and recent re-authentication for wallet authorisation,
  Organisation suspension and role changes.
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
