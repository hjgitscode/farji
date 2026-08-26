# NotSoFarji

*Because your resume should not be farji.*

A lifecycle-aware blockchain verification system for professional claims —
built as a university Innovative Design Project.

**Developers:** Hemang Josan, Keshav Gupta

## What this is

Most blockchain credential systems answer "was this credential valid when it
was issued?" NotSoFarji asks whether verification can evolve from a static
proof of issuance into a **lifecycle-aware proof of professional state over
time** — distinguishing credentials that are permanently true (a degree),
continuing to be true (current employment), or true until a known expiry
(a licence or certification).

Full concept, novelty scope, and design rationale: see `docs/ARCHITECTURE.md`.

## Project status

Currently in **Review 2** scope: local prototype only. See
`docs/REVIEW3_FUTURE_WORK.md` for everything intentionally deferred
(production hosting, real ERP/LinkedIn integration, testnet deployment, etc).

Build phases and progress are tracked against the Review 2 build plan in
`docs/ARCHITECTURE.md`. This scaffold represents **Phase 1**.

## Quick start

```bash
npm install

# Web app (Next.js)
npm run dev

# Local blockchain + contract (Hardhat)
npm run hardhat:node        # in one terminal
npm run hardhat:compile
npm run hardhat:test
npm run hardhat:deploy:local

# Tests
npm run hardhat:test        # Solidity/contract tests
npm run test:unit           # TypeScript unit tests (crypto, merkle, state machine)

# Checks
npm run lint
npm run typecheck
```

## Repository layout

```
app/            Next.js pages (App Router)
components/     UI components
lib/crypto/     Canonicalisation, Keccak-256, EIP-712
lib/merkle/     Merkle tree + proof engine
lib/verification/ Lifecycle state machine
lib/mock-data/  Review 2 demo data
lib/services/   Data-access abstraction (swaps for Supabase in Review 3)
lib/contract/   ethers.js bindings to the deployed contract
contracts/      NotSoFarjiRegistry.sol
scripts/        Hardhat deploy + demo seed scripts
test/contract/  Hardhat/Solidity tests
test/unit/      TypeScript unit tests
docs/           Architecture, Solidity explanation, viva prep, demo script
```

Each directory currently contains a `README.md` stub noting which build
phase populates it — see `docs/ARCHITECTURE.md` for the full phase plan.

## Documentation

- `docs/ARCHITECTURE.md` — full system architecture and Review 2 build plan
- `docs/SOLIDITY_EXPLANATION.md` — plain-language walkthrough of the smart contract
- `docs/SOLIDITY_VIVA.md` — likely viva questions and concise answers
- `docs/DEMO_SCRIPT.md` — the Review 2 live demonstration flow
- `docs/REVIEW3_FUTURE_WORK.md` — everything deferred to Review 3

## Important framing

Established cryptographic primitives (hashing, ECDSA, EIP-712, Merkle trees,
blockchain anchoring) are used but are **not** claimed as this project's
novelty. The contribution is the application-level design on top of them —
see `docs/ARCHITECTURE.md` for the explicit established-vs-novel split.

Blockchain is not treated as the authority for real-world truth. The issuer
establishes real-world truth; the blockchain preserves tamper-evident
evidence of the issuer's attestation.
