import type { Metadata } from "next";
import { acceptBindingAction, prepareBindingAction } from "@/app/issuer/chain-actions";
import { short } from "@/components/wallet/TxTable";
import { SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { configuredChainId, issuerWallets } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Issuer wallet" };

export default async function IssuerWalletPage() {
  const actor = await requireIssuer("/issuer/wallet");
  const wallets = await issuerWallets(getDb(), actor);
  const chainId = configuredChainId();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Issuer wallet</h1>
      <p className="text-sm text-neutral-700">
        Your organisation&apos;s administrator authorises wallets on-chain. To use one, connect it and sign a short message that proves you control it; it is then bound to your account.
      </p>
      {chainId ? (
        <SignButton label="Connect wallet and prove control" chainId={chainId} prepare={prepareBindingAction} accept={acceptBindingAction} />
      ) : (
        <p className="text-sm text-red-700">Blockchain features are not configured on this server.</p>
      )}
      <ul className="space-y-2">
        {wallets.map((w) => (
          <li key={w.id} className="rounded border border-neutral-200 p-3 text-sm">
            <p className="font-medium">{short(w.walletAddress)}</p>
            <p className="text-neutral-700">
              {w.compromisedAt ? "compromised" : w.validUntil ? "retired" : "active"} · authorisation {w.authoriseTransaction?.status ?? "not recorded"} ·{" "}
              {w.boundToYou ? "bound to you" : w.bound ? "bound to a colleague" : "not bound"}
            </p>
          </li>
        ))}
        {wallets.length === 0 ? <li className="text-sm text-neutral-700">No issuer wallets have been authorised for your organisation yet.</li> : null}
      </ul>
    </section>
  );
}
