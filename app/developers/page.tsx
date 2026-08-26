import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

const developers = ["Hemang Josan", "Keshav Gupta"];

export default function DevelopersPage() {
  return (
    <div>
      <PageHeader title="Meet the Developers" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {developers.map((name) => (
          <Card key={name} className="text-center">
            <p className="text-xl font-semibold text-slate-900">{name}</p>
          </Card>
        ))}
      </div>
      <p className="mt-8 text-sm text-slate-500">Developed as an Innovative Design Project.</p>
    </div>
  );
}
