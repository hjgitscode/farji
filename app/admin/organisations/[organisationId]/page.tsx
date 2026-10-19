import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildAdminTxAction, recordAdminTxAction } from "@/app/admin/actions";
import { ParamTxButton } from "@/components/wallet/ParamForms";
import { TxButton } from "@/components/wallet/WalletButtons";
import { short } from "@/components/wallet/TxTable";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { adminGetOrganisation, configuredChainId } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Organisation" };

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

  return (
    <section className="space-y-6">
      <p>
        <Link href="/admin/organisations" className="text-sm underline">
          ← All organisations
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{org.displayName}</h1>
        <p className="text-sm text-neutral-700">
          {org.legalName} · {org.kind.toLowerCase().replaceAll("_", " ")} · status {org.status.toLowerCase().replaceAll("_", " ")}
        </p>
        <p className="text-xs text-neutral-600">On-chain id {short(org.orgId)}</p>
      </div>

      {!chainId ? <p className="text-sm text-red-700">Blockchain features are not configured on this server.</p> : null}

      {chainId ? (
        <>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Registration and status</h2>
            {org.status === "PENDING_ONBOARDING" ? (
              <TxButton label="Register on-chain" chainId={chainId} build={build("REGISTER_ORGANISATION", org.id).bind(null, {})} record={record("REGISTER_ORGANISATION", org.id)} />
            ) : (
              <div className="flex flex-wrap gap-4">
                {org.status === "ACTIVE" ? (
                  <ParamTxButton label="Suspend" chainId={chainId} paramName="status" kind="choice" options={[{ value: "SUSPENDED", label: "SUSPENDED" }]} build={build("SET_ORGANISATION_STATUS", org.id)} record={record("SET_ORGANISATION_STATUS", org.id)} />
                ) : (
                  <ParamTxButton label="Reactivate" chainId={chainId} paramName="status" kind="choice" options={[{ value: "ACTIVE", label: "ACTIVE" }]} build={build("SET_ORGANISATION_STATUS", org.id)} record={record("SET_ORGANISATION_STATUS", org.id)} />
                )}
              </div>
            )}
          </div>

          {org.status === "ACTIVE" ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Authorise an issuer wallet</h2>
              <p className="text-sm text-neutral-700">A wallet can be authorised once, ever. Use a fresh wallet that has never been an issuer wallet.</p>
              <ParamTxButton label="Authorise wallet" chainId={chainId} paramName="wallet" placeholder="0x… issuer wallet" build={build("AUTHORISE_ISSUER_KEY", org.id)} record={record("AUTHORISE_ISSUER_KEY", org.id)} />
            </div>
          ) : null}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Issuer wallets</h2>
            {org.issuerKeys.length === 0 ? <p className="text-sm text-neutral-700">None yet.</p> : null}
            <ul className="space-y-3">
              {org.issuerKeys.map((k) => {
                const open = !k.validUntil && !k.compromisedAt;
                return (
                  <li key={k.id} className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
                    <p className="font-medium">
                      {k.walletAddress}{" "}
                      <span className="font-normal text-neutral-700">
                        · {k.compromisedAt ? "compromised" : k.validUntil ? "retired" : "active"} · from {k.validFrom.toISOString().slice(0, 10)}
                        {k.validUntil ? ` until ${k.validUntil.toISOString().slice(0, 10)}` : ""} · authorisation {k.authoriseTransaction?.status ?? "not recorded"}
                      </span>
                    </p>
                    {open ? (
                      <div className="flex flex-col gap-3">
                        <TxButton label="Retire" chainId={chainId} build={build("RETIRE_ISSUER_KEY", k.id).bind(null, {})} record={record("RETIRE_ISSUER_KEY", k.id)} />
                        <ParamTxButton label="Rotate to a fresh wallet" chainId={chainId} paramName="newWallet" placeholder="0x… new wallet" build={build("RETIRE_ISSUER_KEY", k.id)} record={record("RETIRE_ISSUER_KEY", k.id)} />
                      </div>
                    ) : null}
                    {!k.compromisedAt ? (
                      <ParamTxButton label="Mark compromised from…" chainId={chainId} paramName="compromisedAt" kind="datetime" build={build("MARK_ISSUER_KEY_COMPROMISED", k.id)} record={record("MARK_ISSUER_KEY_COMPROMISED", k.id)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
