# Review 2 Demo Script

> **Status: stub.** The full, rehearsed script — with exact page routes and
> exact contract function calls at each step — is written in **Phase 15**,
> once every feature it references actually exists.

## Planned flow (from the approved project plan)

1. Open the NotSoFarji website.
2. Show Candidate Dashboard.
3. Show the different lifecycle credential types (PERMANENT / CONTINUING / EXPIRING).
4. Open Issuer Dashboard.
5. Approve a credential.
6. Show the deterministic canonical credential.
7. Show its Keccak-256 hash.
8. Show the issuer's EIP-712 signature.
9. Create a graduation CohortProof.
10. Show multiple credentials becoming one Merkle root.
11. Anchor the root on the local Hardhat blockchain.
12. Verify an individual student's Merkle proof.
13. Create the August ProofPulse for active employees.
14. Show the candidate as `CURRENTLY_ATTESTED`.
15. Create the September ProofPulse excluding the candidate.
16. Show `STALE_NO_RECENT_ATTESTATION`.
17. Explicitly mark employment as ended.
18. Show `ENDED`.
19. Demonstrate issuer key rotation.
20. Show the old credential still valid, because the key was authorised
    when it was signed.
21. Revoke a credential.
22. Show the recruiter page reporting `REVOKED`.
23. Show the Solidity source code.
24. Explain the major functions.
25. Run the Hardhat test suite live.
