import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying NotSoFarjiRegistry with account:", deployer.address);

  const Registry = await ethers.getContractFactory("NotSoFarjiRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  console.log("NotSoFarjiRegistry deployed to:", await registry.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
