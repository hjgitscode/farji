import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/credential/StatusBadge";
import { LifecycleBadge } from "@/components/credential/LifecycleBadge";
import { getOrganisationById } from "@/lib/services/organisationService";
import type { Credential } from "@/lib/mock-data/types";

interface ClaimCardProps {
  credential: Credential;
  /** Action buttons / expandable panels rendered under the claim details. */
  actions?: ReactNode;
}

export function ClaimCard({ credential, actions }: ClaimCardProps) {
  const organisation = getOrganisationById(credential.organisationId);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">{credential.claimType}</p>
          <h3 className="text-lg font-semibold text-slate-900">{credential.title}</h3>
          <p className="text-sm text-slate-500">{organisation?.name ?? credential.organisationId}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <LifecycleBadge type={credential.lifecycleType} />
          <StatusBadge state={credential.state} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
        <dt className="text-slate-400">Started</dt>
        <dd>{credential.startDate}</dd>
        {credential.endDate && (
          <>
            <dt className="text-slate-400">{credential.state === "ENDED" ? "Ended" : "Until"}</dt>
            <dd>{credential.endDate}</dd>
          </>
        )}
        <dt className="text-slate-400">Version</dt>
        <dd>v{credential.version}</dd>
      </dl>
      {actions && <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{actions}</div>}
    </Card>
  );
}
