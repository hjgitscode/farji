// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title VectorHarness
 * @notice TEST-ONLY. Recomputes in Solidity the hashes that lib/crypto and lib/merkle compute in
 *         TypeScript, so the committed golden vectors (tests/vectors/crypto.json) are proven to
 *         match on-chain encodings. NEVER deployed outside tests.
 */
contract VectorHarness {
    bytes32 public constant COHORT_LEAF_V1 = keccak256("FARJI_COHORT_LEAF_V1");
    bytes32 public constant PULSE_LEAF_V1 = keccak256("FARJI_PULSE_LEAF_V1");
    bytes32 public constant PULSE_NODE_V1 = keccak256("FARJI_PULSE_NODE_V1");
    bytes32 public constant PULSE_EMPTY_V1 = keccak256("FARJI_PULSE_EMPTY_V1");
    bytes32 public constant SUBJECT_TAG = keccak256("FARJI_SUBJECT_V1");
    bytes32 public constant CREDENTIAL_ID_TAG = keccak256("FARJI_CREDENTIAL_ID_V1");

    bytes32 public constant CONTENT_TYPEHASH = keccak256(
        "CredentialContent(uint8 category,string title,string organisationName,string startDate,string endDate,string expiryDate,string description,string location,string fieldOfStudy,string credentialNumber,bytes32 contentSalt)"
    );

    struct Content {
        uint8 category;
        string title;
        string organisationName;
        string startDate;
        string endDate;
        string expiryDate;
        string description;
        string location;
        string fieldOfStudy;
        string credentialNumber;
        bytes32 contentSalt;
    }

    function credentialId(bytes32 orgId, bytes32 credentialSalt) external pure returns (bytes32) {
        return keccak256(abi.encode(CREDENTIAL_ID_TAG, orgId, credentialSalt));
    }

    function subjectCommitment(bytes16 platformSubjectId, bytes32 subjectSalt) external pure returns (bytes32) {
        return keccak256(abi.encode(SUBJECT_TAG, platformSubjectId, subjectSalt));
    }

    /// @dev EIP-712 hashStruct of the salted CredentialContent = contentDigest.
    function contentDigest(Content calldata c) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONTENT_TYPEHASH,
                c.category,
                keccak256(bytes(c.title)),
                keccak256(bytes(c.organisationName)),
                keccak256(bytes(c.startDate)),
                keccak256(bytes(c.endDate)),
                keccak256(bytes(c.expiryDate)),
                keccak256(bytes(c.description)),
                keccak256(bytes(c.location)),
                keccak256(bytes(c.fieldOfStudy)),
                keccak256(bytes(c.credentialNumber)),
                c.contentSalt
            )
        );
    }

    function cohortLeaf(
        bytes32 orgId,
        bytes32 credentialId_,
        bytes32 subjectCommitment_,
        bytes32 contentDigest_,
        uint8 lifecycleType,
        uint64 validFrom,
        uint64 validUntil,
        uint64 issuedAt,
        bytes32 schemaId
    ) external pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(COHORT_LEAF_V1, orgId, credentialId_, subjectCommitment_, contentDigest_, lifecycleType, validFrom, validUntil, issuedAt, schemaId)
                )
            )
        );
    }

    function pulseLeaf(
        bytes32 orgId,
        uint32 leafIndex,
        bytes32 credentialId_,
        bytes32 subjectCommitment_,
        bytes32 contentDigest_,
        uint8 scope,
        uint8 status,
        uint64 statusEffectiveAt,
        uint32 statusSeq
    ) external pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(PULSE_LEAF_V1, orgId, leafIndex, credentialId_, subjectCommitment_, contentDigest_, scope, status, statusEffectiveAt, statusSeq)
                )
            )
        );
    }

    function pulseNode(bytes32 left, bytes32 right) public pure returns (bytes32) {
        return keccak256(abi.encode(PULSE_NODE_V1, left, right));
    }

    /// @dev zero[0] = keccak256(PULSE_EMPTY_V1); zero[i+1] = node(zero[i], zero[i]).
    function pulseZero(uint256 level) external pure returns (bytes32 z) {
        z = keccak256(abi.encodePacked(PULSE_EMPTY_V1));
        for (uint256 i = 0; i < level; i++) {
            z = pulseNode(z, z);
        }
    }

    /// @dev Folds a positional ProofPulse proof (siblings for levels 0..depth-1).
    function pulseRoot(uint32 leafIndex, bytes32 leaf, bytes32[] calldata siblings) external pure returns (bytes32 h) {
        h = leaf;
        uint256 position = leafIndex;
        for (uint256 i = 0; i < siblings.length; i++) {
            h = position % 2 == 0 ? pulseNode(h, siblings[i]) : pulseNode(siblings[i], h);
            position = position / 2;
        }
    }
}
