// Browser-wallet helpers (EIP-1193, e.g. MetaMask). CLIENT-SIDE ONLY.
//
// The browser may provide exactly three things: the connected account, a signature, and a
// transaction hash. It never chooses an organisation, credential, salt, digest, root, leaf count,
// sequence number, schema id or owner: those are built by the server from its own database, and the
// server re-checks every reported transaction against its own RPC. No private key ever exists in the
// FARJI application: the wallet signs, the server only builds, verifies and observes.

type Eip1193 = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export class WalletError extends Error {}

/**
 * A refusal returned by a FARJI server action (`{ ok: false, error }`). Its text was already reduced to a safe,
 * user-facing sentence on the server (`server/chain/results.ts` `toFail`), so it is shown as is - e.g. "A transaction
 * for this is already in progress." - instead of being hidden behind the generic wallet message.
 */
export class ServerRefusal extends Error {}

const MAX_REFUSAL_LENGTH = 300;

/** Throws the server's refusal so the button shows it. */
export function refuse(error: unknown): never {
  const text = typeof error === "string" ? error.trim() : "";
  throw new ServerRefusal(text && text.length <= MAX_REFUSAL_LENGTH ? text : "Something went wrong. Please try again.");
}

function ethereum(): Eip1193 {
  if (typeof window === "undefined" || !window.ethereum) throw new WalletError("No browser wallet was found. Install a wallet such as MetaMask, then try again.");
  return window.ethereum;
}

const hexChain = (chainId: string) => "0x" + BigInt(chainId).toString(16);

/** Connects the wallet and makes sure it is on the chain the registry lives on. Returns the lowercase account. */
export async function connectWallet(chainId: string): Promise<string> {
  const eth = ethereum();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts?.[0];
  if (!account) throw new WalletError("The wallet did not provide an account.");
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (BigInt(current) !== BigInt(chainId)) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain(chainId) }] });
    } catch {
      throw new WalletError(`Your wallet is on the wrong network. Switch it to network ${chainId} and try again.`);
    }
  }
  return account.toLowerCase();
}

/** EIP-712 `eth_signTypedData_v4` over the typed data the SERVER built. */
export async function signTypedData(account: string, typedData: unknown): Promise<string> {
  return (await ethereum().request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] })) as string;
}

/** Broadcasts a transaction the SERVER built. Returns the hash the wallet reports. */
export async function sendTransaction(account: string, tx: { to: string; data: string }): Promise<string> {
  return (await ethereum().request({ method: "eth_sendTransaction", params: [{ from: account, to: tx.to, data: tx.data }] })) as string;
}

export function walletMessage(e: unknown): string {
  if (e instanceof WalletError || e instanceof ServerRefusal) return e.message;
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  if (err?.code === -32002) return "Your wallet already has a request waiting. Open it, answer it, then try again.";
  if (err?.code === 4900 || err?.code === 4901) return "Your wallet is disconnected from the network. Reconnect it and try again.";
  const text = String(err?.message ?? "");
  if (/insufficient funds/i.test(text)) return "The wallet does not have enough test ETH to pay the network fee.";
  if (/user rejected|user denied/i.test(text)) return "You declined the request in your wallet. Nothing was sent.";
  if (/revert|execution reverted/i.test(text)) return "The network rejected the transaction. Nothing changed; check the details and try again.";
  return "The wallet request did not complete. Please try again.";
}
