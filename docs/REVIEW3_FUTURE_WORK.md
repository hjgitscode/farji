# Review 3 — Deferred / Future Implementation

Everything below is intentionally **out of scope for Review 2**. It is
documented here so reviewers can see the production path exists, without
Review 2 time being spent building it.

## Hosting & deployment
- Vercel (or equivalent) production deployment of the Next.js app
- Production environment configuration and secrets management

## Data & backend
- Supabase (PostgreSQL) replacing `lib/mock-data` behind the existing
  `lib/services` abstraction layer — the service layer is designed in
  Review 2 specifically so this swap does not require UI changes
- Supabase Authentication for candidate/issuer/admin accounts
- Supabase Storage for any off-chain documents/attachments

## Blockchain
- Deployment to a public testnet (Ethereum Sepolia or Polygon Amoy)
- Gas cost analysis and optimisation for real network conditions
- Production key management for issuer wallets, ideally backed by an
  HSM or comparable secure signing infrastructure — Review 2 uses
  plain local Hardhat accounts, which is acceptable for a prototype but
  not for real institutional keys

## Integrations
- Real institutional ERP / student-information-system API integration
  (Review 2 uses mock ERP-shaped data instead)
- LinkedIn integration, where API permissions allow, for publishing
  verified claims

## Why these are deferred

Review 2's priority is demonstrating the technical architecture, the smart
contract, and the novel verification logic (ProofPulse, CohortProof,
lifecycle-aware states, chained attestations, key rotation) working
correctly end-to-end on a local Hardhat blockchain with mock data. None of
the items above change that logic — they are infrastructure and
integration work that makes the same design production-ready.
