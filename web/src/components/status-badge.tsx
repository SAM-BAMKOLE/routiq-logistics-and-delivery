import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  CREATED: "border-transparent bg-slate-100 text-slate-700",
  CONFIRMED: "border-transparent bg-blue-100 text-blue-700",
  ASSIGNED: "border-transparent bg-indigo-100 text-indigo-700",
  PICKED_UP: "border-transparent bg-violet-100 text-violet-700",
  IN_TRANSIT: "border-transparent bg-amber-100 text-amber-800",
  OUT_FOR_DELIVERY: "border-transparent bg-orange-100 text-orange-800",
  DELIVERED: "border-transparent bg-emerald-100 text-emerald-700",
  FAILED_ATTEMPT: "border-transparent bg-rose-100 text-rose-700",
  RETURNED: "border-transparent bg-stone-200 text-stone-700",
  CANCELLED: "border-transparent bg-gray-200 text-gray-600",
  active: "border-transparent bg-emerald-100 text-emerald-700",
  available: "border-transparent bg-emerald-100 text-emerald-700",
  unavailable: "border-transparent bg-amber-100 text-amber-800",
  suspended: "border-transparent bg-rose-100 text-rose-700",
  offered: "border-transparent bg-blue-100 text-blue-700",
  accepted: "border-transparent bg-emerald-100 text-emerald-700",
  rejected: "border-transparent bg-rose-100 text-rose-700",
  expired: "border-transparent bg-gray-200 text-gray-600",
  planned: "border-transparent bg-blue-100 text-blue-700",
  completed: "border-transparent bg-emerald-100 text-emerald-700",
  planning: "border-transparent bg-amber-100 text-amber-800",
  failed: "border-transparent bg-rose-100 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "border-transparent bg-muted text-foreground";
  return (
    <Badge className={cn("font-medium uppercase tracking-wide", style)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
