# Phase 15 recovery checkpoint (non-secret state only)

This file is the recovery checkpoint for the real Sepolia deployment. It never contains a secret, key, password, token or database
string. If the conversation is compacted: read this file and `docs/DEPLOYMENT.md`, run `git status` and `git log --oneline -5`, inspect
only the relevant deployment scripts, and resume from **Last completed checkpoint** below. Never restart Phase 15 from the beginning.

## Project (unchanged, locked)

- FARJI ("Because your resume should not be farji"): lifecycle-aware professional credential verification. Final repository at
  `C:\Users\Hemang Josan\OneDrive\Desktop\Farji\farji`; GitHub `https://github.com/hjgitscode/farji.git`; branch `master`.
- Phases 0-14 are complete (Phase 14 as code). Phase 15 code is prepared; the real Sepolia deployment and smoke test are what remains.
  Phase 16 is NOT started and must not be started here. No schema change, no UI redesign, no lifecycle-semantics change.
- Lifecycles PERMANENT / CONTINUING / EXPIRING; eleven derived states; EXPIRING never becomes EXPIRED without qualifying FINALIZED
  evidence (no finalized anchor => PENDING, bad evidence => INVALID_PROOF). ENDED is not REVOKED. Operational statuses
  (AWAITING_SIGNATURE, SIGNED, QUEUED_FOR_ANCHOR, ANCHORED) are not verification states.
- Independent chains COHORT and PROOF_PULSE; non-upgradeable contract; server holds no issuer/admin private key; browser wallet signs.
- Baseline before hosted work (do not re-run everything without reason): unit 542 passed + 1 skipped, DB 267, contracts 56, chain 22,
  lint/typecheck/build/db:validate pass. Production-preparation commit `86270d6`.

## Hosted state (done, do not redo)

- Vercel project `farji`, production `https://farji.vercel.app`, deployed from `master`, READY. Production is public; previews are Vercel-auth protected.
- Production variable NAMES present: `NEXT_PUBLIC_APP_URL`, `FARJI_PUBLIC_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `FARJI_SYNC_TOKEN`, `CRON_SECRET`, `FARJI_FINALITY`, `DATABASE_URL`, `DIRECT_URL`.
- Verified on production: `/api/health` 200; `/p/nobody-here` 404 after a database read (DB connectivity proven); `/login` 200; `/verify` 200;
  `/candidate` redirects to `/login`; `/api/chain/sync` without token 401. The verifier shows "verification unavailable" because the chain
  variables are intentionally not set yet (EXPECTED until this phase configures them).
- Supabase project `farji-dev` (ref `hwegyamxkwdwasgnilpj`, ap-south-1). Auth Site URL `https://farji.vercel.app` and redirect
  `https://farji.vercel.app/auth/callback` are configured. Custom SMTP, the leaked-password warning and the `_prisma_migrations` RLS warning
  are deferred (Phase 16 / later) and must not be changed now.
- Vercel CLI 65.0.0 is installed globally and logged in; the repository is linked to the project (`.vercel/`, git-ignored). A local `.env.local`
  holds Vercel auth material and is git-ignored: treat as secret. The Vercel plugin and MCP server were NOT installed.

## Phase 15 target configuration (variable NAMES; values only where public)

| Variable | Where | Status |
|---|---|---|
| `FARJI_CHAIN_ID` = `11155111` | Vercel Production + local `.env.local` | set locally and on Vercel Production |
| `FARJI_RPC_URL` (public PublicNode endpoint, no key) | Vercel Production + local | set locally and on Vercel Production |
| `FARJI_ADMIN_WALLET` (PUBLIC MetaMask admin address) | Vercel Production + local | set locally and on Vercel Production |
| `FARJI_REGISTRY_ADDRESS` = `0xedd02dc8d15892df10e9d83f8fe7b9680ba2bef9` | Vercel Production + local | set locally and on Vercel Production |
| `FARJI_DEFAULT_ADMIN` (optional, public; defaults to admin wallet) | local deploy only | not set |
| `FARJI_ADMIN_DELAY_SECONDS` (optional; >= 86400) | local deploy only | not set |
| `FARJI_FINALITY` = `finalized` | Vercel Production | set |

