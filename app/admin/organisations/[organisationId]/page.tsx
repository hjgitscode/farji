import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildAdminTxAction, recordAdminTxAction } from "@/app/admin/actions";
import { Alert, Badge, btn, Card, EmptyState, Facts, PageHeader, Section } from "@/components/ui";
import { ParamTxButton } from "@/components/wallet/ParamForms";
import { short } from "@/components/wallet/TxTable";
import { TxButton } from "@/components/wallet/WalletButtons";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDate } from "@/lib/format";
import { DomainError } from "@/server/candidate/errors";
import { adminGetOrganisation, configuredChainId } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Organisation" };

const STATUS_LABEL: Record<string, string> = { PENDING_ONBOARDING: "Awaiting registration", ACTIVE: "Active", SUSPENDED: "Suspended" };

export default async function AdminOrganisationPage({ params }: { params: Promise<{ organisationId: string }> }) {
  const { organisationId } = await params;
  const actor = await requireAdmin("/admin/organisations");
  let org;
  try {
    org = await adminGetOrganisation(getDb(), actor, organisationId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const chainId = configuredChainId();
  const build = (purpose: string, targetId: string) => buildAdminTxAction.bind(null, purpose, targetId);
  const record = (purpose: string, targetId: string) => recordAdminTxAction.bind(null, purpose, targetId);
  const activeMembers = org.members.filter((m) => m.status === "ACTIVE").length;

  return (
    <div className="space-y-8">
      <p>
        <Link href="/admin/organisations" className={btn.link}>
          ← All organisations
        </Link>
      </p>
      <PageHeader title={org.displayName} description={`${org.legalName} · ${org.kind.toLowerCase().replaceAll("_", " ")}`} actions={<Badge tone={org.status === "ACTIVE" ? "verified" : org.status === "SUSPENDED" ? "attention" : "pending"}>{STATUS_LABEL[org.status] ?? org.status}</Badge>} />
      <Facts items={[["Confirmation freshness window", `${org.pulseFreshnessDays} days`], ["Network identifier", <code key="o" className="text-xs">{short(org.orgId)}</code>]]} />

      {!chainId ? <Alert tone="warning">Governance actions need a network connection, which this server does not have yet.</Alert> : null}

      {chainId ? (
        <Section title="Registration and status" description="Admins govern organisations. They cannot issue, end or revoke credentials.">
          {org.status === "PENDING_ONBOARDING" ? (
            <TxButton label="Register organisation" chainId={chainId} build={build("REGISTER_ORGANISATION", org.id).bind(null, {})} record={record("REGISTER_ORGANISATION", org.id)} />
          ) : org.status === "ACTIVE" ? (
            <div className="space-y-2">
              <p className="text-sm text-neutral-600">Suspending blocks new confirmations and new wallets. Existing records and any revocation stay valid.</p>
              <ParamTxButton label="Suspend organisation" chainId={chainId} paramName="status" kind="choice" options={[{ value: "SUSPENDED", label: "Suspend" }]} confirm={{ title: "Suspend this organisation?", body: "Its issuers will not be able to approve, sign or anchor until it is reactivated.", danger: true }} build={build("SET_ORGANISATION_STATUS", org.id)} record={record("SET_ORGANISATION_STATUS", org.id)} />
            </div>
          ) : (
            <ParamTxButton label="Reactivate organisation" chainId={chainId} paramName="status" kind="choice" options={[{ value: "ACTIVE", label: "Reactivate" }]} build={build("SET_ORGANISATION_STATUS", org.id)} record={record("SET_ORGANISATION_STATUS", org.id)} />
          )}
        </Section>
      ) : null}

      <Section title="Members" description={`${activeMembers} active member${activeMembers === 1 ? "" : "s"} can act for this organisation. Accounts are provisioned by an administrator.`}>
        {org.members.length === 0 ? (
          <EmptyState title="No members yet">Issuer accounts are linked to the organisation outside this page.</EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {org.members.map((m, i) => (
              <Card as="li" key={m.id} className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">Member {i + 1}</p>
                  <p className="text-xs text-neutral-600">
                    {m.joinedAt ? `Joined ${formatDate(m.joinedAt)}` : `Invited ${formatDate(m.invitedAt)}`}
                    {m.removedAt ? ` · removed ${formatDate(m.removedAt)}` : ""} · {m.operatedKeys.length} wallet{m.operatedKeys.length === 1 ? "" : "s"} connected
                  </p>
                </div>
                <Badge tone={m.status === "ACTIVE" ? "verified" : m.status === "INVITED" ? "pending" : "muted"}>{m.status.toLowerCase()}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </Section>

      {chainId && org.status === "ACTIVE" ? (
        <Section title="Authorise an issuer wallet" description="A wallet can be authorised once, ever. Use a fresh wallet that has never been an issuer wallet.">
          <ParamTxButton label="Authorise wallet" chainId={chainId} paramName="wallet" placeholder="0x… issuer wallet address" build={build("AUTHORISE_ISSUER_KEY", org.id)} record={record("AUTHORISE_ISSUER_KEY", org.id)} />
        </Section>
      ) : null}

      <Section title="Issuer wallets">
        {org.issuerKeys.length === 0 ? (
          <EmptyState title="No wallets yet">Authorise a wallet so an issuer can sign for this organisation.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {org.issuerKeys.map((k) => {
              const open = !k.validUntil && !k.compromisedAt;
              return (
                <Card as="li" key={k.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-sm">{k.walletAddress}</p>
                      <p className="text-xs text-neutral-600">
                        From {formatDate(k.validFrom)}
                        {k.validUntil ? ` until ${formatDate(k.validUntil)}` : ""} · authorisation {k.authoriseTransaction?.status === "FINALIZED" ? "final" : "not final yet"}
                        {k.operatorMemberId ? " · connected by a member" : ""}
                      </p>
                    </div>
                    <Badge tone={k.compromisedAt ? "danger" : k.validUntil ? "muted" : "verified"}>{k.compromisedAt ? "Compromised" : k.validUntil ? "Retired" : "Active"}</Badge>
                  </div>
                  {chainId && open ? (
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1 text-sm font-medium">Retire</p>
                        <TxButton label="Retire wallet" chainId={chainId} build={build("RETIRE_ISSUER_KEY", k.id).bind(null, {})} record={record("RETIRE_ISSUER_KEY", k.id)} />
                      </div>
                      <div>
                        <p className="mb-1 text-sm font-medium">Rotate to a fresh wallet</p>
                        <ParamTxButton label="Rotate wallet" chainId={chainId} paramName="newWallet" placeholder="0x… new wallet address" build={build("RETIRE_ISSUER_KEY", k.id)} record={record("RETIRE_ISSUER_KEY", k.id)} />
                      </div>
                    </div>
                  ) : null}
                  {chainId && !k.compromisedAt ? (
                    <details className="rounded-lg border border-rose-200 bg-rose-50/40 p-3 text-sm">
                      <summary className="cursor-pointer font-medium text-rose-900">Mark this wallet compromised…</summary>
                      <div className="mt-3 space-y-2">
                        <p className="text-neutral-800">Evidence this wallet anchored from the chosen moment onward stops counting as valid. Use this only if the wallet may have been misused.</p>
                        <ParamTxButton label="Mark compromised" chainId={chainId} paramName="compromisedAt" kind="datetime" confirm={{ title: "Mark this wallet compromised?", body: "This is permanent. It retires the wallet immediately and invalidates later evidence anchored from the chosen moment.", danger: true }} build={build("MARK_ISSUER_KEY_COMPROMISED", k.id)} record={record("MARK_ISSUER_KEY_COMPROMISED", k.id)} />
                      </div>
                    </details>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
