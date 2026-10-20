import type { Metadata } from "next";
import { acceptBindingAction, prepareBindingAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { short } from "@/components/wallet/TxTable";
import { SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDate } from "@/lib/format";
import { configuredChainId, issuerWallets } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Wallet" };

export default async function IssuerWalletPage() {
  const actor = await requireIssuer("/issuer/wallet");
  const wallets = await issuerWallets(getDb(), actor);
  const chainId = configuredChainId();
  return (
    <div className="space-y-6">
      <PageHeader title="Issuer wallet" description="Your organisation's administrator authorises wallets. To use one, connect it and sign a short message that proves you control it." />
      {chainId ? (
        <Card className="space-y-2">
          <p className="text-sm text-neutral-700">Connecting does not cost anything and does not give FARJI access to your funds.</p>
          <SignButton label="Connect wallet and prove control" chainId={chainId} prepare={prepareBindingAction} accept={acceptBindingAction} />
        </Card>
      ) : (
        <Alert tone="warning">The wallet is not available: this server is not connected to the network yet.</Alert>
      )}
      {wallets.length === 0 ? (
        <EmptyState title="No authorised wallets">Ask your organisation&apos;s FARJI administrator to authorise an issuer wallet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {wallets.map((w) => (
            <Card as="li" key={w.id} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm">{short(w.walletAddress)}</p>
                <p className="text-xs text-neutral-600">
                  Since {formatDate(w.validFrom)}
                  {w.validUntil ? ` · ended ${formatDate(w.validUntil)}` : ""} · authorisation {w.authoriseTransaction?.status === "FINALIZED" ? "final" : "not final yet"}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge tone={w.compromisedAt ? "danger" : w.validUntil ? "muted" : "verified"}>{w.compromisedAt ? "Compromised" : w.validUntil ? "Retired" : "Active"}</Badge>
                <Badge tone={w.boundToYou ? "current" : "neutral"}>{w.boundToYou ? "Yours" : w.bound ? "A colleague's" : "Not connected"}</Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
