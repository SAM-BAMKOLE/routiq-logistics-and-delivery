"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MapPin, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { PublicTracking } from "@/lib/types";

export default function TrackingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TrackingInner />
    </Suspense>
  );
}

function TrackingInner() {
  const searchParams = useSearchParams();
  const { api } = useSession();
  const [number, setNumber] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<PublicTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const autoRan = useRef(false);

  const lookup = useCallback(
    async (targetNumber: string, targetToken: string) => {
      const trimmed = targetNumber.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<PublicTracking>(
          `/public/tracking/${encodeURIComponent(trimmed)}`,
          targetToken ? { token: targetToken } : undefined,
        );
        setResult(data);
      } catch (cause) {
        setResult(null);
        setError(
          cause instanceof ApiError
            ? cause.status === 404
              ? "No shipment matches that tracking number and token."
              : cause.message
            : "Lookup failed",
        );
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (autoRan.current) return;
    const initialNumber = searchParams.get("number") ?? "";
    const initialToken = searchParams.get("token") ?? "";
    if (initialNumber) {
      autoRan.current = true;
      setNumber(initialNumber);
      setToken(initialToken);
      void lookup(initialNumber, initialToken);
    }
  }, [searchParams, lookup]);

  return (
    <>
      <PageHeader
        title="Public tracking"
        description="The anonymous, rate-limited endpoint a consignee would use. Requires both the tracking number and the public token."
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Look up a shipment</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup(number, token);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="tracking-number">Tracking number</Label>
              <Input
                id="tracking-number"
                placeholder="SHP-XXXXXXXXXXXX"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="public-token">Public token</Label>
              <Input
                id="public-token"
                placeholder="token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Track
            </Button>
          </form>

          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Not found</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <div className="mt-6 grid max-w-3xl gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{result.trackingNumber}</CardTitle>
              <StatusBadge status={result.status} />
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Timeline
              </p>
              {result.timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No public events yet.
                </p>
              ) : (
                <ol className="relative space-y-4 border-l pl-4">
                  {result.timeline.map((entry, index) => (
                    <li key={`${entry.status}-${index}`} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary" />
                      <p className="text-sm font-medium">
                        {entry.status.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.occurredAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ETA & position</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Estimated arrival
                </p>
                <p className="text-sm font-medium">
                  {result.eta ? formatDateTime(result.eta) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Live position
                </p>
                {result.position ? (
                  <p className="flex items-center gap-1 text-sm">
                    <MapPin className="size-3.5" />
                    {result.position.latitude.toFixed(4)},{" "}
                    {result.position.longitude.toFixed(4)}
                    <span className="text-xs text-muted-foreground">
                      · {formatDateTime(result.position.recordedAt)}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not available (shown only while out for delivery).
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
