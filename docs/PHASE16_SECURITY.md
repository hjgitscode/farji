# Phase 16 — Security, reliability and deployment hardening

Scope: production hardening of the deployed FARJI (Vercel `https://farji.vercel.app`, Supabase `farji-dev`, `FarjiRegistry` on Sepolia
at `0xedd02dc8d15892df10e9d83f8fe7b9680ba2bef9`) **without** changing the locked architecture: lifecycles, the eleven derived states,
CohortProof / ProofPulse, finality semantics and the deployed non-upgradeable registry are unchanged. No secret appears in this document.

Severity scale: **High** (exploitable by an anonymous party against integrity or availability), **Medium** (meaningful defence
missing or exploitable only with effort), **Low** (limited impact or defence in depth), **Info** (no action needed).

## Summary

| Id | Finding | Severity | Disposition |
|---|---|---|---|
| S-01 | Supabase Data API: `_prisma_migrations` readable and writable by anyone with the public key | High | **Fixed** (migration, applied to production) |
| S-02 | No Content-Security-Policy | Medium | **Fixed** (enforced policy; residual noted) |
| S-03 | Password sign-in / sign-up had no per-caller brake | Medium | **Fixed** (per-instance limiter) |
| S-04 | Wallet buttons hid the server's refusal behind a generic wallet message | Low | **Fixed** |
| R-01 | Automatic chain sync runs only once a day on the current Vercel plan | Medium (reliability) | **Human action** (enable the existing GitHub workflow) |
| R-02 | `syncPending` reported a wrong status for a transaction whose sync threw | Low | **Fixed** |
| S-05 | Supabase leaked-password protection disabled | Low | **Human action** (dashboard; paid-plan feature) |
| D-01 | Advisor: 19 unindexed foreign keys, 2 unused indexes | Info | **Reviewed, no change** (rationale below) |
| C-01 | `FarjiRegistry` static analysis and manual review | Info | **No material issue**; notes recorded, no redeploy |
| A-01 | Application review (auth, RBAC, actions, API, public surface, logs, injection, redirects) | Info | **No issue** beyond S-03/S-04 |
| G-01 | Secret and environment safety | Info | **Clean** (tree and full history) |

---

## S-01 — Supabase Data API exposed `_prisma_migrations` (High, fixed)

**Finding.** Supabase grants the `anon` and `authenticated` roles full privileges on tables created in `public`. FARJI's own tables were
protected only by RLS (enabled, no policies). `_prisma_migrations` is created by Prisma itself, not by a FARJI migration, so its RLS
was off: the Supabase advisor warning was a real exposure, not noise. Evidence (read-only probe with the PUBLIC publishable key, as any
visitor could): `GET /rest/v1/_prisma_migrations` returned **HTTP 200 with rows** (migration names, checksums, logs). The grants
(`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, ...`) also allowed anonymous **modification** of the migration history, which could break or
mislead a future `prisma migrate deploy`. No write was attempted against production. FARJI user data was not exposed (RLS returned 0 rows).

**Fix.** Migration `prisma/migrations/20261022180000_lock_down_data_api`:
`ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY`, and, guarded for databases without Supabase roles, `REVOKE ALL` on all
tables and sequences in `public` from `anon` / `authenticated`, plus the same for default privileges of objects `postgres` creates later.
No table, column, index or row changed. FARJI never uses the Data API (all access is server-side through Prisma as the table owner,
`postgres`, which owns the tables and bypasses RLS), and no trigger or function depends on those roles (checked: no triggers on `auth`,
every `public` function is a `postgres`-owned trigger function).

**Applied** to production with `npm run db:migrate` (2026-10-22). After: the same anonymous probe returns **HTTP 401 / 42501** for
`_prisma_migrations`, `User`, `Credential`; the production verifier still derives `PERMANENT_VALID`; `/p/nobody-here` still answers 404
after a database read. **Test:** `tests/db/data-api-lockdown.test.ts` (every `public` table has RLS; no table/sequence grant to `anon` /
`authenticated`; default privileges do not re-grant them).

## S-02 — Content-Security-Policy (Medium, fixed)

**Finding.** Only baseline headers were set; no CSP.

