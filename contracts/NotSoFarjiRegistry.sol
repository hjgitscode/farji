// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NotSoFarjiRegistry
/// @notice On-chain registry for NotSoFarji: authorised issuers and their
/// signing keys, batch attestations (CohortProof/ProofPulse), and
/// credential revocations. This contract is deliberately the ONLY
/// contract in the project — see docs/ARCHITECTURE.md for why one small,
/// readable contract beats several small ones for a project both
/// developers need to explain line-by-line in viva.
/// @dev Blockchain is not the authority for real-world truth here — the
/// issuer is. This contract only preserves tamper-evident evidence of
/// what an authorised issuer attested, and when. No candidate personal
/// data is ever stored on-chain: everything here is commitments
/// (hashes, Merkle roots) and revocation flags, never claim content.
contract NotSoFarjiRegistry is AccessControl {
    // ---------------------------------------------------------------
    // Enums
    // ---------------------------------------------------------------

    /// @notice Which of NotSoFarji's two batch-attestation streams an
    /// anchored root belongs to. See docs/ARCHITECTURE.md sections 9-10.
    enum AttestationType {
        COHORT,
        PROOF_PULSE
    }

    // ---------------------------------------------------------------
    // Structs
    // ---------------------------------------------------------------

    struct Organisation {
        string name;
        bool registered;
    }

    /// @notice One entry in an organisation's append-only key history.
    /// `validUntil == 0` means "not yet revoked" — block.timestamp can
    /// never realistically be 0, so it is a safe sentinel.
    struct IssuerKeyRecord {
        bytes32 organisationId;
        address wallet;
        uint64 validFrom;
        uint64 validUntil;
        bool revoked;
    }

    /// @notice One anchored Merkle batch (a CohortProof or ProofPulse
    /// epoch), plus the chained-root fields that link it to the
    /// organisation's previous attestation of the same type.
    struct Attestation {
        bytes32 organisationId;
        AttestationType attestationType;
        uint64 epoch;
        bytes32 batchRoot;
        bytes32 previousChainRoot;
        bytes32 chainRoot;
        uint64 anchoredAt;
        address issuerWallet;
    }

    struct RevocationRecord {
        bool revoked;
        uint64 revokedAt;
        address issuer;
    }

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    mapping(bytes32 => Organisation) public organisations;

    /// @dev One active record per wallet. A wallet is never reused across
    /// organisations or re-authorised after being revoked — rotating to
    /// a fresh wallet (rotateIssuerKey) is the only supported path once a
    /// wallet is retired, matching real-world key-hygiene practice.
    mapping(address => IssuerKeyRecord) public issuerRecords;

    /// @dev Enumerable key history per organisation, for the Admin
    /// Dashboard's "View issuer key history" feature. Exposed read-only
    /// via getIssuerHistory().
    mapping(bytes32 => address[]) private issuerWalletsByOrg;

    /// @dev Current chain head per organisation + attestation stream.
    /// Exposed read-only via getCurrentChainRoot().
    mapping(bytes32 => mapping(AttestationType => bytes32)) private currentChainRoot;

    /// @dev organisationId => attestationType => epoch => Attestation.
    /// `anchoredAt == 0` means "this epoch has not been anchored yet",
    /// which is what makes duplicate-epoch submission rejectable.
    /// Exposed read-only via getAttestation().
    mapping(bytes32 => mapping(AttestationType => mapping(uint64 => Attestation))) private attestations;

    /// @dev organisationId => attestationType => epochs anchored so far,
    /// in submission order. Exposed read-only via getEpochs().
    mapping(bytes32 => mapping(AttestationType => uint64[])) private epochsByOrgAndType;

    mapping(bytes32 => RevocationRecord) public revocations;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event OrganisationRegistered(bytes32 indexed organisationId, string name);
    event IssuerAuthorised(bytes32 indexed organisationId, address indexed wallet, uint64 validFrom);
    event IssuerRevoked(bytes32 indexed organisationId, address indexed wallet, uint64 revokedAt);
    event IssuerKeyRotated(
        bytes32 indexed organisationId,
        address indexed oldWallet,
        address indexed newWallet,
        uint64 rotatedAt
    );
    event AttestationAnchored(
        bytes32 indexed organisationId,
        AttestationType attestationType,
        uint64 epoch,
        bytes32 batchRoot,
        bytes32 chainRoot,
        address indexed issuerWallet
    );
    event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer, uint64 revokedAt);

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ---------------------------------------------------------------
    // Admin: organisation + issuer registry (Phase 7)
    // ---------------------------------------------------------------

    function registerOrganisation(bytes32 organisationId, string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!organisations[organisationId].registered, "Organisation already registered");
        organisations[organisationId] = Organisation({name: name, registered: true});
        emit OrganisationRegistered(organisationId, name);
    }

    function authoriseIssuer(
        bytes32 organisationId,
        address wallet,
        uint64 validFrom
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(organisations[organisationId].registered, "Unknown organisation");
        require(issuerRecords[wallet].wallet == address(0), "Wallet already registered");

        issuerRecords[wallet] = IssuerKeyRecord({
            organisationId: organisationId,
            wallet: wallet,
            validFrom: validFrom,
            validUntil: 0,
            revoked: false
        });
        issuerWalletsByOrg[organisationId].push(wallet);

        emit IssuerAuthorised(organisationId, wallet, validFrom);
    }

    function revokeIssuer(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IssuerKeyRecord storage record = issuerRecords[wallet];
        require(record.wallet != address(0), "Unknown wallet");
        require(!record.revoked, "Wallet already revoked");

        record.revoked = true;
        record.validUntil = uint64(block.timestamp);

        emit IssuerRevoked(record.organisationId, wallet, record.validUntil);
    }

    /// @notice Retires `oldWallet` and authorises `newWallet` in its place,
    /// in one call. Historical signatures made by `oldWallet` before this
    /// moment remain evaluable via isIssuerValidAt — only the wallet's
    /// future use is cut off.
    function rotateIssuerKey(
        bytes32 organisationId,
        address oldWallet,
        address newWallet,
        uint64 newValidFrom
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IssuerKeyRecord storage oldRecord = issuerRecords[oldWallet];
        require(oldRecord.wallet != address(0), "Unknown old wallet");
        require(oldRecord.organisationId == organisationId, "Old wallet belongs to a different organisation");
        require(!oldRecord.revoked, "Old wallet already revoked");
        require(issuerRecords[newWallet].wallet == address(0), "New wallet already registered");

        oldRecord.revoked = true;
        oldRecord.validUntil = uint64(block.timestamp);

        issuerRecords[newWallet] = IssuerKeyRecord({
            organisationId: organisationId,
            wallet: newWallet,
            validFrom: newValidFrom,
            validUntil: 0,
            revoked: false
        });
        issuerWalletsByOrg[organisationId].push(newWallet);

        emit IssuerKeyRotated(organisationId, oldWallet, newWallet, uint64(block.timestamp));
    }

    /// @notice Was `wallet` an authorised issuer at `timestamp`? This is
    /// the check that makes a credential signed before a key rotation
    /// stay valid even after that key is later revoked — a signature is
    /// judged against the key's status AT ISSUANCE TIME, not today.
    function isIssuerValidAt(address wallet, uint64 timestamp) public view returns (bool) {
        IssuerKeyRecord memory record = issuerRecords[wallet];
        if (record.wallet == address(0)) return false;
        if (timestamp < record.validFrom) return false;
        if (record.validUntil != 0 && timestamp >= record.validUntil) return false;
        return true;
    }

    function getIssuerHistory(bytes32 organisationId) external view returns (address[] memory) {
        return issuerWalletsByOrg[organisationId];
    }

    // ---------------------------------------------------------------
    // Attestation anchoring: CohortProof + ProofPulse (Phases 9-11)
    // ---------------------------------------------------------------

    /// @notice Anchors one Merkle batch root for an organisation's
    /// CohortProof or ProofPulse stream, chaining it to that stream's
    /// previous root. Callable only by a wallet currently authorised for
    /// `organisationId` — anyone can call this function, but only an
    /// authorised issuer's call has any effect other than reverting.
    /// @dev `previousChainRoot` must equal the stream's current head,
    /// which is what makes a skipped or forked epoch detectable: an
    /// attacker (or a bug) submitting against the wrong prior root simply
    /// reverts, rather than silently forking the chain's history.
    function anchorAttestation(
        bytes32 organisationId,
        AttestationType attestationType,
        uint64 epoch,
        bytes32 batchRoot,
        bytes32 previousChainRoot
    ) external {
        require(isIssuerValidAt(msg.sender, uint64(block.timestamp)), "Caller is not a currently authorised issuer");
        require(issuerRecords[msg.sender].organisationId == organisationId, "Caller not authorised for this organisation");
        require(attestations[organisationId][attestationType][epoch].anchoredAt == 0, "Epoch already anchored");
        require(previousChainRoot == currentChainRoot[organisationId][attestationType], "Invalid previous chain root");

        bytes32 chainRoot = keccak256(
            abi.encode(batchRoot, previousChainRoot, organisationId, attestationType, epoch)
        );

        attestations[organisationId][attestationType][epoch] = Attestation({
            organisationId: organisationId,
            attestationType: attestationType,
            epoch: epoch,
            batchRoot: batchRoot,
            previousChainRoot: previousChainRoot,
            chainRoot: chainRoot,
            anchoredAt: uint64(block.timestamp),
            issuerWallet: msg.sender
        });

        currentChainRoot[organisationId][attestationType] = chainRoot;
        epochsByOrgAndType[organisationId][attestationType].push(epoch);

        emit AttestationAnchored(organisationId, attestationType, epoch, batchRoot, chainRoot, msg.sender);
    }

    function getAttestation(
        bytes32 organisationId,
        AttestationType attestationType,
        uint64 epoch
    ) external view returns (Attestation memory) {
        return attestations[organisationId][attestationType][epoch];
    }

    function getCurrentChainRoot(bytes32 organisationId, AttestationType attestationType) external view returns (bytes32) {
        return currentChainRoot[organisationId][attestationType];
    }

    function getEpochs(bytes32 organisationId, AttestationType attestationType) external view returns (uint64[] memory) {
        return epochsByOrgAndType[organisationId][attestationType];
    }

    // ---------------------------------------------------------------
    // Credential revocation (Phase 12)
    // ---------------------------------------------------------------

    /// @notice Marks a credential revoked. Revocation never deletes
    /// history — it adds a permanent, public negative assertion that a
    /// verifier checks alongside (not instead of) the original signature.
    /// @dev Known Review 2 simplification: this contract never stores
    /// which organisation a given credentialId belongs to (credential
    /// content, including its owning org, lives entirely off-chain by
    /// design — see docs/ARCHITECTURE.md section 5). So any currently
    /// authorised issuer, from any organisation, can revoke any
    /// credentialId. A production version would track credential-to-
    /// organisation ownership on anchoring so revocation could be
    /// restricted to the issuing org — deferred to Review 3.
    function revokeCredential(bytes32 credentialId) external {
        require(isIssuerValidAt(msg.sender, uint64(block.timestamp)), "Caller is not a currently authorised issuer");
        require(!revocations[credentialId].revoked, "Credential already revoked");

        revocations[credentialId] = RevocationRecord({
            revoked: true,
            revokedAt: uint64(block.timestamp),
            issuer: msg.sender
        });

        emit CredentialRevoked(credentialId, msg.sender, uint64(block.timestamp));
    }

    function isCredentialRevoked(bytes32 credentialId) external view returns (bool) {
        return revocations[credentialId].revoked;
    }
}
