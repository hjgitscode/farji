# Final product UI/UX pass: recovery checkpoint (non-secret)

Presentation layer only. No change to contracts, lifecycle semantics, database, auth/RBAC, Merkle/CohortProof/ProofPulse, finality,
server-action contracts or the verification engine. Phases 0-16 are complete (see docs/PHASE16_STATE.md). If the conversation is compacted:
read this file, docs/PHASE16_STATE.md, `git status`, `git log --oneline -8`, and resume from the first unchecked item below.

## Design system (done)
- Tokens in `app/globals.css` (Tailwind v4 `@theme`): warm neutral scale (every existing `neutral-*` class follows it), institutional trust
  green (`emerald-*` remapped, deep not neon), charcoal navigation (`nav*`), soft shadows (`shadow-card`, `shadow-lift`), `fade-in` and
  `shimmer` motion with reduced-motion support, Inter via `next/font` (self-hosted, CSP-safe).
- Primitives in `components/ui/index.tsx` (+ `Icon.tsx`, `Logo.tsx`): Badge/StatusBadge/StatusPill, PageHeader, Card, Panel, Section, Stat, Alert,
  EmptyState, buttons (`btn.*`), `inputClass`, TabNav, Facts, Disclosure, Mono, RowList, Stepper, Skeleton, Spinner, one outline icon set.
- Status system: derived verification states keep `lib/verification/present.ts` (tone + word + icon, never colour alone); workflow and
  transaction statuses live in `lib/ui/status.ts` (PIPELINE_STATUS, TX_STATUS, BATCH_STATUS, ORG_STATUS) and are never mixed with verification states.
- Evidence grouping for the public verifier: `lib/verification/evidence-groups.ts` (presentation only; every check is kept).

## Checkpoints
- [x] Tokens, font, icons, logo, primitives, status maps
- [x] Shells: public header/footer; candidate top bar; issuer/admin charcoal sidebar with groups, active state, mobile collapse, network pill
- [x] Public: landing, verify lookup, verifier (verdict hero, summary, grouped trust evidence, collapsible technical evidence, share), profile, notices
- [x] Candidate: overview (identity header, summary stats, needs-attention, recent records), record cards, verification status
- [x] Issuer: overview (work queue), requests + review (two-column, approve vs reject), credentials (stepper, "Next: Go to Batches"), batches
      (stepper, unmistakable "Anchor this batch"), wallet, history, activity (TxTable)
- [x] Admin: overview (finality health, recent activity), organisations (rows with status), organisation detail, transactions (TxTable)
- [x] Auth: sign-in, sign-up, access denied, not-found, error pages
- [x] Loading skeletons (role segments + verifier)
- [x] Build, visual QA (headless Chrome: desktop 1440 and small-screen 500; real verifier on the smoke credential)
- [x] Gate: lint, typecheck, build, unit 555/555, DB product+verification 39/39 (no test needed changing)
- [x] Commit 4729208, pushed, production verified (routes, CSP 0 violations, fonts/CSS 200, PERMANENT_VALID 20 PASS)

## Notes
- `Anchor` on Credentials is now a plain "Queued for anchor" status with a "Next: Go to Batches" panel; the real CTA is "Anchor this batch" on Batches.
- Private pages cannot be screenshotted signed-in without credentials; they are checked through a temporary preview route (deleted before commit)
  and through render tests.
