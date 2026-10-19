import { ethers } from "hardhat";

// Deploys FarjiRegistry to the configured Hardhat network (local node: `npm run chain:node`, then
// `npm run chain:deploy:local`). The deployer pays gas only; after deployment it holds
// DEFAULT_ADMIN_ROLE (grant/revoke PLATFORM_ADMIN_ROLE only) unless FARJI_DEFAULT_ADMIN is set.
// The platform admin is the Admin's browser wallet (a PUBLIC address): FARJI_ADMIN_WALLET.
// No private key is read from the environment by this project: on a public network use a hardware
// wallet or Hardhat's encrypted keystore for the deployer.

async function main() {
  const [deployer] = await ethers.getSigners();
  const platformAdmin = process.env.FARJI_ADMIN_WALLET ?? deployer.address;
  const defaultAdmin = process.env.FARJI_DEFAULT_ADMIN ?? deployer.address;
  const delay = Number(process.env.FARJI_ADMIN_DELAY_SECONDS ?? "0"); // use >= 86400 on public networks

  const registry = await ethers.deployContract("FarjiRegistry", [delay, defaultAdmin, platformAdmin]);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log(`FarjiRegistry deployed`);
  console.log(`  address:        ${address}`);
  console.log(`  chainId:        ${network.chainId}`);
  console.log(`  defaultAdmin:   ${defaultAdmin}`);
  console.log(`  platformAdmin:  ${platformAdmin}`);
  console.log(`\nSet in .env.local:\n  FARJI_CHAIN_ID=${network.chainId}\n  FARJI_REGISTRY_ADDRESS=${address.toLowerCase()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