Tooling (existing, use these only): `npm run chain:keystore -- new|address`, `npm run chain:deploy:sepolia`, `npm run chain:check`,
`npm run env:check`, `vercel env add`, `vercel redeploy`. The deployer is a throw-away wallet in the encrypted local keystore
(`.keystore/deployer.json`, git-ignored); the contract admins are the configured public addresses, so the deployer keeps no authority.

## Last completed checkpoint

**C0 - state capsule written** (this file).
**C5 - FarjiRegistry deployed to Sepolia (user ran `npm run chain:deploy:sepolia`; DO NOT redeploy).** Registry `0xedd02dc8d15892df10e9d83f8fe7b9680ba2bef9`, tx `0xa2cee1ad19e8556e4f7660937ef2ef553dfb6348b8e289968a61103b293f97b5`, block 11964566. The script's read-back reported: code present, admin holds PLATFORM_ADMIN_ROLE, default admin configured, deployer holds no platform role, runtime bytecode matches this build, admin delay 86400 s. (Hash verified on-chain from `deployments/sepolia.json`; a copy pasted in chat had a one-character typo `cce`.)
**C13 - PHASE 15 COMPLETE (live smoke test passed).** Anchor tx FINALIZED 16:08:19Z (CONFIRMED 15:54:29Z; Sepolia finalized 11970565 >= 11970543). Mirror (same DB
transaction, audit `CHAIN_TX_FINALIZED` events [CohortRootAnchored], anchors 1, credentialsAnchored 1, unmatched 0): Anchor `01a1645e-e503-76eb-8840-4c3cd0e1f343` COHORT epoch 1,
batchRoot 0x938c...775c, previous zero, chainRoot 0xb0b0...df3e, anchorer key 0xce5a...441f, block 11970543 (15:50:36Z); batch ANCHORED; credential ANCHORED.
Claim `01a16015-...5ad5d` set UNLISTED through the real `setClaimVisibility` (candidate002, audited). Production, no session: `/verify/0xadb1...34ba` 200 ("Verified");
`/verify/0xadb1...34ba/bundle` 200 JSON with `derivedState.state = PERMANENT_VALID`, all 20 checks PASS (revocation N/A), network 11155111 + registry, anchor tx FINALIZED;
no salts, nonce or email in the bundle. EXPIRING logic: `npx vitest run tests/verification` 95/95 (derive.test.ts EXPIRING cases: unanchored stays PENDING across validUntil;
EXPIRED only with valid FINALIZED evidence). Optional CONTINUING live example NOT run. Docs closed out: ROADMAP rows 14/15 + Phase 14/15 sections, CLAUDE.md status,
DEPLOYMENT.md section 6 notes. Not committed (left for the user).
**C12a - anchor submitted ONCE and successful on-chain; second click was refused by the server before any wallet request.** BlockchainTransaction
`01a1644e-97b6-762a-a127-fe5f17d1b606` ANCHOR_COHORT (target = batch `01a1640d-...45a3`), recorded PENDING 15:50:34Z by production. Tx
`0x8e37f49074bd9680138d527038f4dd4598a9edbdb089e6c7d1be656c2e970e8f`: from `0xce5a...441f` (account nonce 0), to the registry, chain 11155111, status 1, block 11970543,
gasUsed 916837; calldata `anchorCohortRoot(smoke orgId, 0x938c...775c, 1, schemaId 0xdb61...09b7, previous 0x00..00)`; event `CohortRootAnchored` epoch 1, batchRoot 0x938c...775c,
previousChainRoot zero, chainRoot `0xb0b0cdfeb6538356c6f3b288477abf37ac4b121ec4806a0cd9987f6fc0cadf3e`, anchoredBy `0xce5a...441f`. Account 2 nonce latest = pending = 1, so exactly
ONE transaction was ever broadcast. Second click: `TxButton` calls the server BUILD first; `assertNoInFlight` refused it ("A transaction for this is already in progress.",
reproduced with the real `buildTransaction`), and the client's `walletMessage()` maps any non-wallet error without a known code to the generic "The wallet request did not complete".
Nothing reached MetaMask. Minor UX defect (server refusal text masked by the generic wallet message); logged for later, NOT fixed now (no code change mid-smoke).
Sync: PENDING -> CONFIRMED 15:54:30Z (real `syncTransaction`); FINALIZED pending Sepolia finality.
**C11b - cohort batch SEALED; anchor build + simulation pass.** Finding on the "Anchor" not being clickable: EXPECTED, not a bug. On /issuer/credentials "Anchor" is
the stage BADGE for QUEUED_FOR_ANCHOR (app/issuer/credentials/page.tsx STAGE map), never a button. The anchor action is "Anchor this batch" on /issuer/cohort (Batches),
rendered only for a SEALED batch; the batch was still OPEN. "Queue signed credentials" was NOT needed (leaf already added at signing). Sealed via the canonical
`sealCohortBatch` service (same as the "Close this batch" button) as issuer candidate001: batch `01a1640d-4c1b-7279-b4ed-97a627f445a3` "Cohort 2026-10-22", SEALED
14:46:41Z, leafCount 1, batchRoot = leaf `0x938c3508d40f2b2d25a627db273b14139c0bd4af942f319f47f1527ba3e7775c` (proof: no siblings). Dry-run `buildTransaction(ANCHOR_COHORT)`:
`anchorCohortRoot(smoke orgId, 0x938c...775c, 1, schemaId 0xdb61...09b7, previous 0x00..00)` to the registry, chain 11155111, no warnings; `eth_estimateGas` from
`0xce5a...441f` succeeds (~925k gas). No Anchor row, no anchor tx yet.
Next (human): /issuer/cohort -> "Anchor this batch" with MetaMask Account 2 -> confirm the transaction.
**C11a - wallet bound + credential signed (issuer, MetaMask Account 2).** ISSUER_WALLET_BOUND 14:38:34Z (IssuerKey operatorMemberId = `9898fcc4-...`); credential signed:
Attestation `01a1640d-4109-75cf-a747-aa24c3bc324a` kind CREDENTIAL, signer key wallet `0xce5a...441f`, issuedAt 14:38:55Z (after key validFrom 13:57:12Z), chainId 11155111,
verifyingContract = registry; Credential -> QUEUED_FOR_ANCHOR; COHORT_LEAF_ADDED 14:39:16Z (leaf position 0 in the new OPEN batch). Account 2 funded (~0.055 SepETH).
**C10b - issuer authorisation FINALIZED; IssuerKey mirrored; signing pre-checks pass.** Real `syncTransaction`: PENDING -> CONFIRMED 14:05:18Z -> FINALIZED
14:13:24Z UTC (Sepolia finalized block reached 11969994 >= 11969981). Mirror wrote IssuerKey `01a163f5-a7db-763f-ba95-42b24a715f17` (wallet `0xce5a...441f`, smoke org,
validFrom 13:57:12Z = on-chain 1792677432, validUntil/compromisedAt null, authoriseTransactionId = the FINALIZED tx, operatorMemberId null = not yet bound); audit
`CHAIN_TX_FINALIZED`. Pre-sign checks: issuer `candidate001` actor -> smoke org (ACTIVE), member `9898fcc4-...`; credential unchanged (PERMANENT, AWAITING_SIGNATURE,
`0xadb1...34ba`, issuedAt null); production chain config 11155111 / real registry / finalized; `isIssuerAuthorisedAt(org, wallet, now)` = true. The UI's "Sign credential"
calls prepare afresh (new issuedAt + nonce at click time, existing salts reused), so yesterday's prepared payload is irrelevant.
Next (human): issuer signs in, binds Account 2 on /issuer/wallet (signature), then signs the credential on /issuer/credentials (signature). No gas needed.
**C10a - issuer wallet authorisation submitted and verified on-chain (admin, MetaMask).** Issuer wallet (MetaMask Account 2, public) `0xce5a27f33df102e629c2b77a04c368901850441f`
(0 SepETH; not needed until the anchor). BlockchainTransaction `01a163e6-b200-7518-a0e9-f719ea6de032`, purpose AUTHORISE_ISSUER_KEY, tx
`0xa1c3e2444266dd16b559732364230be4d84b9d31bc169acf51b46d86f54b2e5b`: from admin `0xbc6b...89ab`, to the registry, chain 11155111, status 1, block 11969981,
calldata `authoriseIssuerWallet(smoke orgId, 0xce5a...441f)`, one `IssuerWalletAuthorised` event (validFrom 1792677432). Contract: `isIssuerAuthorisedAt(org, wallet, now)` = true.
FARJI row recorded PENDING by production; no IssuerKey row until FINALIZED (mirror). Next: sync to FINALIZED.
**C9b - organisation registration FINALIZED; smoke org ACTIVE.** Tx `0x9da3d4d6b3758a7e71fde56d0cc6a6fd685a2fadccf5481cd8710c1af162ccd9` (to registry, from admin, Sepolia, status 1, block 11964829, one `OrganisationRegistered` log from the registry). FARJI row: PENDING -> CONFIRMED 20:38:26Z -> FINALIZED 20:49:50Z UTC, exactly when Sepolia's finalized block reached 11964829. The mirror wrote the org ACTIVE in the same transaction (audit `CHAIN_TX_FINALIZED` events [OrganisationRegistered], unmatched 0).
**C9c - request, issuer approval and EIP-712 payload done (no wallet needed).** Through the real services: verification request `01a1603a-ea94-74a8-ab6a-19c11341ef6b` (candidate002 -> smoke org); issuer `candidate001` actor resolves to the smoke org (ACTIVE) and sees it; approved (reference "Phase 15 smoke test") -> Credential `01a1603a-ee54-7169-9678-489b88959370`, PERMANENT, AWAITING_SIGNATURE. `prepareCredentialSigning` built the EIP-712 CredentialAttestation under domain FARJI v1, chainId 11155111, verifyingContract = the real registry; credentialId `0xadb1ab8e9837a49b0e8c0ed79b8058c2912ddd3c8e6245ad296d886a1d0634ba`.
**C9a - organisation registration submitted by the admin in MetaMask.** BlockchainTransaction `01a1602e-05a4-716e-9953-fabe0a96314b`, purpose REGISTER_ORGANISATION, tx `0x9da3d4d6b3758a7e71fde56d0cc6a6fd685a2fadccf5481cd8710c1af162ccd9`, from `0xbc6b...89ab`, recorded PENDING by production. Being synced with the real `syncTransaction` code (run locally against the production DB and RPC) until FINALIZED; the org stays PENDING_ONBOARDING until the finalized event is mirrored.
**C8d - smoke data prepared (no chain action yet).**
- Smoke organisation created (same writes as `createOrganisationAction`, audited as the admin): `FARJI Sepolia Smoke Org`, slug `farji-sepolia-smoke`,
  id `e9e01280-6c65-41a9-a232-936126fab200`, on-chain orgId `0xb48348d4fed03fb7328d550e8165c61f415e5b2968c61cc1ed7612eaa42556ce`, status PENDING_ONBOARDING
  (becomes ACTIVE only when the registration transaction is FINALIZED and mirrored).
