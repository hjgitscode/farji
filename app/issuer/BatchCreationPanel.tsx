"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MerkleTreeVisual } from "@/components/merkle/MerkleTreeVisual";
import { placeholderHex } from "@/lib/mock-data/mockHex";

interface Item {
  id: string;
  label: string;
}

interface BatchCreationPanelProps {
  title: string;
  actionLabel: string;
  items: Item[];
}

// Lets the issuer select mock credentials and simulate creating a Merkle
// batch (CohortProof or ProofPulse). The resulting root is a placeholder —
// the real Merkle engine arrives in Phase 8, and anchoring it on-chain
// arrives in Phase 6/9/10.
export function BatchCreationPanel({ title, actionLabel, items }: BatchCreationPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ batchRoot: string; anchoredAt: string } | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    if (selected.size === 0) return;
    setCreated({
      batchRoot: placeholderHex([...selected].sort().join("-")),
      anchoredAt: new Date().toISOString().slice(0, 10),
    });
  }

  const selectedItems = items.filter((item) => selected.has(item.id));

  return (
    <Card>
      <p className="font-semibold text-slate-900">{title}</p>
      <div className="mt-3 space-y-1">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            {item.label}
          </label>
        ))}
      </div>
      <Button className="mt-3" onClick={handleCreate} disabled={selected.size === 0}>
        {actionLabel}
      </Button>

      {created && (
        <div className="mt-4">
          <MerkleTreeVisual
            title={`${title} — new batch`}
            leaves={selectedItems}
            batchRoot={created.batchRoot}
            anchoredAt={created.anchoredAt}
          />
        </div>
      )}
    </Card>
  );
}
