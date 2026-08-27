import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const orgId = (id: string) => ethers.keccak256(ethers.toUtf8Bytes(id));
const credentialId = (id: string) => ethers.keccak256(ethers.toUtf8Bytes(id));

describe("NotSoFarjiRegistry — credential revocation", () => {
  async function deployWithIssuer() {
    const [admin, issuer] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("NotSoFarjiRegistry");
    const registry = await Registry.connect(admin).deploy();
    await registry.waitForDeployment();

    const organisationId = orgId("ORG-PQR");
    await registry.connect(admin).registerOrganisation(organisationId, "PQR Innovations Demo");
    await registry.connect(admin).authoriseIssuer(organisationId, issuer.address, 0);

    return { registry, admin, issuer, organisationId };
  }

  it("is not revoked by default", async () => {
    const { registry } = await deployWithIssuer();
    expect(await registry.isCredentialRevoked(credentialId("CRED-005"))).to.equal(false);
  });

  it("revokes a credential", async () => {
    const { registry, issuer } = await deployWithIssuer();
    const id = credentialId("CRED-005");

    await expect(registry.connect(issuer).revokeCredential(id))
      .to.emit(registry, "CredentialRevoked")
      .withArgs(id, issuer.address, anyValue);

    expect(await registry.isCredentialRevoked(id)).to.equal(true);
  });

  it("rejects revoking the same credential twice", async () => {
    const { registry, issuer } = await deployWithIssuer();
    const id = credentialId("CRED-005");
    await registry.connect(issuer).revokeCredential(id);

    await expect(registry.connect(issuer).revokeCredential(id)).to.be.revertedWith("Credential already revoked");
  });

  it("rejects revocation from a wallet that is not a currently authorised issuer", async () => {
    const { registry } = await deployWithIssuer();
    const [, , randomAccount] = await ethers.getSigners();

    await expect(
      registry.connect(randomAccount).revokeCredential(credentialId("CRED-005")),
    ).to.be.revertedWith("Caller is not a currently authorised issuer");
  });

  it("rejects revocation from a wallet that has since been revoked as an issuer", async () => {
    const { registry, admin, issuer } = await deployWithIssuer();
    await registry.connect(admin).revokeIssuer(issuer.address);

    await expect(registry.connect(issuer).revokeCredential(credentialId("CRED-005"))).to.be.revertedWith(
      "Caller is not a currently authorised issuer",
    );
  });
});