- Issuer account `candidate001@notsofarji.demo` (demo account): old `devtestorg` membership set REMOVED (kept, audited); new ACTIVE membership
  `9898fcc4-f4ad-4f54-b195-65906047817d` in the smoke org. The dev org `devtestorg` is NOT on the new registry and is not used.
- Candidate account `candidate002@notsofarji.demo` (demo): PERMANENT EXPERIENCE claim "Sepolia Smoke Test Intern" at "FARJI Sepolia Smoke Org",
  2025-06-02 to 2025-08-29, created through the real `createClaim` service: claim `01a16015-471d-70b7-a13b-718b5725ad5d`, version
  `01a16015-476c-765e-a0ed-91f9d13bc900`, PRIVATE, SELF_DECLARED. The verification request waits until the org is ACTIVE.
- Production chain guard reproduced with the production values: `ensureChainReady` ok (11155111, registry, finality `finalized`);
  admin wallet holds PLATFORM_ADMIN_ROLE on-chain.
**C8c - production ADMIN account promoted.** the operator's production admin account (email kept out of the repository; Supabase auth user confirmed; exactly one match; was a fresh CANDIDATE with no claims or memberships) -> FARJI `User` `01a1600f-f6d1-74a1-80f6-2beb9370ac5f` role ADMIN, status ACTIVE, via the docs/DEPLOYMENT.md section 2 procedure inside one DB transaction with an `AuditEvent` `USER_ROLE_CHANGED` (CANDIDATE -> ADMIN). Role counts now: 1 CANDIDATE, 1 ISSUER, 1 ADMIN.
**C8b - admin wallet funded (verified on-chain).** Tx `0x4d384e66f396332e98bb90afeb4be5ec4dfe3a162a0c231b6b386ca198541170`, Sepolia block 11964653, status 1, 0.0525 SepETH to `0xbc6b026F15B1F574B1398C5DddA3181A745989ab`; balance 0.0525. Next: user signs up the production account that will become ADMIN.
**C8a - admin funding NOT yet observed (earlier check).** User reported funding `0xbc6b026F15B1F574B1398C5DddA3181A745989ab`, but two independent Sepolia RPCs (PublicNode, dRPC) report balance 0 at both `latest` and `pending`. Waiting for the funds to arrive on Sepolia before any admin transaction.
**C7 - Vercel Production configured and redeployed.** Added `FARJI_CHAIN_ID`, `FARJI_REGISTRY_ADDRESS`, `FARJI_RPC_URL`, `FARJI_ADMIN_WALLET` (no other variable touched; `FARJI_FINALITY=finalized` kept). Production now has 13 variables. Redeploy `farji-o05rx57il-hjgitscode.vercel.app` READY and aliased to `https://farji.vercel.app`. Verified: `/api/health` 200; `/p/nobody-here` 404 after DB read; `/login`, `/verify` 200; `/verify/<unknown ref>` and its `/bundle` now 404 (verification configured, no longer "unavailable"); `/candidate` -> login; sync without token 401; production logs print `[farji:config] production configuration looks valid`.
**C6 - `npm run chain:check` passed** (all 10 checks: chain id, code, bytecode match, admin role, read call, finalized tag).
**C3+C4 - deployer keystore created and funded.** Deployer public address `0x74F587Bd56909aE4c17B336aAD1DF40F86913620` (matches `.keystore/deployer.json`, git-ignored; verified on Sepolia: balance 0.05 ETH, plain wallet). Next is C5 (deploy), which needs the user's keystore password and typed confirmation.
**C2b - admin address received.** Public MetaMask admin address `0xbc6b026F15B1F574B1398C5DddA3181A745989ab` (valid EIP-55 checksum, a plain wallet, not a contract). Saved as `FARJI_ADMIN_WALLET` in git-ignored `.env.local`; not yet on Vercel (C7).
**C1/C2a - prerequisites inspected; RPC chosen.** No keystore, no admin address, no FARJI chain variables existed. A free public Sepolia endpoint, `https://ethereum-sepolia-rpc.publicnode.com` (no API key), was tested: `eth_chainId` = 0xaa36a7 (11155111) and the `finalized` block tag is supported. It is written to the git-ignored local `.env.local` (with `FARJI_CHAIN_ID`, `FARJI_FINALITY`). Not yet set on Vercel (set at C7). Nothing on Sepolia has been sent.

