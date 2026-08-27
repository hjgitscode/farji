import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const orgId = (id: string) => ethers.keccak256(ethers.toUtf8Bytes(id));

describe("NotSoFarjiRegistry — issuer registry, key rotation, historical validity", () => {
  async function deployAndRegisterOrg() {
    const [admin, issuerWallet, otherWallet, nonAdmin] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("NotSoFarjiRegistry");
    const registry = await Registry.connect(admin).deploy();
    await registry.waitForDeployment();

    const organisationId = orgId("ORG-TEST");
    await registry.connect(admin).registerOrganisation(organisationId, "Test University Demo");

    return { registry, admin, issuerWallet, otherWallet, nonAdmin, organisationId };
  }

  describe("organisations", () => {
    it("registers an organisation", async () => {
      const { registry, organisationId } = await deployAndRegisterOrg();
      const org = await registry.organisations(organisationId);
      expect(org.registered).to.equal(true);
      expect(org.name).to.equal("Test University Demo");
    });

    it("rejects registering the same organisation twice", async () => {
      const { registry, admin, organisationId } = await deployAndRegisterOrg();
      await expect(registry.connect(admin).registerOrganisation(organisationId, "Duplicate")).to.be.revertedWith(
        "Organisation already registered",
      );
    });

    it("rejects organisation registration from a non-admin account", async () => {
      const { registry, nonAdmin } = await deployAndRegisterOrg();
      await expect(registry.connect(nonAdmin).registerOrganisation(orgId("ORG-X"), "Should fail")).to.be.reverted;
    });
  });

  describe("authorising issuers", () => {
    it("authorises an issuer wallet", async () => {
      const { registry, admin, issuerWallet, organisationId } = await deployAndRegisterOrg();
      const validFrom = Math.floor(Date.now() / 1000);

      await expect(registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, validFrom))
        .to.emit(registry, "IssuerAuthorised")
        .withArgs(organisationId, issuerWallet.address, validFrom);

      const record = await registry.issuerRecords(issuerWallet.address);
      expect(record.organisationId).to.equal(organisationId);
      expect(record.revoked).to.equal(false);
    });

    it("rejects issuer authorisation for an unregistered organisation", async () => {
      const { registry, admin, issuerWallet } = await deployAndRegisterOrg();
      await expect(
        registry.connect(admin).authoriseIssuer(orgId("ORG-UNKNOWN"), issuerWallet.address, 0),
      ).to.be.revertedWith("Unknown organisation");
    });

    it("rejects authorising an already-registered wallet", async () => {
      const { registry, admin, issuerWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await expect(
        registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0),
      ).to.be.revertedWith("Wallet already registered");
    });

    it("rejects issuer authorisation from a non-admin account", async () => {
      const { registry, issuerWallet, organisationId, nonAdmin } = await deployAndRegisterOrg();
      await expect(registry.connect(nonAdmin).authoriseIssuer(organisationId, issuerWallet.address, 0)).to.be
        .reverted;
    });
  });

  describe("isIssuerValidAt", () => {
    it("is valid for an authorised wallet now, and false for an unknown wallet", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, now - 1000);

      expect(await registry.isIssuerValidAt(issuerWallet.address, now)).to.equal(true);
      expect(await registry.isIssuerValidAt(otherWallet.address, now)).to.equal(false);
    });

    it("is false before validFrom and true from validFrom onward", async () => {
      const { registry, admin, issuerWallet, organisationId } = await deployAndRegisterOrg();
      const validFrom = Math.floor(Date.now() / 1000) + 10_000;
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, validFrom);

      expect(await registry.isIssuerValidAt(issuerWallet.address, validFrom - 1)).to.equal(false);
      expect(await registry.isIssuerValidAt(issuerWallet.address, validFrom)).to.equal(true);
    });
  });

  describe("revoking issuers", () => {
    it("revokes an issuer wallet", async () => {
      const { registry, admin, issuerWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);

      await expect(registry.connect(admin).revokeIssuer(issuerWallet.address)).to.emit(registry, "IssuerRevoked");

      const record = await registry.issuerRecords(issuerWallet.address);
      expect(record.revoked).to.equal(true);
    });

    it("rejects revoking an already-revoked wallet", async () => {
      const { registry, admin, issuerWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await registry.connect(admin).revokeIssuer(issuerWallet.address);

      await expect(registry.connect(admin).revokeIssuer(issuerWallet.address)).to.be.revertedWith(
        "Wallet already revoked",
      );
    });

    it("rejects revoking an unknown wallet", async () => {
      const { registry, admin, otherWallet } = await deployAndRegisterOrg();
      await expect(registry.connect(admin).revokeIssuer(otherWallet.address)).to.be.revertedWith("Unknown wallet");
    });

    it("rejects issuer revocation from a non-admin account", async () => {
      const { registry, admin, issuerWallet, organisationId, nonAdmin } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await expect(registry.connect(nonAdmin).revokeIssuer(issuerWallet.address)).to.be.reverted;
    });
  });

  describe("key rotation and historical validity", () => {
    it("keeps a signature-era timestamp valid against the OLD wallet even after rotation, while cutting off future use", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();

      const genesisTime = Math.floor(Date.now() / 1000) - 100_000;
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, genesisTime);

      // A credential is "signed" partway through the old wallet's tenure.
      const issuedAt = genesisTime + 1000;
      expect(await registry.isIssuerValidAt(issuerWallet.address, issuedAt)).to.equal(true);

      // Now the key is rotated to a new wallet.
      const rotatedAt = Math.floor(Date.now() / 1000);
      await expect(
        registry.connect(admin).rotateIssuerKey(organisationId, issuerWallet.address, otherWallet.address, rotatedAt),
      )
        .to.emit(registry, "IssuerKeyRotated")
        .withArgs(organisationId, issuerWallet.address, otherWallet.address, anyValue);

      // The historical signature is still judged valid at issuance time...
      expect(await registry.isIssuerValidAt(issuerWallet.address, issuedAt)).to.equal(true);
      // ...but the old wallet can no longer sign anything new.
      const afterRotation = rotatedAt + 10;
      expect(await registry.isIssuerValidAt(issuerWallet.address, afterRotation)).to.equal(false);
      // ...and the new wallet is valid from the rotation point onward.
      expect(await registry.isIssuerValidAt(otherWallet.address, afterRotation)).to.equal(true);
    });

    it("rejects rotating a wallet that does not belong to the given organisation", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);

      const differentOrg = orgId("ORG-OTHER");
      await registry.connect(admin).registerOrganisation(differentOrg, "Other Demo Org");

      await expect(
        registry.connect(admin).rotateIssuerKey(differentOrg, issuerWallet.address, otherWallet.address, 0),
      ).to.be.revertedWith("Old wallet belongs to a different organisation");
    });

    it("rejects rotating to a wallet that is already registered", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await registry.connect(admin).authoriseIssuer(organisationId, otherWallet.address, 0);

      await expect(
        registry.connect(admin).rotateIssuerKey(organisationId, issuerWallet.address, otherWallet.address, 0),
      ).to.be.revertedWith("New wallet already registered");
    });

    it("rejects rotating an already-revoked wallet", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await registry.connect(admin).revokeIssuer(issuerWallet.address);

      await expect(
        registry.connect(admin).rotateIssuerKey(organisationId, issuerWallet.address, otherWallet.address, 0),
      ).to.be.revertedWith("Old wallet already revoked");
    });

    it("rejects key rotation from a non-admin account", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId, nonAdmin } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await expect(
        registry.connect(nonAdmin).rotateIssuerKey(organisationId, issuerWallet.address, otherWallet.address, 0),
      ).to.be.reverted;
    });

    it("records both wallets in the organisation's issuer history after rotation", async () => {
      const { registry, admin, issuerWallet, otherWallet, organisationId } = await deployAndRegisterOrg();
      await registry.connect(admin).authoriseIssuer(organisationId, issuerWallet.address, 0);
      await registry.connect(admin).rotateIssuerKey(organisationId, issuerWallet.address, otherWallet.address, 0);

      const history = await registry.getIssuerHistory(organisationId);
      expect(history).to.deep.equal([issuerWallet.address, otherWallet.address]);
    });
  });
});
