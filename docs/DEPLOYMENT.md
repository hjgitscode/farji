# FARJI deployment guide (Phases 14-15)

This guide takes FARJI from a local checkout to a hosted application (Vercel + the existing Supabase project) backed by a
real contract on **Sepolia**. It contains no secret values: every secret is entered in a dashboard or typed at a hidden
prompt, never committed.

**What the repository already does for you**: validates the environment (`npm run env:check`), builds for Vercel, protects and
schedules the chain sync, checks that the RPC really is Sepolia and the registry address really holds a contract, refuses
depth-based finality on Sepolia, refuses Ethereum mainnet, and ships Sepolia deploy / read-only check scripts.
**What only you can do**: create the Vercel project, set its environment, fund and use a deployer wallet, and click through
MetaMask.

---

## 1. Environment matrix

Set these in **Vercel > Project > Settings > Environment Variables (Production)**. For local work use `.env.local`.
`npm run env:check` validates by name and rule and never prints a value.

| Variable | Required | Visible to browser | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | no | Supabase **Transaction pooler** string (port 6543). Runtime database access. |
| `DIRECT_URL` | for migrations | no | Session pooler / direct string (port 5432). Used only by `npm run db:migrate`, run from your machine, not by the Vercel build. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes (public) | `https://<project-ref>.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | yes (public) | `sb_publishable_...`. The legacy name `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted. A secret / service-role key is **refused** by the app. |
| `NEXT_PUBLIC_APP_URL` | yes | yes (inlined at build) | Site origin for email-confirmation links, e.g. `https://farji.example`. No path. If unset in production it falls back to `FARJI_PUBLIC_URL`, then Vercel's production host. |
| `FARJI_PUBLIC_URL` | recommended | no | Authoritative origin for share links, QR codes and evidence links. Same origin as `NEXT_PUBLIC_APP_URL`. When set, a forged `Host` header cannot change a share link. |
| `FARJI_CHAIN_ID` | yes | no | `11155111` (Sepolia). Mainnet and unknown chains are refused. |
| `FARJI_REGISTRY_ADDRESS` | yes | no | The deployed `FarjiRegistry` address. |
| `FARJI_RPC_URL` | yes | no | Any standard Sepolia JSON-RPC https URL. It may contain a provider key, so it is server-only. No paid service is required; a free public Sepolia endpoint works. |
| `FARJI_FINALITY` | yes | no | `finalized`. Anything else is refused on Sepolia. |
| `FARJI_ADMIN_WALLET` | deployment | no | **Public** address of the Admin's MetaMask wallet. Used by the deploy and check scripts. |
| `FARJI_DEFAULT_ADMIN` | optional | no | Public address allowed to grant/revoke the platform-admin role (defaults to `FARJI_ADMIN_WALLET`). |
| `FARJI_ADMIN_DELAY_SECONDS` | optional | no | Admin-role change delay; at least 86400 on Sepolia (default 86400). |
| `FARJI_SYNC_TOKEN` | yes | no | 32+ random characters. Protects `/api/chain/sync`. |
| `CRON_SECRET` | for Vercel Cron | no | Platform variable. Set it to the **same value** as `FARJI_SYNC_TOKEN`; Vercel Cron then sends it as the bearer token. FARJI never reads `CRON_SECRET` itself. |
| `FARJI_APP_URL` | tooling | no | Origin that `npm run chain:sync` and the optional GitHub Action call. |
| `FARJI_TRUST_PROXY` | optional | no | `1` to believe `X-Forwarded-For` for rate limiting outside Vercel. Leave unset on Vercel (it is detected). |
| `FARJI_DEPLOYER_KEYSTORE` | optional | no | Path of the encrypted deployer keystore (default `.keystore/deployer.json`). |
| `FARJI_CHECK_MODE` | optional | no | `development` makes `env:check` accept a local setup. |

Never set: any private key, mnemonic, Supabase service-role/secret key, or any `NEXT_PUBLIC_` variable holding a database, RPC or
token value. The validator reports each of these as an error.

## 2. Supabase production settings (existing project; do not create another)

Dashboard settings the application depends on (these cannot be changed from code):

1. **Authentication > URL Configuration**: *Site URL* = your production origin (`FARJI_PUBLIC_URL`); *Redirect URLs* must include
   `https://<your-domain>/auth/callback` (the email-confirmation landing route). Add a preview wildcard only if you use previews.
2. **Authentication > Providers > Email**: turn **Confirm email ON** for production. (It was turned off during development because the
   default SMTP did not deliver mail.)
3. **Custom SMTP** (Authentication > SMTP Settings). Supabase's built-in sender is rate-limited and not meant for production.
   Fill in: *Sender email*, *Sender name*, *Host*, *Port*, *Username*, *Password*, and *Minimum interval between emails*. Use a provider you
   control (any SMTP service). **Until this is configured**, keep confirmation off (the current test/demo path) or expect confirmation
   emails to be slow or dropped; the application itself works either way. Do not paste SMTP credentials into the repository.
