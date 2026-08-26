import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Leaf {
  id: string;
  label: string;
}

interface MerkleTreeVisualProps {
  title: string;
  leaves: Leaf[];
  batchRoot: string;
  anchoredAt: string;
  highlightLeafId?: string;
}

function Arrow() {
  return <div className="my-2 text-center text-slate-300">↓</div>;
}

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

// A vertical walkthrough of one Merkle batch: leaves -> tree -> root ->
// blockchain anchor. Intermediate pairwise hash boxes are deliberately
// not drawn with real values here — the real Merkle engine (Phase 8)
// computes actual pair hashes; this component only illustrates the flow.
export function MerkleTreeVisual({ title, leaves, batchRoot, anchoredAt, highlightLeafId }: MerkleTreeVisualProps) {
  return (
    <Card>
      <p className="mb-3 text-sm font-semibold text-slate-500">{title}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {leaves.map((leaf) => (
          <div
            key={leaf.id}
            className={`rounded-md border px-3 py-2 text-center text-xs font-medium ${
              leaf.id === highlightLeafId
                ? "border-brand bg-blue-50 text-brand"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            {leaf.label}
          </div>
        ))}
      </div>

      <Arrow />
      <div className="rounded-md border border-dashed border-slate-300 bg-white py-2 text-center text-xs font-medium text-slate-500">
        Merkle Tree (pairwise Keccak-256 hashing — Phase 8)
      </div>

      <Arrow />
      <div className="rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-center font-mono text-xs text-slate-100">
        {truncateHex(batchRoot)}
      </div>

      <Arrow />
      <div className="flex items-center justify-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-center text-xs font-medium text-green-700">
        <Badge tone="green">Blockchain Anchor</Badge>
        <span>Anchored {anchoredAt}</span>
      </div>
    </Card>
  );
}