## Checkpoints ahead

- C1 prerequisites inspected (RPC URL, admin public address, keystore present?)  - C2 RPC + admin address available
- C3 deployer keystore created (public address only)  - C4 deployer funded with Sepolia test ETH
- C5 `chain:deploy:sepolia` executed, real registry address recorded  - C6 `chain:check` passes
- C7 Vercel Production chain variables set, production redeployed READY, verifier no longer "unavailable"
- C8 live MetaMask smoke: admin registers org -> authorises issuer wallet -> issuer binds wallet -> credential approved -> signed -> anchored
  -> PENDING -> CONFIRMED -> FINALIZED -> public state derived  - C9 documentation closed out (ROADMAP/CLAUDE/DEPLOYMENT)

## Blockers / next exact action

C8 smoke-test preparation findings (database counts only): 1 CANDIDATE and 1 ISSUER user exist (from development), NO ADMIN user exists,
1 ACTIVE organisation exists but it was activated in development and is NOT registered on the new Sepolia registry, and there are no
blockchain transactions. The admin wallet holds 0 Sepolia ETH.
Plan: (1) user funds the admin wallet with Sepolia ETH; (2) user signs up a new production account for the admin and Claude promotes it to
ADMIN with the SQL in docs/DEPLOYMENT.md section 2; (3) the admin creates a NEW organisation in the admin UI and registers it on-chain (MetaMask);
(4) admin authorises a separate issuer wallet; (5) link the existing ISSUER account to the new organisation; (6) issuer binds the wallet, a candidate
record is requested, approved, signed, batched and anchored; (7) wait for FINALIZED; (8) check the public verifier.
DONE: issuer wallet 0xce5a...441f authorised and FINALIZED (C10b).
PHASE 15 COMPLETE (C13). Nothing further is required for Phase 15. Remaining optional: a live CONTINUING (ProofPulse) example. Phase 16 not started.
DONE: wallet bound, credential signed + QUEUED_FOR_ANCHOR (C11a); batch sealed, anchor build verified (C11b).
Next exact action (human): as candidate001 on https://farji.vercel.app/issuer/cohort, click "Anchor this batch" on "Cohort 2026-10-22" and confirm in MetaMask with Account 2 (0xce5a...441f).
Then Claude finds the ANCHOR_COHORT BlockchainTransaction, verifies from/to/chain/status/AttestationAnchored event, syncs PENDING -> CONFIRMED -> FINALIZED, checks the mirrored
Anchor row + batch ANCHORED + credential ANCHORED, then sets the claim visibility and tests /verify/0xadb1...34ba (+ /bundle) for PERMANENT_VALID.

