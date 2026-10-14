"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { ErrorState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Shipment, ShipmentTrack } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

interface Detail {
  shipment: Shipment;
  track: ShipmentTrack | null;
  customerName: string | null;
}

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { api } = useSession();
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiQuery<Detail>(
    async (client) => {
      const shipment = await client.get<Shipment>(`/shipments/${id}`);
      const track = await client
        .get<ShipmentTrack>(`/shipments/${id}/track`)
        .catch(() => null);
      const customer = await client
        .get<{ name: string }>(`/customers/${shipment.customerId}`)
        .catch(() => null);
      return { shipment, track, customerName: customer?.name ?? null };
    },
    [id],
  );

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <>
        <BackLink />
        <ErrorState message={error ?? "Shipment not found."} />
      </>
    );
  }

  const { shipment, track, customerName } = data;
  const terminal = ["DELIVERED", "CANCELLED", "RETURNED"].includes(
    shipment.status,
  );

  async function act(action: "confirm" | "cancel"): Promise<void> {
    setPending(action);
    setActionError(null);
    try {
      await api.post(`/shipments/${shipment.id}/${action}`, undefined, {
        ifMatch: shipment.version,
      });
      reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? `${cause.message}${cause.code ? ` (${cause.code})` : ""}`
          : cause instanceof Error
            ? cause.message
            : "Action failed",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <BackLink />

      <PageHeader
        title={shipment.trackingNumber}
        description={customerName ? `Customer · ${customerName}` : undefined}
        action={<StatusBadge status={shipment.status} />}
      />

      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Details</CardTitle>
            <div className="flex gap-2">
              {shipment.status === "CREATED" ? (
                <Button
                  size="sm"
                  onClick={() => void act("confirm")}
                  disabled={pending !== null}
                >
                  {pending === "confirm" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Confirm
                </Button>
              ) : null}
              {!terminal ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act("cancel")}
                  disabled={pending !== null}
                >
                  {pending === "cancel" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  Cancel
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Weight" value={`${shipment.weightKg} kg`} />
            <Field
              label="Quoted price"
              value={`${((shipment.priceMinor ?? 0) / 100).toLocaleString()} ${shipment.currency}`}
            />
            <Field label="Version" value={String(shipment.version)} />
            <Field
              label="Failed attempts"
              value={String(shipment.failedAttempts)}
            />
            <Field label="Driver" value={shipment.driverId ?? "Unassigned"} />
            <Field label="Vehicle" value={shipment.vehicleId ?? "Unassigned"} />
            <Field
              label="Created"
              value={new Date(shipment.createdAt).toLocaleString()}
            />
            <Field
              label="Updated"
              value={new Date(shipment.updatedAt).toLocaleString()}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share a read-only tracking page with the consignee.
            </p>
            <Link
              href={`/tracking?number=${encodeURIComponent(shipment.trackingNumber)}&token=${encodeURIComponent(shipment.publicToken)}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Open public tracking <ExternalLink className="size-3.5" />
            </Link>
            <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">
              {shipment.publicToken}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {track && track.timeline.length > 0 ? (
              <ol className="relative space-y-4 border-l pl-4">
                {track.timeline.map((entry, index) => (
                  <li key={`${entry.toStatus}-${index}`} className="relative">
                    <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary" />
                    <p className="text-sm font-medium">
                      {entry.toStatus.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.occurredAt).toLocaleString()}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                No status changes recorded yet.
              </p>
            )}
          </CardContent>
        </Card>

        {track && track.proofs.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Proof of delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {track.proofs.map((proof, index) => (
                <div key={index} className="rounded-md border p-3">
                  <p className="font-medium capitalize">{proof.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {proof.recipientName
                      ? `Received by ${proof.recipientName}`
                      : "Captured"}{" "}
                    · {new Date(proof.capturedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/shipments"
      className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to shipments
    </Link>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}
