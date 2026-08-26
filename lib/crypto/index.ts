export * from "./types";
export { canonicaliseCredential, canonicalCredentialToString, canonicalise } from "./canonicalise";
export { toCanonicalInput } from "./fromMockCredential";
export { keccak256Utf8, hashCanonicalCredential, hashCredential } from "./hash";
export {
  buildDomain,
  buildCredentialAttestationMessage,
  signCredentialAttestation,
  recoverCredentialAttestationSigner,
  CREDENTIAL_ATTESTATION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  LOCAL_CHAIN_ID,
  PLACEHOLDER_VERIFYING_CONTRACT,
} from "./eip712";
export type { EIP712Domain, CredentialAttestationMessage } from "./eip712";
export { DEMO_WALLETS, findDemoWalletByAddress } from "./demoWallets";
export type { DemoWallet } from "./demoWallets";
