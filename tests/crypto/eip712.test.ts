import { concat, keccak256, toBeHex, toUtf8Bytes, TypedDataEncoder, zeroPadValue } from "ethers";
import { describe, expect, it } from "vitest";
import { canonicalCredentialContent } from "@/lib/crypto/canonical";
import { contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import * as K from "@/lib/crypto/constants";
import { uuidToBytes16 } from "@/lib/crypto/encoding";
import {
  buildCredentialTypedData,
  buildStatusChangeTypedData,
  farjiDomain,
  normaliseSignature,
  recoverSigner,
  toWalletTypedData,
  typedDataHash,
  type CredentialAttestationParams,
} from "@/lib/crypto/eip712";
import { deterministicWallet, freshWallet, type TestWallet } from "../fixtures/test-wallets";
import vectors from "../vectors/crypto.json";
import { rep, V } from "../vectors/inputs";

const keccakUtf8 = (s: string) => keccak256(toUtf8Bytes(s));
const pad32 = (n: bigint | number) => zeroPadValue(toBeHex(n), 32);

const canonical = (() => {
  const r = canonicalCredentialContent(V.category, V.lifecycle, V.content);
  if (!r.ok) throw new Error("bad vector inputs");
  return r.value;
})();

const domain = farjiDomain({ chainId: V.chainId, verifyingContract: V.verifyingContract });

const params = (over: Partial<CredentialAttestationParams> = {}): CredentialAttestationParams => ({
  credentialId: credentialIdOf(V.orgId, V.credentialSalt),
  orgId: V.orgId,
  subjectCommitment: subjectCommitmentOf(uuidToBytes16(V.subjectUuid), V.subjectSalt),
  content: canonical,
  contentSalt: V.contentSalt,
  lifecycleType: K.LIFECYCLE_CODE.PERMANENT,
  validFrom: V.validFrom,
  validUntil: V.validUntil,
  supersedesCredentialId: K.ZERO_HASH,
  issuedAt: V.issuedAt,
  nonce: V.nonce,
  ...over,
});

const sign = async (wallet: TestWallet, td =buildCredentialTypedData(domain, params())) =>
  (await wallet.signTypedData(td.domain, td.types, td.message)).toLowerCase();

describe("EIP-712 golden vectors (hand-built from the spec)", () => {
  it("the domain separator is keccak(typeHash ‖ name ‖ version ‖ chainId ‖ contract)", () => {
    const typeHash = keccakUtf8("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    const expected = keccak256(concat([typeHash, keccakUtf8("FARJI"), keccakUtf8("1"), pad32(V.chainId), zeroPadValue(V.verifyingContract, 32)]));
    expect(TypedDataEncoder.hashDomain(domain)).toBe(expected);
    expect(vectors.domainSeparator).toBe(expected);
  });

  it("the CredentialAttestation digest is keccak(0x1901 ‖ domain ‖ hashStruct) built by hand", () => {
    const attType =
      "CredentialAttestation(bytes32 credentialId,bytes32 orgId,bytes32 subjectCommitment,CredentialContent content,bytes32 schemaId,uint8 lifecycleType,uint64 validFrom,uint64 validUntil,bytes32 supersedesCredentialId,uint64 issuedAt,bytes32 nonce)" +
      "CredentialContent(uint8 category,string title,string organisationName,string startDate,string endDate,string expiryDate,string description,string location,string fieldOfStudy,string credentialNumber,bytes32 contentSalt)";
    const p = params();
    const structHash = keccak256(
      concat([
        keccakUtf8(attType),
        p.credentialId,
        p.orgId,
        p.subjectCommitment,
        contentDigestOf(canonical, V.contentSalt), // a nested struct encodes as its hashStruct
        K.SCHEMA_ID,
        pad32(0),
        pad32(p.validFrom),
        pad32(p.validUntil),
        p.supersedesCredentialId,
        pad32(p.issuedAt),
        p.nonce,
      ]),
    );
    const expected = keccak256(concat(["0x1901", vectors.domainSeparator, structHash]));
    const td = buildCredentialTypedData(domain, p);
    expect(typedDataHash(td)).toBe(expected);
    expect(vectors.credentialAttestation.typedDataHash).toBe(expected);
  });

  it("the StatusChangeAttestation digest matches the committed vector", () => {
    const sc = buildStatusChangeTypedData(domain, {
      credentialId: vectors.credentialId,
      orgId: V.orgId,
      leafIndex: V.leafIndex,
      newStatus: K.PULSE_STATUS_CODE.ENDED,
      effectiveAt: V.effectiveAt,
      statusSeq: V.statusSeq,
      issuedAt: V.issuedAt,
      nonce: V.nonce,
    });
    const type = "StatusChangeAttestation(bytes32 credentialId,bytes32 orgId,uint32 leafIndex,uint8 newStatus,uint64 effectiveAt,uint32 statusSeq,uint64 issuedAt,bytes32 nonce)";
    const structHash = keccak256(
      concat([keccakUtf8(type), vectors.credentialId, V.orgId, pad32(V.leafIndex), pad32(1), pad32(V.effectiveAt), pad32(V.statusSeq), pad32(V.issuedAt), V.nonce]),
    );
    const expected = keccak256(concat(["0x1901", vectors.domainSeparator, structHash]));
    expect(typedDataHash(sc)).toBe(expected);
    expect(vectors.statusChangeAttestation.typedDataHash).toBe(expected);
  });

  it("a signature by the committed test key recovers to its known address, deterministically", async () => {
    const sig = await sign(deterministicWallet());
    expect(sig).toBe(vectors.credentialAttestation.signature);
    const td = buildCredentialTypedData(domain, params());
    expect(recoverSigner(td, sig)).toBe(vectors.credentialAttestation.signer);
    expect(vectors.credentialAttestation.signer).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });
});

describe("signer recovery", () => {
  it("recovers the signer of a valid signature", async () => {
    const wallet = freshWallet();
    const td = buildCredentialTypedData(domain, params());
    expect(recoverSigner(td, await sign(wallet, td))).toBe(wallet.address.toLowerCase());
  });

  it("a wrong signer is distinguishable: recovery returns the real signer, not the expected one", async () => {
    const expected = freshWallet();
    const impostor = freshWallet();
    const td = buildCredentialTypedData(domain, params());
    const recovered = recoverSigner(td, await sign(impostor, td));
    expect(recovered).toBe(impostor.address.toLowerCase());
    expect(recovered).not.toBe(expected.address.toLowerCase());
  });

  const tampered: [string, Partial<CredentialAttestationParams>][] = [
    ["credentialId", { credentialId: rep("01") }],
    ["orgId", { orgId: rep("12") }],
    ["subjectCommitment", { subjectCommitment: rep("02") }],
    ["content title", { content: { ...canonical, title: "Principal Engineer" } }],
    ["contentSalt", { contentSalt: rep("b1") }],
    ["lifecycleType", { lifecycleType: K.LIFECYCLE_CODE.CONTINUING }],
    ["validFrom", { validFrom: V.validFrom + 1n }],
    ["validUntil", { validUntil: 1900000000n }],
    ["supersedesCredentialId", { supersedesCredentialId: rep("03") }],
    ["issuedAt", { issuedAt: V.issuedAt + 1n }],
    ["nonce", { nonce: rep("de") }],
  ];
  for (const [field, change] of tampered) {
    it(`a tampered ${field} no longer recovers the signer`, async () => {
      const wallet = freshWallet();
      const signature = await sign(wallet);
      const tamperedTd = buildCredentialTypedData(domain, params(change));
      expect(recoverSigner(tamperedTd, signature)).not.toBe(wallet.address.toLowerCase());
    });
  }

  it("a signature for another organisation does not validate for this one (orgId bound)", async () => {
    const wallet = freshWallet();
    const other = buildCredentialTypedData(domain, params({ orgId: rep("12") }));
    const signature = await sign(wallet, other);
    expect(recoverSigner(buildCredentialTypedData(domain, params()), signature)).not.toBe(wallet.address.toLowerCase());
  });

  it("a signature does not replay on another chain or another contract", async () => {
    const wallet = freshWallet();
    const signature = await sign(wallet);
    const otherChain = buildCredentialTypedData(farjiDomain({ chainId: 11155111n, verifyingContract: V.verifyingContract }), params());
    const otherContract = buildCredentialTypedData(farjiDomain({ chainId: V.chainId, verifyingContract: "0x" + "ab".repeat(20) }), params());
    expect(recoverSigner(otherChain, signature)).not.toBe(wallet.address.toLowerCase());
    expect(recoverSigner(otherContract, signature)).not.toBe(wallet.address.toLowerCase());
  });

  it("a credential signature is not valid as a status-change signature (distinct primary types)", async () => {
    const wallet = freshWallet();
    const signature = await sign(wallet);
    const sc = buildStatusChangeTypedData(domain, {
      credentialId: params().credentialId,
      orgId: V.orgId,
      leafIndex: 0,
      newStatus: 1,
      effectiveAt: V.effectiveAt,
      statusSeq: 2,
      issuedAt: V.issuedAt,
      nonce: V.nonce,
    });
    expect(recoverSigner(sc, signature)).not.toBe(wallet.address.toLowerCase());
  });
});

describe("signature normalisation", () => {
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

  it("accepts a canonical low-s signature and returns it lowercase", async () => {
    const sig = await sign(freshWallet());
    expect(normaliseSignature(sig)).toBe(sig);
    expect(normaliseSignature(sig.toUpperCase().replace("0X", "0x"))).toBe(sig);
  });

  it("rejects the malleable high-s twin", async () => {
    const sig = await sign(freshWallet());
    const s = BigInt("0x" + sig.slice(66, 130));
    const v = parseInt(sig.slice(130, 132), 16);
    const highS = sig.slice(0, 66) + (N - s).toString(16).padStart(64, "0") + (v === 27 ? "1c" : "1b");
    expect(normaliseSignature(highS)).toBeNull();
    const td = buildCredentialTypedData(domain, params());
    expect(recoverSigner(td, highS)).toBeNull();
  });

  it("rejects wrong length, non-hex and a non-27/28 v", async () => {
    const sig = await sign(freshWallet());
    expect(normaliseSignature(sig.slice(0, -2))).toBeNull();
    expect(normaliseSignature("0x" + "zz".repeat(65))).toBeNull();
    expect(normaliseSignature(sig.slice(0, 130) + "00")).toBeNull();
    expect(normaliseSignature(sig.slice(0, 130) + "01")).toBeNull();
    expect(normaliseSignature(sig.slice(0, 130) + "1d")).toBeNull();
    expect(normaliseSignature(undefined)).toBeNull();
    expect(normaliseSignature(5)).toBeNull();
  });

  it("recoverSigner returns null instead of throwing for garbage", () => {
    const td = buildCredentialTypedData(domain, params());
    expect(recoverSigner(td, "0x" + "00".repeat(65))).toBeNull();
    expect(recoverSigner(td, "nonsense")).toBeNull();
  });
});

describe("builders validate their inputs", () => {
  it("rejects a non-canonical domain", () => {
    expect(() => farjiDomain({ chainId: 0n, verifyingContract: V.verifyingContract })).toThrow();
    expect(() => farjiDomain({ chainId: 1n, verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3" })).toThrow(); // checksum casing
    expect(() => farjiDomain({ chainId: 1n, verifyingContract: "0x1234" })).toThrow();
  });

  it("rejects malformed message fields", () => {
    expect(() => buildCredentialTypedData(domain, params({ nonce: "0x12" }))).toThrow();
    expect(() => buildCredentialTypedData(domain, params({ lifecycleType: 7 }))).toThrow();
    expect(() => buildCredentialTypedData(domain, params({ issuedAt: -1n }))).toThrow();
    expect(() => buildCredentialTypedData(domain, params({ validFrom: 1n << 64n }))).toThrow();
  });

  it("validFrom and issuedAt are separate fields of the message", () => {
    const td = buildCredentialTypedData(domain, params());
    expect(td.message.validFrom).toBe(V.validFrom);
    expect(td.message.issuedAt).toBe(V.issuedAt);
    expect(td.message.validFrom).not.toBe(td.message.issuedAt);
    const names = K.CREDENTIAL_ATTESTATION_TYPES.CredentialAttestation.map((f) => f.name);
    expect(names).toContain("validFrom");
    expect(names).toContain("issuedAt");
  });

  it("the wallet form is JSON-safe and includes the EIP712Domain type", () => {
    const w = toWalletTypedData(buildCredentialTypedData(domain, params()));
    const json = JSON.parse(JSON.stringify(w));
    expect(json.domain.chainId).toBe("31337");
    expect(json.primaryType).toBe("CredentialAttestation");
    expect(json.types.EIP712Domain).toHaveLength(4);
    expect(json.message.issuedAt).toBe(V.issuedAt.toString());
    expect(json.message.content.title).toBe("Software Engineer");
  });
});