4. **Database**: the app talks to Postgres through Prisma with `DATABASE_URL` (pooler). All FARJI tables have **row-level security
   enabled with no policies**, so the public Data API (anon key) can read nothing; the server reaches the data through its own
   connection. Do not add policies. Since Phase 16 the migration `20261022180000_lock_down_data_api` also enables RLS on Prisma's
   `_prisma_migrations` and removes every `anon` / `authenticated` privilege in `public` (an anonymous Data API call now gets 401).
   If you do not use the Data API at all, you may also disable it (Settings > API).
5. **Migrations** are applied by you, not by the Vercel build: `npm run db:migrate` (uses `DIRECT_URL`). Phase 16 added one (above).
6. **Leaked-password protection** (Authentication > password security / attack protection): enable it if your plan offers it.
7. **Backups**: confirm the project's backup / PITR setting matches your plan before real data arrives.

**Provisioning issuer and admin accounts** (no UI yet; decision D33): everyone signs up as a CANDIDATE. To promote an account, copy its
*UID* from Authentication > Users and run in the SQL editor (once per person):

```sql
update "User" set role = 'ADMIN'  where "authUserId" = '<auth-uid>';
-- an issuer additionally needs an active membership of an ACTIVE or PENDING organisation:
update "User" set role = 'ISSUER' where "authUserId" = '<auth-uid>';
insert into "OrganisationMember" (id, "userId", "organisationId", status, "joinedAt", "updatedAt")
select gen_random_uuid(), u.id, '<organisation-id>'::uuid, 'ACTIVE', now(), now() from "User" u where u."authUserId" = '<auth-uid>';
```

Roles are read from this table only; nothing in Supabase metadata can grant one.

## 3. Vercel

1. Import the repository as a Next.js project. Framework preset: **Next.js**. Node.js: **22.x or newer** (see `engines`). The default build
   command (`npm run build`) is correct; `npm install` runs `prisma generate` automatically (`postinstall`).
