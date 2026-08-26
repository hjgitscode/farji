# Solidity Contract Explanation — `NotSoFarjiRegistry.sol`

> **Status: stub.** This document is fully written in **Phase 14**, once the
> contract (Phase 6-7) and its supporting logic (Phases 8-12) exist. It will
> explain every major section in plain, student-friendly language so both
> developers can present it during the Review 2 viva without memorising
> anything they don't actually understand.

## Planned structure

For every major function, this document will cover:

1. What the function does
2. Who is allowed to call it
3. Parameters
4. What state changes
5. Why blockchain is required here
6. Security concern it solves
7. Example input
8. Example result

## Sections to be written

- Issuer Registry (`registerOrganisation`, `authoriseIssuer`, `revokeIssuer`)
- Key Rotation (`rotateIssuerKey`, `isIssuerValidAt`)
- Attestation Anchoring (`anchorAttestation`, chain continuity check)
- Credential Revocation (`revokeCredential`, `isCredentialRevoked`)
- Events and why each one exists
- Access control model (`AccessControl` for admin vs. time-bounded issuer
  validity for issuers — and why these are different mechanisms)

See `docs/ARCHITECTURE.md` section 6 for the current contract design
(structs, mappings, enums, events, function list) that this document will
expand on once implemented.
