# Solidity Viva Preparation

> **Status: stub.** At least 30 likely viva questions with concise answers
> are written in **Phase 14**, once the contract exists and both developers
> have working code to reason about.

## Planned question categories

- Language/platform fundamentals: Why Solidity? Why EVM? Why Keccak-256
  instead of SHA-256? What is `bytes32`? What is `msg.sender`? What is
  `block.timestamp`? What is a mapping? What is a struct? What is an event?
- Access control: Why use `AccessControl`? What does `onlyRole` do?
- Cryptography: What is a Merkle root? Why store a root instead of every
  credential? What is an issuer wallet? What is EIP-712? What is replay
  protection? What is a nonce?
- Issuer security: How is key rotation handled? What happens if an old key
  is compromised? What is revocation?
- Project-specific novelty: What is ProofPulse? Why isn't absence from
  ProofPulse equal to terminated employment? What is CohortProof? What are
  chained Merkle anchors? What exactly is novel in NotSoFarji? How is this
  different from Blockcerts?
- Design rationale: Why do we need blockchain instead of PostgreSQL? Why do
  we still need an issuer? Can blockchain itself determine whether a degree
  is true? What happens if a candidate edits a verified credential?

Full answers are written against the actual deployed contract and tests in
Phase 14, so every answer is verifiably true of the running code rather
than aspirational.