2. Add the variables from section 1 to **Production** (and only what a preview needs to **Preview**, with its *own* registry, never production's).
3. `vercel.json` registers one cron job: `GET /api/chain/sync` once a day. Vercel Hobby allows only daily cron jobs; a faster schedule on
   Hobby fails the deployment. Set `CRON_SECRET` = `FARJI_SYNC_TOKEN`.
4. For frequent sync without paying: the optional GitHub Action `.github/workflows/chain-sync.yml` calls the same endpoint every 10 minutes.
   Enable it by adding repository secrets `FARJI_APP_URL` and `FARJI_SYNC_TOKEN` and the repository variable `FARJI_SYNC_ENABLED=true`.
   Users can also press **Check status** on any transaction at any time, which syncs it on demand. **Recommended on Hobby**: without it,
   a transaction becomes final in FARJI only at the daily run or when someone presses Check status.
5. After the first deploy: open `/api/health`, `/verify`, sign up a test candidate, and read the Vercel function logs: on start the app prints
   `[farji:config]` lines naming any invalid setting (never a value).
6. **Rate limiting.** The application includes a per-instance limiter on the verifier lookup, verifier/profile pages, evidence download, sync
   endpoint (including failed-token attempts), import, and (Phase 16) password sign-in and sign-up. **It is not distributed**: each serverless instance counts separately and counters
   reset when an instance is recycled, so it only brakes bursts against a warm instance. Add platform rules for real protection: Vercel
   Firewall > Rate Limiting, e.g. `/api/chain/sync` 10/min per IP; `/verify*` and `/p/*` 60/min per IP; `/verify/*/bundle` 20/min per IP.
   Credential references are 32-byte unguessable values and private/unknown/malformed answer identically, so enumeration is not practical.

## 4. Sepolia deployment

Prerequisites: a Sepolia RPC URL, the public address of the Admin's MetaMask wallet, and a few Sepolia test ETH for a **throw-away deployer**.

```bash
# 1. environment (in .env.local): FARJI_RPC_URL=<sepolia https url>, FARJI_ADMIN_WALLET=<admin public address>
npm run env:check            # optional sanity check (chain variables are not set yet - that is expected)
npm run compile && npm run test:contracts

# 2. create an ENCRYPTED deployer keystore (generates a fresh key; prints only the address)
npm run chain:keystore -- new

# 3. fund the printed deployer address from a Sepolia faucet

# 4. deploy (asks for the keystore password with hidden input and a typed confirmation; refuses mainnet)
npm run chain:deploy:sepolia
```

The script deploys with `defaultAdmin = FARJI_DEFAULT_ADMIN or FARJI_ADMIN_WALLET` and `platformAdmin = FARJI_ADMIN_WALLET`, so the
deployer key holds **no authority** afterwards. It verifies code, roles and bytecode by read calls, writes `deployments/sepolia.json`
(git-ignored) and prints the three lines to set:

```
FARJI_CHAIN_ID=11155111
FARJI_REGISTRY_ADDRESS=<printed address>
FARJI_FINALITY=finalized
```

Put them in Vercel (Production) and `.env.local`, then confirm the wiring (read-only, sends nothing):

```bash
npm run chain:check          # chain id, code at the address, bytecode match, admin role, finalized tag support
npm run env:check            # full production matrix
```

Redeploy on Vercel so the new variables take effect. **The contract is non-upgradeable and every signature is bound to its chain id
and address**: deploying a different registry later means a new environment (new address, fresh evidence), not a patch.

## 5. Finality (do not shortcut)

- **PENDING**: the server knows the hash. **CONFIRMED**: mined successfully (tracking only; it proves nothing yet).
  **FINALIZED**: only when Sepolia's `finalized` block covers the transaction's block (roughly 13 minutes after inclusion).
- The anchor, revocation, issuer-key mirror and `ANCHORED` are written **only** at FINALIZED, in the same database transaction as the
  status change. The public verifier therefore shows *pending* until then. `depth:N` is refused for Sepolia.
- The sync endpoint, a cron run or **Check status** move rows forward; they are idempotent and safe to repeat.

## 6. Live MetaMask smoke test (the first real end-to-end run)

Use Chrome with MetaMask on **Sepolia**. Wallets: **A** = admin wallet (`FARJI_ADMIN_WALLET`), **B** = a different issuer wallet funded with test ETH.
Accounts: a candidate, an issuer and an admin (promote two accounts with the SQL in section 2).

**A. Admin** (signed in as admin, wallet A connected)
1. Admin > Organisations: add an organisation. Open it, **Register organisation** and approve in MetaMask. Activity shows *Pending*, then *Recorded, not final*, then *Final* (use **Check status**; wait for finality).
2. Once ACTIVE: **Authorise wallet** with wallet B's address; approve in MetaMask; wait until final.
3. Link the issuer account to the organisation (SQL, section 2).

**B. Issuer** (signed in as the issuer, wallet B connected)
4. Wallet > **Connect wallet and prove control**: sign the message; the wallet shows *Yours*.
5. As the candidate: add a record, request verification from the organisation. As the issuer: Requests > approve.
6. Credentials > **Sign credential** (MetaMask shows the readable record). It moves to *Queue*.
7. For a permanent/expiring record: Batches > **Close this batch**, then **Anchor this batch** (wallet B). For a current record: Current relationships > **Confirm current relationships**.
   On Credentials, *Anchor* is only the progress label of a queued credential, not a button; **Anchor this batch** appears on Batches once the batch is closed.
   Click it once: while that transaction is in progress a second click is refused by the server before the wallet opens (the page then shows a generic wallet message).

**C. Chain**
8. Activity: the anchor transaction goes *Pending* > *Recorded, not final* > *Final*. Until Final the candidate's record must still read *Verification in progress*.

**D. Candidate and public**
9. After Final: the candidate's record shows *Verified historical credential* (or *Currently confirmed*). Set the record to *On my public profile* (or shared by link).
10. Open the verification link in a private window: it shows the state and, under **View verification details**, Sepolia, the registry address and the transaction hash. Download the evidence JSON and confirm it holds no private fields.
11. (Optional) End the relationship or revoke and confirm the public state changes only after that transaction is Final.

Record the registry address, the organisation, the transaction hashes and the verifier URL in your own notes. The first live run (Phase 15, Sepolia)
passed every step above except the optional step 11; its public chain facts are listed under Phase 15 in docs/ROADMAP.md.

## 7. Security notes

- No private key exists in the repository or the application. The deployer key lives only in an encrypted local keystore and is used for one command.
- `FARJI_SYNC_TOKEN` is read only by the sync route; the endpoint compares in constant time, slows repeated wrong guesses and returns no detail.
- Supabase session cookies are HttpOnly, SameSite=Lax and Secure in production. Every private page re-checks the role on the server.
- The browser supplies only an account, a signature and a transaction hash; the server rebuilds and re-checks everything against its own RPC, which it first proves is the configured chain with a contract at the configured address.
- Response headers (`config/security-headers.ts`) include an enforced Content-Security-Policy (own origin only, plus the Supabase project
  origin for `connect-src`; no framing; `'unsafe-inline'` scripts kept for Next.js, nonce-based CSP deferred), `X-Frame-Options: DENY`,
  `nosniff`, a strict referrer policy, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` and HSTS. If a future
  feature needs another origin (an RPC from the browser, analytics, fonts), add it there deliberately. Findings: docs/PHASE16_SECURITY.md.

## 8. Rollback and redeploy

- **Application**: Vercel > Deployments > *Instant Rollback* to the previous deployment. Configuration changes need a redeploy to take effect.
- **Database**: migrations are additive and applied by hand. Take a Supabase backup before any later migration. The Phase 16 privilege
  migration changes no data; to undo it, re-grant the roles in the SQL editor (not recommended: it re-opens the Data API).
- **Sync**: if sync misbehaves, remove `FARJI_SYNC_TOKEN` (the endpoint then refuses everything); users can still press *Check status*.
- **Wrong network or address**: the app refuses to read or build until `FARJI_CHAIN_ID`, `FARJI_RPC_URL` and `FARJI_REGISTRY_ADDRESS` agree; fix the variables and redeploy.
- **Registry**: it cannot be upgraded; see section 4.
