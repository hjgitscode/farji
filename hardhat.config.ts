import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Local-only configuration for Review 2.
// Sepolia/Amoy network config is deferred to Review 3 (see docs/REVIEW3_FUTURE_WORK.md).
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contract",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
  },
};

export default config;
