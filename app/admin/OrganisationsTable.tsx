import { Card } from "@/components/ui/Card";
import type { Organisation } from "@/lib/mock-data/types";

export function OrganisationsTable({ organisations }: { organisations: Organisation[] }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-400">
            <th className="py-2 pr-4 font-medium">Organisation ID</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 font-medium">Registered</th>
          </tr>
        </thead>
        <tbody>
          {organisations.map((org) => (
            <tr key={org.organisationId} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4 font-mono text-xs">{org.organisationId}</td>
              <td className="py-2 pr-4">{org.name}</td>
              <td className="py-2 text-slate-500">{org.registeredAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
