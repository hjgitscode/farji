import { describe, expect, it } from "vitest";
import { DEMO_WALLETS, findDemoWalletByAddress } from "@/lib/crypto/demoWallets";

// These are the well-known Hardhat default account addresses (derived
// from the standard "test test test ... junk" mnemonic) — see
// lib/crypto/demoWallets.ts. Pinning them here catches any future
// accidental change to the mnemonic or derivation path.
describe("DEMO_WALLETS", () => {
  it("derives the well-known Hardhat default account addresses", () => {
    expect(DEMO_WALLETS.IITD.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(DEMO_WALLETS.XYZ_ORIGINAL.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(DEMO_WALLETS.XYZ_ROTATED.address).toBe("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    expect(DEMO_WALLETS.ABC.address).toBe("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    expect(DEMO_WALLETS.PQR.address).toBe("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
  });

  it("every private key is a well-formed 32-byte hex string", () => {
    for (const wallet of Object.values(DEMO_WALLETS)) {
      expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }
  });

  it("finds a wallet by address case-insensitively", () => {
    const found = findDemoWalletByAddress(DEMO_WALLETS.IITD.address.toLowerCase());
    expect(found?.address).toBe(DEMO_WALLETS.IITD.address);
  });

  it("returns undefined for an unknown address", () => {
    expect(findDemoWalletByAddress("0x000000000000000000000000000000000000ff")).toBeUndefined();
  });
});
