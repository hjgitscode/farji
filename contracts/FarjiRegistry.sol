// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title FarjiRegistry
 * @notice Tamper-evident evidence of WHAT an authorised issuer attested and WHEN. It does not
 *         prove that a degree, job or licence is true: that is known only to the Organisation.
 *
 * Stores commitments and minimal metadata only. It holds NO candidate personal data, NO raw
 * credential content, NO subject identity and NO private salt (contentSalt / subjectSalt never
 * reach the chain; credentialSalt is published only when a credential is revoked).
 *
 * Non-upgradeable by design: no proxy, no delegatecall, no selfdestruct.
 *
 * Authority model
 *  - PLATFORM_ADMIN_ROLE (admin wallets) governs Organisations and issuer wallets. An admin can
 *    NEVER anchor, sign or revoke, and an admin wallet can never be an issuer wallet.
 *  - An issuer wallet is authorised for ONE Organisation during ONE validity period
 *    [validFrom, validUntil). A retired or compromised wallet is never re-authorised.
 *  - Anchors form independent hash chains per (Organisation, attestation type).
 *  - credentialId = keccak256(abi.encode(CREDENTIAL_ID_TAG, orgId, credentialSalt)) is rebuilt
 *    here from the CALLER'S OWN orgId, so an Organisation can only ever revoke ids in its own
 *    namespace (the old FARJI weakness - any issuer revoking any credential - cannot recur).
 */
