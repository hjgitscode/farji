"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KeyHistoryTable } from "@/app/admin/KeyHistoryTable";
import { getOrganisations } from "@/lib/services/organisationService";
import type { IssuerKeyRecord } from "@/lib/mock-data/types";

const today = () => new Date().toISOString().slice(0, 10);

export function AdminDashboardClient({ initialRecords }: { initialRecords: IssuerKeyRecord[] }) {
  const organisations = getOrganisations();
  const [records, setRecords] = useState(initialRecords);

  const [authOrg, setAuthOrg] = useState(organisations[0]?.organisationId ?? "");
  const [authWallet, setAuthWallet] = useState("");

  const activeWallets = records.filter((r) => r.status === "ACTIVE");
  const [revokeWallet, setRevokeWallet] = useState(activeWallets[0]?.wallet ?? "");

  const [rotateOrg, setRotateOrg] = useState(organisations[0]?.organisationId ?? "");
  const [rotateNewWallet, setRotateNewWallet] = useState("");

  function authoriseIssuer() {
    if (!authWallet.trim()) return;
    setRecords((prev) => [
      ...prev,
      { organisationId: authOrg, wallet: authWallet.trim(), validFrom: today(), validUntil: null, status: "ACTIVE" },
    ]);
    setAuthWallet("");
  }

  function revokeIssuer() {
    if (!revokeWallet) return;
    setRecords((prev): IssuerKeyRecord[] =>
      prev.map((r): IssuerKeyRecord =>
        r.wallet === revokeWallet ? { ...r, validUntil: today(), status: "REVOKED" } : r,
      ),
    );
  }

  function rotateKey() {
    const oldWallet = records.find((r) => r.organisationId === rotateOrg && r.status === "ACTIVE");
    if (!oldWallet || !rotateNewWallet.trim()) return;
    const newWallet: IssuerKeyRecord = {
      organisationId: rotateOrg,
      wallet: rotateNewWallet.trim(),
      validFrom: today(),
      validUntil: null,
      status: "ACTIVE",
    };
    setRecords((prev): IssuerKeyRecord[] => [
      ...prev.map((r): IssuerKeyRecord =>
        r.wallet === oldWallet.wallet ? { ...r, validUntil: today(), status: "REVOKED" } : r,
      ),
      newWallet,
    ]);
    setRotateNewWallet("");
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <p className="font-semibold text-slate-900">Authorise Issuer Wallet</p>
          <div className="mt-3 space-y-2">
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={authOrg}
              onChange={(e) => setAuthOrg(e.target.value)}
            >
              {organisations.map((org) => (
                <option key={org.organisationId} value={org.organisationId}>
                  {org.name}
                </option>
              ))}
            </select>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="0x..."
              value={authWallet}
              onChange={(e) => setAuthWallet(e.target.value)}
            />
            <Button onClick={authoriseIssuer}>Authorise</Button>
          </div>
        </Card>

        <Card>
          <p className="font-semibold text-slate-900">Revoke Issuer Wallet</p>
          <div className="mt-3 space-y-2">
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              value={revokeWallet}
              onChange={(e) => setRevokeWallet(e.target.value)}
            >
              {activeWallets.map((r) => (
                <option key={r.wallet} value={r.wallet}>
                  {r.wallet}
                </option>
              ))}
            </select>
            <Button variant="danger" onClick={revokeIssuer} disabled={activeWallets.length === 0}>
              Revoke
            </Button>
          </div>
        </Card>

        <Card>
          <p className="font-semibold text-slate-900">Rotate Issuer Key</p>
          <div className="mt-3 space-y-2">
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={rotateOrg}
              onChange={(e) => setRotateOrg(e.target.value)}
            >
              {organisations.map((org) => (
                <option key={org.organisationId} value={org.organisationId}>
                  {org.name}
                </option>
              ))}
            </select>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="New wallet 0x..."
              value={rotateNewWallet}
              onChange={(e) => setRotateNewWallet(e.target.value)}
            />
            <Button onClick={rotateKey}>Rotate Key</Button>
            <p className="text-xs text-slate-400">
              The old wallet stays valid for anything it signed before today.
            </p>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Issuer Key History</h2>
        <KeyHistoryTable records={records} />
      </div>
    </div>
  );
}
