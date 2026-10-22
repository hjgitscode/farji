# Phase 16 recovery checkpoint (non-secret state only)

Phase 16 = security, reliability and deployment hardening. No change to lifecycle semantics, derived states, CohortProof/ProofPulse
architecture or the deployed (non-upgradeable) registry. No UI redesign. If the conversation is compacted: read this file,
docs/PHASE15_STATE.md, docs/ROADMAP.md, run `git status` / `git log --oneline -10`, and resume from the last checkpoint.

## Baseline
- Phase 15 complete and committed: `d219487` (pushed to origin/master).
- Phase 15 baselines: verification tests 95/95, deploy structural tests 61/61; earlier full baseline unit 542 + 1 skipped, DB 267, contracts 56, chain 22.

## Workstreams
| Id | Area | Status |
|---|---|---|
| A | Security headers / CSP | done (config/security-headers.ts, next.config.ts, tests/deploy/security-headers.test.ts); runtime check at final gate |
| B | Generic wallet error masks server refusal | done (ServerRefusal + refuse() in components/wallet/wallet.ts; buttons; tests in tests/deploy/chain-ready.test.ts) |
| C | Supabase advisor warnings (leaked passwords, `_prisma_migrations` RLS) | done: S-01 fixed by migration `20261022180000_lock_down_data_api` (APPLIED to production; anon REST now 401/42501; prod verifier still PERMANENT_VALID); leaked-password = human dashboard action |
| D | DB indexes (unindexed FKs, unused indexes) | done: reviewed against queries; no index added or dropped (see PHASE16_SECURITY.md) |
| E | Contract security review | done: Slither 0.11.6 (scratchpad venv, solc 0.8.28) 52 results, none material; manual review clean |
| F | Application security review | done: sign-in/sign-up per-client brake added (RULES.signIn/signUp); other areas reviewed, no change |
| G | Secret / env safety | done: tracked files + full git history scanned; 2 hits are test sentinels |
| H | RPC / chain reliability | done: syncPending error result now reports the row's real status (+ DB test); daily-only cron = human action |
| I | Final gate | done (all gates pass) |
| J | Docs (PHASE16_SECURITY.md, ROADMAP, CLAUDE.md, DEPLOYMENT) | done |

## Checkpoints
- P16-0: Phase 15 docs committed (`d219487`) and pushed; admin email redacted from PHASE15_STATE.md before commit.

- P16-1: B wallet refusal fix + tests (13/13 chain-ready). A CSP + headers + tests (deploy 72/72).
- P16-2: C/D. Finding S-01: `_prisma_migrations` had RLS off and anon/authenticated had full DML grants (all public tables had grants, only RLS
  protected FARJI tables); anonymous Data API read of `_prisma_migrations` returned 200. Migration `20261022180000_lock_down_data_api` (RLS on
  `_prisma_migrations`, revoke anon/authenticated on public tables + sequences + default privileges) applied with `npm run db:migrate`.
  After: anon REST 401 (42501) on every probed table; production `/verify/.../bundle` still PERMANENT_VALID; `/p/nobody-here` 404 after DB read.
  New DB test tests/db/data-api-lockdown.test.ts 3/3. Indexes: no change (all queried FK prefixes already indexed).

- P16-3: E/F/G/H done. Files: lib/security/rate-limit.ts, lib/auth/actions.ts, server/chain/sync.ts, tests/deploy/config.test.ts,
  tests/db/chain-sync.test.ts (32/32). Deploy + auth tests 135/135.

- P16-4: final gate so far: lint 0, typecheck 0, db:validate ok, unit 555 + 1 skipped, build ok, local production runtime CSP check
  (headers on every page, no external resources, headless Chrome 0 violations with a positive control), contracts 56 passing,
  `chain:check` all ok. Pending: test:db (running), test:chain (after test:db; same database). Docs written: docs/PHASE16_SECURITY.md,
  ROADMAP row/section 16, CLAUDE.md status, DEPLOYMENT sections 2/3/7/8. Next: finish gates, commit, push, verify production headers.

- P16-5: PHASE 16 COMPLETE. test:db 271/271, test:chain 22/22. Committed `47c9af6` and pushed; Vercel production redeployed from master;
  production verified (CSP + headers live, 0 CSP violations in headless Chrome, routes as expected, bundle PERMANENT_VALID, no private fields).
  Next phase: UI/UX polish and final presentation/demo preparation (not started).

## Human-only actions (collected; do not interrupt the run)
- GitHub repository settings: add secrets FARJI_APP_URL (https://farji.vercel.app) and FARJI_SYNC_TOKEN (same value as Vercel), and variable
  FARJI_SYNC_ENABLED=true, so .github/workflows/chain-sync.yml finalizes transactions every 10 minutes (Vercel Hobby cron is daily only).
- Supabase dashboard > Authentication > (Email provider / Attack protection): enable leaked-password protection (HaveIBeenPwned). Paid-plan
  feature per Supabase; not reachable with available tooling (no management token).

## Next step
- None for Phase 16. Remaining: the two human-only actions above; then the UI/UX phase.
