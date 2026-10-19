import { concat, keccak256, toBeHex, toUtf8Bytes, TypedDataEncoder, zeroPadValue } from "ethers";
import { describe, expect, it } from "vitest";
import { canonicalCredentialContent } from "@/lib/crypto/canonical";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { areDistinctSalts, contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import * as K from "@/lib/crypto/constants";
import { uuidToBytes16 } from "@/lib/crypto/encoding";
import vectors from "../vectors/crypto.json";
import { rep, V } from "../vectors/inputs";

const canonical = (() => {
  const r = canonicalCredentialContent(V.category, V.lifecycle, V.content);
  if (!r.ok) throw new Error("bad vector inputs");
  return r.value;
})();

const pad32 = (n: bigint | number) => zeroPadValue(toBeHex(n), 32);
const keccakUtf8 = (s: string) => keccak256(toUtf8Bytes(s));

describe("domain-separation tags", () => {
  it("are keccak256 of the exact tag strings (committed golden values)", () => {
    expect(K.CREDENTIAL_ID_TAG).toBe(keccakUtf8("FARJI_CREDENTIAL_ID_V1"));
    expect(K.SUBJECT_TAG).toBe(keccakUtf8("FARJI_SUBJECT_V1"));
    expect(K.COHORT_LEAF_V1).toBe(keccakUtf8("FARJI_COHORT_LEAF_V1"));
    expect(K.PULSE_LEAF_V1).toBe(keccakUtf8("FARJI_PULSE_LEAF_V1"));
    expect(K.PULSE_NODE_V1).toBe(keccakUtf8("FARJI_PULSE_NODE_V1"));
    expect(K.PULSE_EMPTY_V1).toBe(keccakUtf8("FARJI_PULSE_EMPTY_V1"));
    expect(vectors.tags).toEqual({
      CREDENTIAL_ID_TAG: K.CREDENTIAL_ID_TAG,
      SUBJECT_TAG: K.SUBJECT_TAG,
      COHORT_LEAF_V1: K.COHORT_LEAF_V1,
      PULSE_LEAF_V1: K.PULSE_LEAF_V1,
      PULSE_NODE_V1: K.PULSE_NODE_V1,
      PULSE_EMPTY_V1: K.PULSE_EMPTY_V1,
    });
  });

  it("are all distinct", () => {
    const tags = [K.CREDENTIAL_ID_TAG, K.SUBJECT_TAG, K.COHORT_LEAF_V1, K.PULSE_LEAF_V1, K.PULSE_NODE_V1, K.PULSE_EMPTY_V1];
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("credentialId (golden vector, hand-built abi.encode)", () => {
  it("equals keccak256(tag ‖ orgId ‖ salt) built by plain concatenation", () => {
    const expected = keccak256(concat([K.CREDENTIAL_ID_TAG, V.orgId, V.credentialSalt]));
    expect(credentialIdOf(V.orgId, V.credentialSalt)).toBe(expected);
    expect(vectors.credentialId).toBe(expected);
  });

  it("depends on the organisation and on the salt (the id embeds orgId)", () => {
    expect(credentialIdOf(rep("12"), V.credentialSalt)).not.toBe(credentialIdOf(V.orgId, V.credentialSalt));
    expect(credentialIdOf(V.orgId, rep("ab"))).not.toBe(credentialIdOf(V.orgId, V.credentialSalt));
  });

  it("rejects malformed inputs", () => {
    expect(() => credentialIdOf("0x1234", V.credentialSalt)).toThrow();
    expect(() => credentialIdOf(V.orgId, V.credentialSalt.toUpperCase().replace("0X", "0x"))).toThrow();
  });
});

describe("subjectCommitment (golden vector, hand-built abi.encode)", () => {
  it("equals keccak256(tag ‖ bytes16 right-padded ‖ salt)", () => {
    const subject16 = uuidToBytes16(V.subjectUuid);
    expect(subject16).toBe("0x01990000000070008000000000000001");
    const expected = keccak256(concat([K.SUBJECT_TAG, subject16 + "00".repeat(16), V.subjectSalt]));
    expect(subjectCommitmentOf(subject16, V.subjectSalt)).toBe(expected);
    expect(vectors.subjectCommitment).toBe(expected);
  });

  it("a different salt gives an unlinkable commitment for the same subject", () => {
    const s = uuidToBytes16(V.subjectUuid);
    expect(subjectCommitmentOf(s, rep("c1"))).not.toBe(subjectCommitmentOf(s, rep("c2")));
  });

  it("rejects a malformed subject id", () => {
    expect(() => subjectCommitmentOf("0x1234", V.subjectSalt)).toThrow();
    expect(() => uuidToBytes16("not-a-uuid")).toThrow();
  });
});

describe("contentDigest and schemaId (golden vectors, hand-built hashStruct)", () => {
  const encodeType =
    "CredentialContent(uint8 category,string title,string organisationName,string startDate,string endDate,string expiryDate,string description,string location,string fieldOfStudy,string credentialNumber,bytes32 contentSalt)";

  it("the V1 schema is exactly this struct and schemaId is its type hash", () => {
    expect(TypedDataEncoder.from(K.CONTENT_TYPES).encodeType("CredentialContent")).toBe(encodeType);
    expect(K.SCHEMA_ID).toBe(keccakUtf8(encodeType));
    expect(vectors.schema).toEqual({ encodeType, schemaId: K.SCHEMA_ID });
  });

  it("contentDigest equals the EIP-712 hashStruct built by hand", () => {
    const c = canonical;
    const expected = keccak256(
      concat([
        keccakUtf8(encodeType),
        pad32(c.category),
        keccakUtf8(c.title),
        keccakUtf8(c.organisationName),
        keccakUtf8(c.startDate),
        keccakUtf8(c.endDate),
        keccakUtf8(c.expiryDate),
        keccakUtf8(c.description),
        keccakUtf8(c.location),
        keccakUtf8(c.fieldOfStudy),
        keccakUtf8(c.credentialNumber),
        V.contentSalt,
      ]),
    );
    expect(contentDigestOf(canonical, V.contentSalt)).toBe(expected);
    expect(vectors.contentDigest).toBe(expected);
  });

  it("a different salt changes the digest", () => {
    expect(contentDigestOf(canonical, rep("b1"))).not.toBe(contentDigestOf(canonical, rep("b2")));
  });
});

describe("salts", () => {
  it("areDistinctSalts is true only when all three differ", () => {
    expect(areDistinctSalts(rep("01"), rep("02"), rep("03"))).toBe(true);
    expect(areDistinctSalts(rep("01"), rep("01"), rep("03"))).toBe(false);
    expect(areDistinctSalts(rep("01"), rep("02"), rep("01"))).toBe(false);
    expect(areDistinctSalts(rep("01"), rep("02"), rep("02"))).toBe(false);
    expect(vectors.distinctSalts).toBe(true);
  });

  it("each salt only affects its own output", () => {
    const id = credentialIdOf(V.orgId, V.credentialSalt);
    const sub = subjectCommitmentOf(uuidToBytes16(V.subjectUuid), V.subjectSalt);
    const dig = contentDigestOf(canonical, V.contentSalt);
    // Changing contentSalt leaves credentialId and subjectCommitment untouched (and vice versa).
    expect(credentialIdOf(V.orgId, V.credentialSalt)).toBe(id);
    expect(subjectCommitmentOf(uuidToBytes16(V.subjectUuid), V.subjectSalt)).toBe(sub);
    expect(contentDigestOf(canonical, rep("b9"))).not.toBe(dig);
  });
});

describe("chainRoot (golden vector, hand-built abi.encode)", () => {
  it("equals keccak256(batchRoot ‖ previousChainRoot ‖ orgId ‖ uint8 type ‖ uint64 epoch)", () => {
    const expected = keccak256(concat([V.batchRoot, V.previousChainRoot, V.orgId, pad32(0), pad32(V.epoch)]));
    expect(chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "COHORT", V.epoch)).toBe(expected);
    expect(vectors.chainRoot).toBe(expected);
    const pulse = keccak256(concat([V.batchRoot, V.previousChainRoot, V.orgId, pad32(1), pad32(V.epoch)]));
    expect(chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "PROOF_PULSE", V.epoch)).toBe(pulse);
    expect(vectors.chainRootProofPulse).toBe(pulse);
  });

  it("COHORT and PROOF_PULSE chains stay distinct, and the epoch and organisation are bound", () => {
    const a = chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "COHORT", 1n);
    expect(chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "PROOF_PULSE", 1n)).not.toBe(a);
    expect(chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "COHORT", 2n)).not.toBe(a);
    expect(chainRootOf(V.batchRoot, V.previousChainRoot, rep("12"), "COHORT", 1n)).not.toBe(a);
    expect(() => chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "COHORT", 0n)).toThrow();
  });
});