contract FarjiRegistry is AccessControlDefaultAdminRules {
    // ───────────────────────────── types ─────────────────────────────

    enum OrgStatus {
        NONE,
        ACTIVE,
        SUSPENDED
    }

    /// @dev Order is part of the ABI contract with lib/crypto/constants.ts (COHORT 0, PROOF_PULSE 1).
    enum AttestationType {
        COHORT,
        PROOF_PULSE
    }

    struct Organisation {
        OrgStatus status;
        uint64 registeredAt;
        bytes32 metadataHash;
    }

    /// @dev One record per wallet, ever. 0 means "unset" for validUntil / compromisedAt.
    struct IssuerKey {
        bytes32 orgId;
        uint64 validFrom;
        uint64 validUntil;
        uint64 compromisedAt;
    }

    struct ChainHead {
        bytes32 chainRoot;
        uint64 epoch; // 0 = empty chain
    }

    struct Anchor {
        bytes32 orgId;
        AttestationType attestationType;
        bytes32 batchRoot;
        bytes32 previousChainRoot;
        uint64 epoch;
        uint64 rootSeq; // PROOF_PULSE only
        uint32 leafCount;
        bytes32 schemaId; // COHORT only
        address anchoredBy;
        uint64 anchoredAt;
    }

    struct Revocation {
        bytes32 orgId;
        uint64 revokedAt;
        uint16 reasonCode;
        address revokedBy;
    }

    // ───────────────────────────── constants & storage ─────────────────────────────

    bytes32 public constant PLATFORM_ADMIN_ROLE = keccak256("PLATFORM_ADMIN_ROLE");
    /// @dev Must equal CREDENTIAL_ID_TAG in lib/crypto/constants.ts.
    bytes32 public constant CREDENTIAL_ID_TAG = keccak256("FARJI_CREDENTIAL_ID_V1");

    uint16 public constant REASON_ISSUED_IN_ERROR = 1;
    uint16 public constant REASON_FRAUD = 2;
    uint16 public constant REASON_RECORD_CORRECTED = 3;
    uint16 public constant REASON_OTHER = 4;

    mapping(bytes32 orgId => Organisation) public organisations;
    mapping(address wallet => IssuerKey) public issuerKeys;
    mapping(bytes32 orgId => mapping(AttestationType => ChainHead)) public chainHeads;
    /// @dev Append-only: keyed by chainRoot, never overwritten (a chainRoot commits to its epoch).
    mapping(bytes32 chainRoot => Anchor) public anchors;
    mapping(bytes32 orgId => mapping(AttestationType => mapping(uint64 epoch => bytes32 chainRoot))) public chainRootAt;
    mapping(bytes32 orgId => uint64 rootSeq) public lastPulseRootSeq;
    mapping(bytes32 orgId => bytes32 root) public lastPulseRoot;
    mapping(bytes32 credentialId => Revocation) public revocations;

    bool public anchoringPaused;

    // ───────────────────────────── errors ─────────────────────────────

    error ZeroAddress();
    error OrganisationAlreadyRegistered(bytes32 orgId);
    error OrganisationNotRegistered(bytes32 orgId);
    error OrganisationNotActive(bytes32 orgId);
    error InvalidStatus();
    error StatusUnchanged();
    error WalletAlreadyKnown(address wallet);
    error WalletUnknown(address wallet);
    error WalletNotOpen(address wallet);
    error WalletBelongsToOtherOrganisation(address wallet);
    error WalletIsAdmin(address wallet);
    error KeyNotYetEstablished(address wallet);
    error InvalidCompromiseTime();
    error NotOpenIssuerOf(bytes32 orgId, address caller);
    error AnchoringIsPaused();
    error AnchoringNotPaused();
    error ZeroRoot();
    error ZeroLeafCount();
    error StaleChainHead(bytes32 current, bytes32 expected);
    error PulseRootSeqTooLow(uint64 given, uint64 last);
    error PulseRootMismatch(bytes32 given, bytes32 last);
    error AnchorAlreadyExists(bytes32 chainRoot);
    error AlreadyRevoked(bytes32 credentialId);
    error InvalidReason(uint16 reasonCode);

    // ───────────────────────────── events ─────────────────────────────

    event OrganisationRegistered(bytes32 indexed orgId, bytes32 metadataHash);
    event OrganisationStatusChanged(bytes32 indexed orgId, OrgStatus status);
    event IssuerWalletAuthorised(bytes32 indexed orgId, address indexed wallet, uint64 validFrom);
    event IssuerWalletRetired(bytes32 indexed orgId, address indexed wallet, uint64 validUntil);
    event IssuerWalletRotated(bytes32 indexed orgId, address oldWallet, address newWallet);
    event IssuerWalletCompromised(bytes32 indexed orgId, address indexed wallet, uint64 compromisedAt, uint64 validUntil);
    event CohortRootAnchored(
        bytes32 indexed orgId,
        bytes32 indexed chainRoot,
        uint64 epoch,
        bytes32 batchRoot,
        bytes32 previousChainRoot,
        uint32 leafCount,
        bytes32 schemaId,
        address anchoredBy
    );
    event ProofPulseEpochAnchored(
        bytes32 indexed orgId,
        bytes32 indexed chainRoot,
        uint64 epoch,
        bytes32 batchRoot,
        bytes32 previousChainRoot,
        uint64 rootSeq,
        uint32 leafCount,
        address anchoredBy
    );
    event CredentialRevoked(
        bytes32 indexed credentialId,
        bytes32 indexed orgId,
        uint16 reasonCode,
        address revokedBy,
        bytes32 credentialSalt
    );
    event AnchoringPaused(address by);
    event AnchoringUnpaused(address by);

    // ───────────────────────────── construction ─────────────────────────────

    /**
     * @param adminDelay      seconds before a DEFAULT_ADMIN transfer takes effect (0 on local nodes).
     * @param defaultAdmin    holder of DEFAULT_ADMIN_ROLE: only grants/revokes PLATFORM_ADMIN_ROLE.
     * @param platformAdmin   first PLATFORM_ADMIN_ROLE holder (the Admin's browser wallet).
     */
    constructor(uint48 adminDelay, address defaultAdmin, address platformAdmin) AccessControlDefaultAdminRules(adminDelay, defaultAdmin) {
        if (platformAdmin == address(0)) revert ZeroAddress();
        _grantRole(PLATFORM_ADMIN_ROLE, platformAdmin);
    }

    /// @dev An issuer wallet can never hold an admin role (admins cannot anchor, sign or revoke).
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (issuerKeys[account].orgId != bytes32(0)) revert WalletIsAdmin(account);
        return super._grantRole(role, account);
    }

    // ───────────────────────────── admin: organisations ─────────────────────────────

    function registerOrganisation(bytes32 orgId, bytes32 metadataHash) external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (organisations[orgId].status != OrgStatus.NONE) revert OrganisationAlreadyRegistered(orgId);
        organisations[orgId] = Organisation({status: OrgStatus.ACTIVE, registeredAt: uint64(block.timestamp), metadataHash: metadataHash});
        emit OrganisationRegistered(orgId, metadataHash);
    }

    /// @notice Suspension blocks NEW anchors and authorisations. It never alters history and never blocks revocation.
    function setOrganisationStatus(bytes32 orgId, OrgStatus status) external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (status != OrgStatus.ACTIVE && status != OrgStatus.SUSPENDED) revert InvalidStatus();
        Organisation storage org = organisations[orgId];
        if (org.status == OrgStatus.NONE) revert OrganisationNotRegistered(orgId);
        if (org.status == status) revert StatusUnchanged();
        org.status = status;
        emit OrganisationStatusChanged(orgId, status);
    }

    // ───────────────────────────── admin: issuer wallets ─────────────────────────────

    function authoriseIssuerWallet(bytes32 orgId, address wallet) external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (anchoringPaused) revert AnchoringIsPaused();
        _authorise(orgId, wallet);
    }

    /// @notice Retires a wallet (validUntil = now, once). Earlier signatures stay valid; the wallet is never re-authorised.
    function retireIssuerWallet(address wallet) external onlyRole(PLATFORM_ADMIN_ROLE) {
        IssuerKey storage k = issuerKeys[wallet];
        if (k.orgId == bytes32(0)) revert WalletUnknown(wallet);
        _retire(wallet, k);
    }

    /// @notice Atomic retire(old) + authorise(new) at the same timestamp. `newWallet` must be a FRESH wallet.
    function rotateIssuerWallet(bytes32 orgId, address oldWallet, address newWallet) external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (anchoringPaused) revert AnchoringIsPaused();
        IssuerKey storage k = issuerKeys[oldWallet];
        if (k.orgId == bytes32(0)) revert WalletUnknown(oldWallet);
        if (k.orgId != orgId) revert WalletBelongsToOtherOrganisation(oldWallet);
        _retire(oldWallet, k);
        _authorise(orgId, newWallet);
        emit IssuerWalletRotated(orgId, oldWallet, newWallet);
    }

    /**
     * @notice Marks a wallet compromised as of `compromisedAt` (validFrom <= compromisedAt <= now). Sets the
     *         marker once; closes the validity period if still open. Additive: nothing is deleted. Never
     *         blocked by pause or by organisation suspension.
     */
    function markIssuerWalletCompromised(address wallet, uint64 compromisedAt) external onlyRole(PLATFORM_ADMIN_ROLE) {
        IssuerKey storage k = issuerKeys[wallet];
        if (k.orgId == bytes32(0)) revert WalletUnknown(wallet);
        if (k.compromisedAt != 0) revert WalletNotOpen(wallet);
        if (compromisedAt < k.validFrom || compromisedAt > block.timestamp || compromisedAt == 0) revert InvalidCompromiseTime();
        k.compromisedAt = compromisedAt;
        if (k.validUntil == 0) {
            if (block.timestamp <= k.validFrom) revert KeyNotYetEstablished(wallet);
            k.validUntil = uint64(block.timestamp);
        }
        emit IssuerWalletCompromised(k.orgId, wallet, compromisedAt, k.validUntil);
    }

    function pauseAnchoring() external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (anchoringPaused) revert AnchoringIsPaused();
        anchoringPaused = true;
        emit AnchoringPaused(msg.sender);
    }

    function unpauseAnchoring() external onlyRole(PLATFORM_ADMIN_ROLE) {
        if (!anchoringPaused) revert AnchoringNotPaused();
        anchoringPaused = false;
        emit AnchoringUnpaused(msg.sender);
    }

    function _authorise(bytes32 orgId, address wallet) private {
        if (wallet == address(0)) revert ZeroAddress();
        if (organisations[orgId].status != OrgStatus.ACTIVE) revert OrganisationNotActive(orgId);
        // A wallet that was EVER authorised (retired, compromised, for any Organisation) is never authorised again.
        if (issuerKeys[wallet].orgId != bytes32(0)) revert WalletAlreadyKnown(wallet);
        // Admin and issuer authority never overlap.
        if (hasRole(PLATFORM_ADMIN_ROLE, wallet) || hasRole(DEFAULT_ADMIN_ROLE, wallet)) revert WalletIsAdmin(wallet);
        issuerKeys[wallet] = IssuerKey({orgId: orgId, validFrom: uint64(block.timestamp), validUntil: 0, compromisedAt: 0});
        emit IssuerWalletAuthorised(orgId, wallet, uint64(block.timestamp));
    }

    function _retire(address wallet, IssuerKey storage k) private {
        if (k.validUntil != 0) revert WalletNotOpen(wallet);
        // validUntil must be strictly after validFrom (a key cannot be created and retired in one instant).
        if (block.timestamp <= k.validFrom) revert KeyNotYetEstablished(wallet);
        k.validUntil = uint64(block.timestamp);
        emit IssuerWalletRetired(k.orgId, wallet, k.validUntil);
    }

    // ───────────────────────────── issuer: anchoring ─────────────────────────────

    /// @notice Appends a sealed CohortProof batch root to the Organisation's COHORT attestation chain.
    function anchorCohortRoot(
        bytes32 orgId,
        bytes32 batchRoot,
        uint32 leafCount,
        bytes32 schemaId,
        bytes32 expectedPreviousChainRoot
    ) external returns (bytes32 chainRoot) {
        _requireCanAnchor(orgId);
        if (batchRoot == bytes32(0)) revert ZeroRoot();
        if (leafCount == 0) revert ZeroLeafCount();
        uint64 epoch;
        bytes32 previous;
        (chainRoot, epoch, previous) = _append(orgId, AttestationType.COHORT, batchRoot, 0, leafCount, schemaId, expectedPreviousChainRoot);
        emit CohortRootAnchored(orgId, chainRoot, epoch, batchRoot, previous, leafCount, schemaId, msg.sender);
    }

    /// @notice Snapshots the already-current ProofPulse root onto the Organisation's PROOF_PULSE attestation chain.
    function anchorProofPulseEpoch(
        bytes32 orgId,
        bytes32 batchRoot,
        uint64 rootSeq,
        uint32 leafCount,
        bytes32 expectedPreviousChainRoot
    ) external returns (bytes32 chainRoot) {
        _requireCanAnchor(orgId);
        if (batchRoot == bytes32(0)) revert ZeroRoot();
        if (leafCount == 0) revert ZeroLeafCount();
        uint64 last = lastPulseRootSeq[orgId];
        if (rootSeq == 0 || rootSeq < last) revert PulseRootSeqTooLow(rootSeq, last);
        // Re-affirming an unchanged root is allowed; a DIFFERENT root at the same sequence is not.
        if (rootSeq == last && batchRoot != lastPulseRoot[orgId]) revert PulseRootMismatch(batchRoot, lastPulseRoot[orgId]);
        lastPulseRootSeq[orgId] = rootSeq;
        lastPulseRoot[orgId] = batchRoot;

        uint64 epoch;
        bytes32 previous;
        (chainRoot, epoch, previous) = _append(orgId, AttestationType.PROOF_PULSE, batchRoot, rootSeq, leafCount, bytes32(0), expectedPreviousChainRoot);
        emit ProofPulseEpochAnchored(orgId, chainRoot, epoch, batchRoot, previous, rootSeq, leafCount, msg.sender);
    }

    function _requireCanAnchor(bytes32 orgId) private view {
        if (anchoringPaused) revert AnchoringIsPaused();
        if (organisations[orgId].status != OrgStatus.ACTIVE) revert OrganisationNotActive(orgId);
        _requireOpenIssuerOf(orgId);
    }

    /// @dev msg.sender must be an OPEN (not retired) and not compromised issuer wallet OF THIS Organisation.
    function _requireOpenIssuerOf(bytes32 orgId) private view {
        IssuerKey storage k = issuerKeys[msg.sender];
        if (k.orgId != orgId || orgId == bytes32(0) || k.validUntil != 0 || k.compromisedAt != 0) revert NotOpenIssuerOf(orgId, msg.sender);
    }

    function _append(
        bytes32 orgId,
        AttestationType t,
        bytes32 batchRoot,
        uint64 rootSeq,
        uint32 leafCount,
        bytes32 schemaId,
        bytes32 expectedPreviousChainRoot
    ) private returns (bytes32 chainRoot, uint64 epoch, bytes32 previous) {
        ChainHead storage head = chainHeads[orgId][t];
        previous = head.chainRoot;
        // A stale submission reverts instead of forking the chain.
        if (previous != expectedPreviousChainRoot) revert StaleChainHead(previous, expectedPreviousChainRoot);
        epoch = head.epoch + 1;
        chainRoot = computeChainRoot(batchRoot, previous, orgId, t, epoch);
        if (anchors[chainRoot].orgId != bytes32(0)) revert AnchorAlreadyExists(chainRoot);

        anchors[chainRoot] = Anchor({
            orgId: orgId,
            attestationType: t,
            batchRoot: batchRoot,
            previousChainRoot: previous,
            epoch: epoch,
            rootSeq: rootSeq,
            leafCount: leafCount,
            schemaId: schemaId,
            anchoredBy: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        chainRootAt[orgId][t][epoch] = chainRoot;
        head.chainRoot = chainRoot;
        head.epoch = epoch;
    }

    // ───────────────────────────── issuer: revocation ─────────────────────────────

    /**
     * @notice Revokes a credential OF THE CALLER'S OWN ORGANISATION. The credentialId is rebuilt here from
     *         `orgId` and `credentialSalt`, so an issuer can only ever revoke ids in its own namespace.
     *         Allowed while the Organisation is SUSPENDED and while anchoring is paused. Irreversible.
     *         `credentialSalt` becomes public (it reveals nothing about content or subject).
     */
    function revokeCredential(bytes32 orgId, bytes32 credentialSalt, uint16 reasonCode) external returns (bytes32 credentialId) {
        if (organisations[orgId].status == OrgStatus.NONE) revert OrganisationNotRegistered(orgId);
        _requireOpenIssuerOf(orgId);
        if (reasonCode < REASON_ISSUED_IN_ERROR || reasonCode > REASON_OTHER) revert InvalidReason(reasonCode);
        credentialId = computeCredentialId(orgId, credentialSalt);
        if (revocations[credentialId].orgId != bytes32(0)) revert AlreadyRevoked(credentialId);
        revocations[credentialId] = Revocation({orgId: orgId, revokedAt: uint64(block.timestamp), reasonCode: reasonCode, revokedBy: msg.sender});
        emit CredentialRevoked(credentialId, orgId, reasonCode, msg.sender, credentialSalt);
    }

    // ───────────────────────────── views ─────────────────────────────

    function computeCredentialId(bytes32 orgId, bytes32 credentialSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(CREDENTIAL_ID_TAG, orgId, credentialSalt));
    }

    /// @dev Must equal lib/crypto/chain-root.ts exactly (golden vectors in tests/vectors/crypto.json).
    function computeChainRoot(
        bytes32 batchRoot,
        bytes32 previousChainRoot,
        bytes32 orgId,
        AttestationType attestationType,
        uint64 epoch
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(batchRoot, previousChainRoot, orgId, uint8(attestationType), epoch));
    }

    /// @notice Was `wallet` authorised for `orgId` at `timestamp`? validFrom <= t < validUntil (0 = still open).
    function isIssuerAuthorisedAt(bytes32 orgId, address wallet, uint64 timestamp) public view returns (bool) {
        IssuerKey storage k = issuerKeys[wallet];
        return k.orgId == orgId && orgId != bytes32(0) && k.validFrom <= timestamp && (k.validUntil == 0 || timestamp < k.validUntil);
    }

    /**
     * @notice Evidence check for the verifier: the wallet was authorised for `orgId` at the signed `issuedAt`
     *         AND the evidence was anchored before any compromise (`anchoredAt < compromisedAt`). A later
     *         retirement never invalidates evidence; evidence anchored at/after compromise does not count.
     */
    function isEvidenceKeyValid(bytes32 orgId, address wallet, uint64 issuedAt, uint64 anchoredAt) external view returns (bool) {
        if (!isIssuerAuthorisedAt(orgId, wallet, issuedAt)) return false;
        uint64 compromised = issuerKeys[wallet].compromisedAt;
        return compromised == 0 || anchoredAt < compromised;
    }

    function getIssuerKey(address wallet) external view returns (IssuerKey memory) {
        return issuerKeys[wallet];
    }

    function getAnchor(bytes32 chainRoot) external view returns (Anchor memory) {
        return anchors[chainRoot];
    }

    function getChainHead(bytes32 orgId, AttestationType t) external view returns (ChainHead memory) {
        return chainHeads[orgId][t];
    }

    function getRevocation(bytes32 credentialId) external view returns (Revocation memory) {
        return revocations[credentialId];
    }

    /// @notice Verifies a CohortProof inclusion proof (OpenZeppelin StandardMerkleTree compatible) against an anchored COHORT root.
    function verifyCohortInclusion(bytes32 chainRoot, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        Anchor storage a = anchors[chainRoot];
        if (a.orgId == bytes32(0) || a.attestationType != AttestationType.COHORT) return false;
        return MerkleProof.verify(proof, a.batchRoot, leaf);
    }
}
