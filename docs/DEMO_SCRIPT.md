# Review 2 Demo Script

A rehearsed, step-by-step walkthrough against the actual application —
every route and button below exists and works as described.

## Before you present: one-time checklist

Run these once, ahead of time, so nothing surprises you live:

```bash
npm install
npm run hardhat:compile   # compiles NotSoFarjiRegistry.sol
npm run hardhat:test      # runs the full contract test suite
npm run test:unit         # runs the crypto/merkle/state-machine tests
npm run build             # production build of the Next.js app
```

**Note on `hardhat:compile`:** the first time you run it, Hardhat
downloads the Solidity compiler from the public internet
(`binaries.soliditylang.org`) — this needs a normal internet connection
and only happens once (it's cached after that). If you're demoing from a
machine with restricted network egress, run this step somewhere normal
first and let the compiler cache carry over, or confirm ahead of time
that this host isn't blocked.

Then start the app for the actual demo:

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## 1. Introduce the project

**Home page (`/`).** State the tagline and the one-sentence pitch: a
lifecycle-aware blockchain verification system — most systems only prove
a credential was valid *when issued*; NotSoFarji tracks whether it's
still true *now*, differently depending on what kind of claim it is.

## 2. Candidate Dashboard — the three lifecycle types

**`/candidate`.** Aarav Sharma has five claims. Point out:
- **B.Tech Computer Science** — `PERMANENT`, state `Permanently valid`.
- **Software Engineer at XYZ Technologies Demo** — `CONTINUING`, state
  `Currently attested`.
- **Blockchain Developer Certification** — `EXPIRING`, state `Verified`
  (not yet expired).
- **Junior Developer at PQR Innovations Demo** — `CONTINUING`, state
  `Ended`.
- **Summer Research Intern** — `PERMANENT`, state `Revoked`.

These states are **not hardcoded** — expand any claim's actions and open
**View Proof** to show the real Keccak-256 claim hash, or **View
History** to show the real attestation epochs behind it.

## 3. Issuer Dashboard — approval, hashing, signing

**`/issuer`.** Priya Mehta's Frontend Engineer claim is pending.

1. Expand **"Canonical credential + hash"** — this is the real,
   deterministic canonicalisation (`lib/crypto/canonicalise.ts`): fixed
   field order, uppercased enums, explicit `null`. Point out the
   Keccak-256 hash underneath it — also real (`lib/crypto/hash.ts`).
2. Click **Sign (EIP-712)** — a real signature is produced with the
   organisation's current demo wallet, then immediately verified by
   recovering the signer address and checking it against the issuer
   registry. The green "Recovered signer matches issuer wallet" badge is
   a genuine cryptographic check, not a canned response.
3. Click **Approve**.

## 4. CohortProof — one attestation for a whole cohort

**`/issuer`**, scroll to **"Create CohortProof."** Select a few students
and click **Create CohortProof** — a real Merkle tree is built
(`lib/merkle`) from the selected claims' real hashes.

Then go to **`/cohortproof`** for the fully worked version: the 2026
Graduation Cohort (four students, one of them Aarav's real degree claim)
built into one Merkle tree and root. Expand **"Show Merkle proof"** for
Student B — this proof is genuinely computed and independently
re-verified against the root (`MerkleTree.verify`), shown live as
`VALID`.

## 5. ProofPulse — and why absence isn't "ended"

**`/proofpulse`.** This page is the core novelty demonstration.

1. Point to the **August 2026 ProofPulse** batch — Credential B is
   Aarav's real employment claim, included in this batch.
2. Point to the **September 2026 ProofPulse** batch — Credential B is
   missing.
3. Read the status card: Credential B shows
   **`STALE_NO_RECENT_ATTESTATION`**, with the explanation that this
   means only "not recently re-attested," never an inferred "employment
   ended."
4. Click **"End Employment (explicit issuer action)"** — the state
   changes to **`ENDED`**, and the explanation text changes to say this
   only happened because of the explicit action just taken, not the
   missed ProofPulse. This is the single most important distinction to
   narrate clearly — it's the project's headline research contribution.

## 6. Issuer key rotation — old signatures stay valid

**`/verify/CRED-002`** (Aarav's employment credential). Expand
**Technical Proof** and point out:
- **Issuer Authorised at Issuance: YES** — even though, on
  **`/admin`**, XYZ Technologies Demo's *original* wallet now shows
  **REVOKED** in the Issuer Key History table (it was rotated away in
  January 2027). The credential was signed in June 2026, while that
  wallet was still valid — `isIssuerValidAt` checks the wallet's status
  *at the time of signing*, not today.

Optionally, demonstrate the mechanism live on **`/admin`**: pick an
organisation, enter a new wallet address, click **Rotate Key** — the old
wallet immediately shows `REVOKED` in the table below, the new one
`ACTIVE`, with no gap in the history.

## 7. Revocation

**`/issuer`**, scroll to **"Revoke Credential."** Type `CRED-005` and
click **Revoke** — watch it appear in the revoked list.

Then **`/verify/CRED-005`** — the recruiter-facing report shows
**Revocation: YES** and **Current Verification State: REVOKED**, while
the claim's original signature and hash are still shown intact
underneath — revocation adds a fact, it doesn't erase history.

## 8. Public recruiter verification — no login required

**`/verify`.** Emphasise: no login, no wallet, no crypto knowledge
needed. Type any credential ID (or click one of the listed demo
credentials) and show the full report: issuer signature, claim
integrity, issuer authorisation, CohortProof/ProofPulse status,
blockchain anchor, revocation, and the overall current state — then
expand **Technical Proof** for the underlying hash/wallet/root data.

## 9. The smart contract

**`/contract-explorer`.** Walk through each section (Issuer Registry,
Key Rotation, Attestation Anchoring, Credential Revocation, ProofPulse,
CohortProof) — real snippets from `contracts/NotSoFarjiRegistry.sol`
alongside plain-language explanations.

Then, in a terminal:

```bash
npm run hardhat:test
```

Run the suite live — issuer authorisation, unauthorised rejection, key
rotation and historical validity, attestation chaining, invalid
previous-chain-root rejection, duplicate-epoch rejection, and
revocation, all passing against the real deployed contract on Hardhat's
local network.

If asked "why should we trust this contract," walk through
`docs/SOLIDITY_EXPLANATION.md` for any function the panel wants explained
in more depth, and `docs/SOLIDITY_VIVA.md` for the 35 prepared
question-and-answer pairs.

## 10. Novelty and architecture (closing)

**`/novelty`** — the explicit split between established cryptography
(Keccak-256, ECDSA, EIP-712, Merkle trees, blockchain anchoring — not
our invention) and NotSoFarji's actual design contributions (ProofPulse,
CohortProof, lifecycle-aware states, chained attestations, time-aware
issuer keys, claim versioning).

**`/technology`** — the layered architecture diagram, and what's
explicitly deferred to Review 3 (Supabase, testnet deployment, real ERP
integration, production key management).

**`/developers`** — close with the team.
