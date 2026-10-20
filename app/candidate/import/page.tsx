import type { Metadata } from "next";
import { previewImportAction } from "@/app/candidate/actions";
import { ImportWorkbench } from "@/components/candidate/ImportWorkbench";
import { PageHeader } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Import professional profile" };

export default async function ImportPage() {
  await requireCandidate("/candidate/import");
  return (
    <div>
      <PageHeader title="Build your FARJI profile" description="Import from LinkedIn or another professional profile: paste or upload what you exported, review it, and add only what is correct." />
      <ImportWorkbench preview={previewImportAction} />
    </div>
  );
}
