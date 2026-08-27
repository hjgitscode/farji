import { expect } from "chai";
import { ethers } from "hardhat";

describe("NotSoFarjiRegistry — deployment", () => {
  async function deploy() {
    const [deployer] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("NotSoFarjiRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return { registry, deployer };
  }

  it("deploys successfully", async () => {
    const { registry } = await deploy();
    expect(await registry.getAddress()).to.be.properAddress;
  });

  it("grants DEFAULT_ADMIN_ROLE to the deployer", async () => {
    const { registry, deployer } = await deploy();
    const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
    expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.equal(true);
  });

  it("does not grant admin role to an unrelated account", async () => {
    const { registry } = await deploy();
    const [, other] = await ethers.getSigners();
    const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
    expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, other.address)).to.equal(false);
  });
});
