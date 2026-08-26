import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import {
  buildCredentialAttestationMessage,
  buildDomain,
  recoverCredentialAttestationSigner,
  signCredentialAttestation,
} from "@/lib/crypto/eip712";
import { hashCredential } from "@/lib/crypto/hash";
import { DEMO_WALLETS } from "@/lib/crypto/demoWallets";

const canonicalInput = {
  credentialId: "CRED-002",
  candidateRef: "CAND-001",
  claimType: "EMPLOYMENT",
  organisationId: "ORG-XYZ",
  title: "Software Engineer",
  startDate: "2026-06-15",
  endDate: null,
  lifecycleType: "CONTINUING",
  version: 1,
};

function buildMessage() {
  return buildCredentialAttestationMessage({
    credentialId: "CRED-002",
    claimHash: hashCredential(canonicalInput),
    organisationId: "ORG-XYZ",
    version: 1,
    nonce: 1,
    timestamp: Math.floor(new Date("2026-06-15").getTime() / 1000),
  });
}

describe("EIP-712 credential attestation", () => {
  it("recovers the correct signer", async () => {
    const issuer = new Wallet(DEMO_WALLETS.XYZ_ORIGINAL.privateKey);
    const message = buildMessage();
    const domain = buildDomain();

    const signature = await signCredentialAttestation(issuer, message, domain);
    const recovered = recoverCredentialAttestationSigner(message, signature, domain);

    expect(recovered.toLowerCase()).toBe(issuer.address.toLowerCase());
    expect(recovered.toLowerCase()).toBe(DEMO_WALLETS.XYZ_ORIGINAL.address.toLowerCase());
  });

  it("does not recover a different issuer's address", async () => {
    const issuer = new Wallet(DEMO_WALLETS.XYZ_ORIGINAL.privateKey);
    const message = buildMessage();
    const domain = buildDomain();

    const signature = await signCredentialAttestation(issuer, message, domain);
    const recovered = recoverCredentialAttestationSigner(message, signature, domain);

    expect(recovered.toLowerCase()).not.toBe(DEMO_WALLETS.ABC.address.toLowerCase());
  });

  it("fails verification (recovers the wrong address) when the payload is tampered with", async () => {
    const issuer = new Wallet(DEMO_WALLETS.XYZ_ORIGINAL.privateKey);
    const message = buildMessage();
    const domain = buildDomain();

    const signature = await signCredentialAttestation(issuer, message, domain);

    // Attacker/candidate edits the claim hash after signing — a different
    // claimHash than what was actually signed.
    const tampered = { ...message, claimHash: hashCredential({ ...canonicalInput, title: "Senior Software Engineer" }) };
    const recoveredFromTampered = recoverCredentialAttestationSigner(tampered, signature, domain);

    expect(recoveredFromTampered.toLowerCase()).not.toBe(issuer.address.toLowerCase());
  });

  it("fails verification when the domain (chain id) differs from what was signed", async () => {
    const issuer = new Wallet(DEMO_WALLETS.XYZ_ORIGINAL.privateKey);
    const message = buildMessage();
    const signedDomain = buildDomain({ chainId: 31337 });
    const otherDomain = buildDomain({ chainId: 80002 }); // e.g. Polygon Amoy

    const signature = await signCredentialAttestation(issuer, message, signedDomain);
    const recovered = recoverCredentialAttestationSigner(message, signature, otherDomain);

    expect(recovered.toLowerCase()).not.toBe(issuer.address.toLowerCase());
  });

  it("hashes credentialId and organisationId down to bytes32", () => {
    const message = buildMessage();
    expect(message.credentialId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(message.organisationId).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
