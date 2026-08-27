// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NotSoFarjiRegistry
/// @notice On-chain registry for NotSoFarji: authorised issuers and their
/// signing keys, batch attestations (CohortProof/ProofPulse), and
/// credential revocations. See docs/ARCHITECTURE.md for the full design
/// and docs/SOLIDITY_EXPLANATION.md for a plain-language walkthrough of
/// every function once they exist.
/// @dev Phase 6 skeleton: only access control exists so far. The issuer
/// registry and key rotation are added in Phase 7, attestation anchoring
/// in Phases 9-11, and revocation in Phase 12 — each on top of this same
/// contract, never a separate one (see the "one understandable contract"
/// requirement in docs/ARCHITECTURE.md).
contract NotSoFarjiRegistry is AccessControl {
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
}
