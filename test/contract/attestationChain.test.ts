import { expect } from "chai";
import { ethers } from "hardhat";

const orgId = (id: string) => ethers.keccak256(ethers.toUtf8Bytes(id));
const GENESIS_ROOT = ethers.ZeroHash;

// Matches the enum declaration order in NotSoFarjiRegistry.sol.
const AttestationType = { COHORT: 0, PROOF_PULSE: 1 } as const;

function computeChainRoot(
  batchRoot: string,
  previousChainRoot: string,
  organisationId: string,
  attestationType: number,
  epoch: number,
) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "uint8", "uint64"],
      [batchRoot, previousChainRoot, organisationId, attestationType, epoch],
    ),
  );
}

describe("NotSoFarjiRegistry — attestation anchoring & chain continuity", () => {
  async function deployWithIssuer() {
    const [admin, issuer, otherIssuer] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("NotSoFarjiRegistry");
    const registry = await Registry.connect(admin).deploy();
    await registry.waitForDeployment();

    const organisationId = orgId("ORG-XYZ");
    await registry.connect(admin).registerOrganisation(organisationId, "XYZ Technologies Demo");
    await registry.connect(admin).authoriseIssuer(organisationId, issuer.address, 0);

    const otherOrgId = orgId("ORG-OTHER");
    await registry.connect(admin).registerOrganisation(otherOrgId, "Other Demo Org");
    await registry.connect(admin).authoriseIssuer(otherOrgId, otherIssuer.address, 0);

    return { registry, admin, issuer, otherIssuer, organisationId, otherOrgId };
  }

  it("anchors a CohortProof epoch with the correct chained root", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const batchRoot = ethers.keccak256(ethers.toUtf8Bytes("cohort-batch-1"));

    const expectedChainRoot = computeChainRoot(batchRoot, GENESIS_ROOT, organisationId, AttestationType.COHORT, 1);

    await expect(registry.connect(issuer).anchorAttestation(organisationId, AttestationType.COHORT, 1, batchRoot, GENESIS_ROOT))
      .to.emit(registry, "AttestationAnchored")
      .withArgs(organisationId, AttestationType.COHORT, 1, batchRoot, expectedChainRoot, issuer.address);

    const attestation = await registry.getAttestation(organisationId, AttestationType.COHORT, 1);
    expect(attestation.batchRoot).to.equal(batchRoot);
    expect(attestation.chainRoot).to.equal(expectedChainRoot);
    expect(await registry.getCurrentChainRoot(organisationId, AttestationType.COHORT)).to.equal(expectedChainRoot);
  });

  it("anchors a ProofPulse epoch independently of the same org's CohortProof stream", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const cohortRoot = ethers.keccak256(ethers.toUtf8Bytes("cohort-batch"));
    const pulseRoot = ethers.keccak256(ethers.toUtf8Bytes("pulse-batch"));

    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.COHORT, 1, cohortRoot, GENESIS_ROOT);
    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 1, pulseRoot, GENESIS_ROOT);

    // Two independent streams for the same org — neither's chain head affects the other.
    const cohortHead = await registry.getCurrentChainRoot(organisationId, AttestationType.COHORT);
    const pulseHead = await registry.getCurrentChainRoot(organisationId, AttestationType.PROOF_PULSE);
    expect(cohortHead).to.not.equal(pulseHead);
  });

  it("chains a second epoch onto the first correctly", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const augustRoot = ethers.keccak256(ethers.toUtf8Bytes("august"));
    const septemberRoot = ethers.keccak256(ethers.toUtf8Bytes("september"));

    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 1, augustRoot, GENESIS_ROOT);
    const augustChainRoot = await registry.getCurrentChainRoot(organisationId, AttestationType.PROOF_PULSE);

    const expectedSeptemberChainRoot = computeChainRoot(
      septemberRoot,
      augustChainRoot,
      organisationId,
      AttestationType.PROOF_PULSE,
      2,
    );

    await registry
      .connect(issuer)
      .anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 2, septemberRoot, augustChainRoot);

    expect(await registry.getCurrentChainRoot(organisationId, AttestationType.PROOF_PULSE)).to.equal(
      expectedSeptemberChainRoot,
    );
  });

  it("rejects an attestation submitted against the wrong previous chain root", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const augustRoot = ethers.keccak256(ethers.toUtf8Bytes("august"));
    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 1, augustRoot, GENESIS_ROOT);

    const septemberRoot = ethers.keccak256(ethers.toUtf8Bytes("september"));
    const wrongPreviousRoot = ethers.keccak256(ethers.toUtf8Bytes("not-the-real-previous-root"));

    await expect(
      registry
        .connect(issuer)
        .anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 2, septemberRoot, wrongPreviousRoot),
    ).to.be.revertedWith("Invalid previous chain root");
  });

  it("rejects anchoring the same epoch twice", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const batchRoot = ethers.keccak256(ethers.toUtf8Bytes("batch"));
    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.COHORT, 1, batchRoot, GENESIS_ROOT);

    await expect(
      registry.connect(issuer).anchorAttestation(organisationId, AttestationType.COHORT, 1, batchRoot, GENESIS_ROOT),
    ).to.be.revertedWith("Epoch already anchored");
  });

  it("rejects an attestation from a wallet that is not a currently authorised issuer", async () => {
    const { registry, organisationId } = await deployWithIssuer();
    const [, , , randomAccount] = await ethers.getSigners();
    const batchRoot = ethers.keccak256(ethers.toUtf8Bytes("batch"));

    await expect(
      registry.connect(randomAccount).anchorAttestation(organisationId, AttestationType.COHORT, 1, batchRoot, GENESIS_ROOT),
    ).to.be.revertedWith("Caller is not a currently authorised issuer");
  });

  it("rejects an attestation from an issuer authorised for a different organisation", async () => {
    const { registry, otherIssuer, organisationId } = await deployWithIssuer();
    const batchRoot = ethers.keccak256(ethers.toUtf8Bytes("batch"));

    await expect(
      registry.connect(otherIssuer).anchorAttestation(organisationId, AttestationType.COHORT, 1, batchRoot, GENESIS_ROOT),
    ).to.be.revertedWith("Caller not authorised for this organisation");
  });

  it("lists anchored epochs in submission order", async () => {
    const { registry, issuer, organisationId } = await deployWithIssuer();
    const rootA = ethers.keccak256(ethers.toUtf8Bytes("a"));
    const rootB = ethers.keccak256(ethers.toUtf8Bytes("b"));

    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 1, rootA, GENESIS_ROOT);
    const chainRootA = await registry.getCurrentChainRoot(organisationId, AttestationType.PROOF_PULSE);
    await registry.connect(issuer).anchorAttestation(organisationId, AttestationType.PROOF_PULSE, 2, rootB, chainRootA);

    const epochs = await registry.getEpochs(organisationId, AttestationType.PROOF_PULSE);
    expect(epochs).to.deep.equal([1n, 2n]);
  });
});
