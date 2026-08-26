import { Badge } from "@/components/ui/Badge";
import type { LifecycleType } from "@/lib/mock-data/types";

const toneByType: Record<LifecycleType, "indigo" | "teal" | "purple"> = {
  PERMANENT: "indigo",
  CONTINUING: "teal",
  EXPIRING: "purple",
};

export function LifecycleBadge({ type }: { type: LifecycleType }) {
  return <Badge tone={toneByType[type]}>{type}</Badge>;
}