**Fix.** `config/security-headers.ts` (pure, unit-tested) builds the headers applied to every route by `next.config.ts`:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self' <supabase origin> <wss supabase origin>; frame-src 'none'; frame-ancestors 'none';
object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'
```

plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera, microphone, geolocation, payment, usb, browsing-topics off), `Strict-Transport-Security` (2 years,
subdomains) and `Cross-Origin-Opener-Policy: same-origin`. Development additionally allows `'unsafe-eval'` and websockets (dev server).

Compatibility, verified rather than assumed: the browser makes no third-party request (the browser Supabase client is unused; sign-in is
server-side); MetaMask's injected provider and its RPC traffic belong to the extension, which page CSP does not govern, and FARJI's wallet
calls are `window.ethereum.request` only; the QR code is inline SVG markup; fonts are self-hosted. Runtime check on a local production
build: every page served the header; no `src`/`href`/`action` to another origin; no inline event-handler attributes; headless Chrome loaded
`/login` and the public verifier with **0 CSP violations** (a deliberate control violation was detected, so the check is real).

**Residual (deferred).** `script-src` keeps `'unsafe-inline'` because Next.js App Router emits inline bootstrap scripts. A nonce-based
policy requires per-request nonces, which forces every page (including the static public pages) to render dynamically; this is a
deliberate trade-off to revisit with the UI phase, not a silent gap. React's escaping and the absence of `dangerouslySetInnerHTML` (other
than the server-generated QR SVG) limit the XSS surface the nonce would protect.

**Tests:** `tests/deploy/security-headers.test.ts` (directive-level assertions, malformed/credentialed Supabase URLs cannot widen
`connect-src`), `tests/deploy/structural.test.ts` (headers wired for `/:path*`).

## S-03 — Sign-in / sign-up brake (Medium, fixed)

**Finding.** `loginAction` / `signupAction` call Supabase from FARJI's server, so Supabase's per-IP auth limits see the platform's address,
not the caller's; FARJI applied no per-caller limit to password attempts.

**Fix.** `RULES.signIn` (10 per 5 minutes) and `RULES.signUp` (5 per 10 minutes) per hashed client key, checked before Supabase is
contacted, with a neutral message. Same honest scope as the existing limiter: per server instance, not distributed (a Vercel Firewall
rule is the platform's job; see DEPLOYMENT.md). **Tests:** `tests/deploy/config.test.ts` (limits, per-caller isolation, brake runs before
`signInWithPassword` / `performSignup`).

## S-04 — Server refusals hidden by the wallet message (Low, fixed; Phase 15 finding)

**Finding.** Wallet buttons rethrew a server action's `{ ok: false, error }` as a plain `Error`, which `walletMessage()` mapped to
"The wallet request did not complete. Please try again." In the Phase 15 smoke test a second "Anchor this batch" click was correctly
refused ("A transaction for this is already in progress.") but the user saw the generic text.

**Fix.** `components/wallet/wallet.ts`: `ServerRefusal` + `refuse()`; `walletMessage()` shows a `ServerRefusal` as is. Safe because the
text was already reduced on the server by `toFail()` (domain messages only; infrastructure and unknown errors become generic sentences).
Unknown wallet/RPC errors still get the generic fallback; missing, non-text or over-long refusals fall back too. Used by every wallet and
action button (`WalletButtons.tsx`, `ParamForms.tsx`). **Tests:** `tests/deploy/chain-ready.test.ts`.

## R-01 — Chain sync cadence (Medium reliability, human action)

**Finding.** Positive evidence is mirrored only when a transaction reaches FINALIZED through `server/chain/sync.ts`. On the current Vercel
plan the cron (`vercel.json`) runs **once a day**; between runs, transactions move only when someone presses **Check status**. The
repository already ships `.github/workflows/chain-sync.yml` (every 10 minutes, same token-protected endpoint), disabled until configured.

**Disposition.** Human action (GitHub repository settings; no GitHub CLI or token is available to the tooling): secrets
`FARJI_APP_URL`, `FARJI_SYNC_TOKEN`, variable `FARJI_SYNC_ENABLED=true`. Finality semantics are unchanged either way.

## R-02 — Sweep result status (Low, fixed)

`syncPending` labelled any transaction whose sync threw as `CONFIRMED`. It now reports the row's actual status (a failed pass changes
nothing). Reporting only; database state was never affected. **Test:** `tests/db/chain-sync.test.ts` (RPC failure leaves the row PENDING
and reports PENDING).

Other chain reliability properties re-checked (no change needed): the endpoint guard proves chain id and registry code before any read or
write (`server/chain/ready.ts`); `PENDING -> CONFIRMED -> FINALIZED` with reorg back to PENDING, nonce-based DROPPED detection at the
`finalized` tag and a 24 h give-up; every transition is a conditional update (idempotent, concurrency-safe); FINALIZED and the mirror
commit in one database transaction, so a failed mirror is retried; one bad transaction never stops a sweep; duplicate submission is
refused at build time (`assertNoInFlight`), recorded hashes are unique per chain, and the contract refuses a stale chain head;
`npm run chain:check` passes against Sepolia.

## S-05 — Leaked-password protection (Low, human action)

Supabase Auth's HaveIBeenPwned check is an Auth setting in the Supabase dashboard (and a paid-plan feature per Supabase). It cannot be
changed with the available tooling. Impact is limited: passwords are already length-checked, and S-03 now brakes guessing. Human action
listed below.

## D-01 — Database indexes (Info, reviewed, no change)

Checked against the actual queries in `server/` and `lib/`:

- **Composite organisation-scoped foreign keys** (`Attestation`, `CohortLeaf`, `ProofPulseLeaf`, `Anchor`, `Revocation`, `ReviewDecision`):
  every lookup FARJI performs is on the leading column, which is already indexed (`Attestation(credentialRowId)`,
  `Attestation(signerKeyId, nonce)`, `CohortLeaf(batchId, position)`, `ProofPulseLeaf(treeId, leafIndex)`, unique `credentialRowId`s).
- **Remaining single-column foreign keys** (`organisationId` on several tables, `IssuerKey.operatorMemberId` / `authoriseTransactionId` /
  `retireTransactionId`, `VerificationRequest.candidateId`, `BlockchainTransaction.initiatedByUserId`, `ProofPulseUpdate.causedByAttestationId`):
  no query filters on them. Their only cost would be on a parent DELETE or key UPDATE, and FARJI never does either (foreign keys are
  `RESTRICT`, history is append-only by trigger, ids are immutable).
- **"Unused" indexes**: `IssuerKey(organisationId)` serves the wallet lists (unscanned only because tiny tables are sequentially scanned);
  `ProofPulseUpdate(treeId, leafIndex, rootSeq)` has no ProofPulse data in production yet. Kept; revisit with real ProofPulse volume.

Adding indexes would add write cost for no measured read benefit, so none were added or dropped.

## C-01 — `FarjiRegistry` (Info, no material issue)

**Tools.** Hardhat suite (56 passing); Slither 0.11.6 with solc 0.8.28 (optimizer 200, cancun), dependencies excluded from reporting
(52 results). Slither was run from an isolated scratch virtual environment and is not a repository dependency.

**Slither results.** All High/Medium arithmetic results (`incorrect-exp`, `divide-before-multiply`) are in OpenZeppelin `Math` /
`SafeCast` / `Panic` / `Hashes` (known false positives). In `FarjiRegistry`: `incorrect-equality` (2) are zero-sentinel checks
(`compromised == 0`, `orgId != 0`), not balance comparisons; `timestamp` (7) is the intended use of block time for validity windows
(a proposer can skew it by seconds only); `shadowing-local` (constructor `defaultAdmin` parameter, cosmetic); `unindexed-event-address`
(`AnchoringPaused` / `AnchoringUnpaused`, cosmetic).

**Manual review** (all hold):
- *Access control / role separation*: every governance function is `onlyRole(PLATFORM_ADMIN_ROLE)`; `DEFAULT_ADMIN_ROLE` (86400 s delay,
  OpenZeppelin `AccessControlDefaultAdminRules`) only manages that role; an issuer wallet can never receive a role (`_grantRole` override)
  and an admin wallet can never be authorised as an issuer (`_authorise`).
- *Issuer authorisation / key lifecycle*: one record per wallet ever; a retired or compromised wallet is never re-authorised; retirement
  needs `now > validFrom`; compromise is set once within `[validFrom, now]` and closes an open period; `isIssuerAuthorisedAt` uses
  `[validFrom, validUntil)`.
- *Unauthorised writes*: anchoring and revocation require an OPEN, not compromised issuer wallet **of that organisation**; anchoring also
  requires an ACTIVE organisation and no pause.
- *Revocation*: `credentialId` is rebuilt from the caller's own `orgId`, so cross-organisation revocation is impossible; revocation is
  once-only and allowed while suspended or paused (by design); ENDED is never a revocation (off-chain ProofPulse status).
- *Epoch / previous-chain-root continuity, duplicate anchoring*: `expectedPreviousChainRoot` must equal the head (no forks, stale
  submissions revert); `chainRoot` commits to batch root, previous root, organisation, type and epoch, and an existing `chainRoot` is
  refused; ProofPulse `rootSeq` is monotonic and a different root at the same sequence is refused.
- *Replay*: chain writes are ordinary transactions (sender nonce); EIP-712 attestations are verified off-chain under a domain bound to
  chain id 11155111 and this registry address.
- *Organisation registration*: once only, admin only; status changes cannot return to NONE.

**Notes (Low/Info, no change; the deployed contract is non-upgradeable and these do not justify a new deployment):** a wallet cannot be
marked compromised in the same second it was authorised (`KeyNotYetEstablished`); the admin can `pauseAnchoring` meanwhile. The pause
events do not index the address. Carry both into any future registry version.

## A-01 — Application review (Info)

- **Authentication / RBAC**: all 28 role-scoped server actions call their guard (`requireCandidate` / `requireIssuer` / `requireAdmin`);
  the 4 unguarded actions are intentionally public (credential lookup, login, signup, sign-out). Organisation scope comes from membership.
- **Redirects**: `next` is honoured only via `safeInternalPath` and only inside the user's own role area; the auth callback redirects to
  its own origin; the verifier lookup follows only a well-formed 32-byte reference.
- **API**: `/api/health` returns `{status, service}` only; `/api/chain/sync` uses a constant-time token comparison, a failed-guess brake,
  per-call limits and returns no detail.
- **Public surface / proof bundle**: production bundle re-checked: `PERMANENT_VALID`, no `credentialSalt` / `contentSalt` / `subjectSalt`,
  no nonce, no email; existing DB tests assert the exclusions (`tests/db/product.test.ts`).
- **Injection / logging**: no `$queryRawUnsafe` / `$executeRawUnsafe`; raw SQL uses tagged templates; no `console.*` in application code
  except the name-only start-up configuration report; no user-controlled `href`.
- **Import**: bounded sizes and per-candidate limits (existing).

## G-01 — Secrets and environment (Info, clean)

`.env`, `.env.local`, `.keystore/`, `.vercel/` and `deployments/` are git-ignored and untracked. A pattern scan of every tracked file
(existing structural test) and of the **full git history** (private-key blocks, `sb_secret_`, JWT-shaped keys, credentialed connection
strings, `*_TOKEN` / `CRON_SECRET` / key / mnemonic assignments, Vercel tokens) found only two deliberate test sentinels (a fake sync token
in a test comment and a `localhost` URL asserted never to be printed). The Phase 15 recovery file was committed with the operator's email
redacted.

## Tests added or changed in Phase 16

`tests/deploy/security-headers.test.ts` (new), `tests/db/data-api-lockdown.test.ts` (new), `tests/deploy/chain-ready.test.ts`
(server refusals), `tests/deploy/config.test.ts` (auth brakes), `tests/deploy/structural.test.ts` (headers wiring),
`tests/db/chain-sync.test.ts` (sweep status on RPC failure).

## Deferred (non-blocking)

- Nonce-based CSP without `'unsafe-inline'` scripts (with the UI phase; see S-02).
- Distributed rate limiting (Vercel Firewall / WAF rule); the in-app limiter is per instance by design.
- Custom SMTP for Supabase Auth email (unchanged from Phase 14).
- Block-explorer source verification of the registry (needs an explorer API key).
- ProofPulse index review once production has ProofPulse data (D-01).
- Contract notes in C-01, for any future registry version only.

## Human-only actions

1. **GitHub** (repository `hjgitscode/farji` > Settings > Secrets and variables > Actions): add secrets `FARJI_APP_URL` =
   `https://farji.vercel.app` and `FARJI_SYNC_TOKEN` = the same value as the Vercel `FARJI_SYNC_TOKEN`; add variable
   `FARJI_SYNC_ENABLED` = `true` (R-01).
2. **Supabase dashboard** (project `farji-dev` > Authentication > password security / attack protection): enable leaked-password
   protection if the plan allows it (S-05).
