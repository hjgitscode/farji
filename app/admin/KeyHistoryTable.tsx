import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getOrganisationById } from "@/lib/services/organisationService";
import type { IssuerKeyRecord } from "@/lib/mock-data/types";

function truncateWallet(wallet: string) {
  return `${wallet.slice(0, 8)}…${wallet.slice(-4)}`;
}

export function KeyHistoryTable({ records }: { records: IssuerKeyRecord[] }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-400">
            <th className="py-2 pr-4 font-medium">Organisation</th>
            <th className="py-2 pr-4 font-medium">Wallet</th>
            <th className="py-2 pr-4 font-medium">Valid from</th>
            <th className="py-2 pr-4 font-medium">Valid until</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.wallet} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4">{getOrganisationById(record.organisationId)?.name ?? record.organisationId}</td>
              <td className="py-2 pr-4 font-mono text-xs">{truncateWallet(record.wallet)}</td>
              <td className="py-2 pr-4 text-slate-500">{record.validFrom}</td>
              <td className="py-2 pr-4 text-slate-500">{record.validUntil ?? "—"}</td>
              <td className="py-2">
                <Badge tone={record.status === "ACTIVE" ? "green" : "red"}>{record.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
