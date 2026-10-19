import "@nomicfoundation/hardhat-ethers";
import type { HardhatUserConfig } from "hardhat/config";

// Hardhat 2.26 (CommonJS) - deliberately NOT Hardhat 3: the root package stays CommonJS so the
// Next.js / Prisma / Vitest project is not destabilised. Run through the npm scripts, which pass
// `--tsconfig contracts/tsconfig.json` (CommonJS settings for ts-node, separate from the app's).

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  paths: { sources: "./contracts", tests: "./contracts/test", cache: "./cache", artifacts: "./artifacts" },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.FARJI_RPC_URL ?? "http://127.0.0.1:8545", chainId: 31337 },
  },
  mocha: { timeout: 120000 },
};

export default config;
