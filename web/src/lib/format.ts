export function formatMoney(minor: number | null | undefined, currency = "NGN"): string {
  if (minor === null || minor === undefined) return "—";
  const symbol =
    currency === "NGN" ? "₦" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDistance(meters: number | null): string {
  if (meters === null || meters === undefined) return "—";
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function formatWeight(kg: number): string {
  return `${kg.toLocaleString("en-US")} kg`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);
  if (Number.isNaN(diffSeconds)) return "—";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h ago`;
  return `${Math.round(diffSeconds / 86400)}d ago`;
}
