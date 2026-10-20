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
  if (e instanceof WalletError) return e.message;
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return "The request was rejected in the wallet.";
  return err?.message ? String(err.message).slice(0, 200) : "The wallet request failed.";
}