## Deployed facts (fill only from real runs)

- Registry address: 0xedd02dc8d15892df10e9d83f8fe7b9680ba2bef9 (Sepolia, chain 11155111)
- Deployer public address: 0x74F587Bd56909aE4c17B336aAD1DF40F86913620 (funded 0.05 Sepolia ETH; holds no contract authority after deployment)
- Admin public address: 0xbc6b026F15B1F574B1398C5DddA3181A745989ab
- Deployment transaction: 0xa2cee1ad19e8556e4f7660937ef2ef553dfb6348b8e289968a61103b293f97b5 (block 11964566)
- Issuer wallet (public): 0xce5a27f33df102e629c2b77a04c368901850441f; authorise tx 0xa1c3e2444266dd16b559732364230be4d84b9d31bc169acf51b46d86f54b2e5b (block 11969981, FINALIZED)
- Smoke-test progress: org registered + FINALIZED + ACTIVE; issuer wallet authorised + FINALIZED + IssuerKey mirrored; request approved; wallet bound; credential signed + QUEUED_FOR_ANCHOR; batch anchored (tx 0x8e37f49074bd9680138d527038f4dd4598a9edbdb089e6c7d1be656c2e970e8f, block 11970543) + FINALIZED; public verifier PERMANENT_VALID. COMPLETE.
