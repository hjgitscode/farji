import type { Metadata } from "next";
import { acceptBindingAction, prepareBindingAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, EmptyState, Icon, Mono, PageHeader, Panel } from "@/components/ui";
import { SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDate, NETWORK_NAME } from "@/lib/format";
import { configuredChainId, issuerWallets } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Signing wallet" };

export default async function IssuerWalletPage() {
  const actor = await requireIssuer("/issuer/wallet");
  const wallets = await issuerWallets(getDb(), actor);
  const chainId = configuredChainId();
  const mine = wallets.find((w) => w.boundToYou && !w.validUntil && !w.compromisedAt);
  return (
    <div>
      <PageHeader title="Signing wallet" description="Your organisation's administrator authorises wallets. To use one, connect it and sign a short message that proves you control it." />
      <div className="space-y-5">
        {mine ? (
          <Card className="flex flex-wrap items-center gap-4 border-emerald-200 bg-gradient-to-br from-white to-emerald-50/50">
            <span className="flex size-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Icon name="shield-check" className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Your wallet is connected and authorised</p>
              <p className="text-sm text-neutral-600">
                <Mono>{mine.walletAddress}</Mono>
              </p>
            </div>
            <Badge tone="verified" icon="check">
              Proof of control complete
            </Badge>
          </Card>
        ) : chainId ? (
          <Panel title="Connect your wallet" description="Free: it sends nothing to the network and gives FARJI no access to your funds.">
            <div className="space-y-3">
              <p className="text-sm text-neutral-700">You will sign a short message that proves you control the authorised wallet. After that you can sign credentials and anchor batches.</p>
              <SignButton label="Connect wallet and prove control" icon="wallet" chainId={chainId} prepare={prepareBindingAction} accept={acceptBindingAction} />
            </div>
          </Panel>
        ) : (
          <Alert tone="warning">The wallet is not available: this server is not connected to the network yet.</Alert>
        )}

        {chainId ? (
          <p className="flex items-center gap-2 text-sm text-neutral-600">
            <Icon name="globe" className="size-4" />
            Network: {NETWORK_NAME[chainId] ?? `Chain ${chainId}`}
          </p>
        ) : null}

        {wallets.length === 0 ? (
          <EmptyState title="No authorised wallets" icon="wallet">
            Ask your organisation&apos;s FARJI administrator to authorise an issuer wallet.
          </EmptyState>
        ) : (
          <section className="space-y-3" aria-label="Authorised wallets">
            <h2 className="text-base font-semibold tracking-tight">Authorised wallets</h2>
            <ul className="space-y-3">
              {wallets.map((w) => (
                <Card as="li" key={w.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Mono>{w.walletAddress}</Mono>
                    <p className="mt-1.5 text-xs text-neutral-600">
                      Since {formatDate(w.validFrom)}
                      {w.validUntil ? ` · ended ${formatDate(w.validUntil)}` : ""} · authorisation {w.authoriseTransaction?.status === "FINALIZED" ? "final" : "not final yet"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={w.compromisedAt ? "danger" : w.validUntil ? "muted" : "verified"}>{w.compromisedAt ? "Compromised" : w.validUntil ? "Retired" : "Active"}</Badge>
                    <Badge tone={w.boundToYou ? "current" : "neutral"}>{w.boundToYou ? "Yours" : w.bound ? "A colleague's" : "Not connected"}</Badge>
                  </div>
                </Card>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
