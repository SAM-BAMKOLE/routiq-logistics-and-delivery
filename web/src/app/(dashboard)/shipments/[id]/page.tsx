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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { roleHasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { Driver, Shipment, ShipmentTrack } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";
import { formatMoney, formatDistance } from "@/lib/format";

interface Detail {
  shipment: Shipment;
  track: ShipmentTrack | null;
  customerName: string | null;
  drivers: Driver[];
}

/** Every status-changing action the detail page can fire. */
type StatusAction =
  | "pickup"
  | "start-transit"
  | "start-delivery"
  | "deliver"
  | "fail"
  | "retry"
  | "return";

/** What the shipment can do next, straight from the domain state machine. */
const NEXT_LABELS: Record<Shipment["status"], string | null> = {
  CREATED: "Confirm to release it to dispatch.",
  CONFIRMED: "Assign a driver to put it on the road.",
  ASSIGNED: "The driver picks it up.",
  PICKED_UP: "Start transit once the cargo is moving.",
  IN_TRANSIT: "Hand over to the delivery run.",
  OUT_FOR_DELIVERY: "Mark it delivered, or record a failed attempt.",
  FAILED_ATTEMPT: "Retry while attempts remain, or return it to the sender.",
  DELIVERED: "Complete — nothing left to do.",
  RETURNED: "Returned to the sender — terminal.",
  CANCELLED: "Cancelled — terminal.",
};

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const { session, api } = useSession();
  const id = params.id;
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [statusAction, setStatusAction] = useState<string | null>(null);
  const [showFailForm, setShowFailForm] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiQuery<Detail>(
    async (client): Promise<Detail> => {
      const shipment = await client.get<Shipment>(`/shipments/${id}`);
      const track = await client
        .get<ShipmentTrack>(`/shipments/${id}/track`)
        .catch(() => null);
      const customer = await client
        .get<{ name: string }>(`/customers/${shipment.customerId}`)
        .catch(() => null);
      // Only dispatchers can list drivers; drivers and customers simply get
      // an empty picker (the 403 is swallowed here).
      const drivers = await client
        .get<{ data: Driver[] }>("/drivers")
        .catch(() => ({ data: [] as Driver[] }));
      return { shipment, track, customerName: customer?.name ?? null, drivers: drivers.data };
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

  const { shipment, track, customerName, drivers } = data;
  const terminal = ["DELIVERED", "CANCELLED", "RETURNED"].includes(
    shipment.status,
  );
  const role = session?.tenant?.role;
  // `assign` and `return` are gated on `shipments:update` server-side, so
  // drivers (who only hold `shipments:update-status`) never see those two.
  const canUpdate = roleHasPermission(role, "shipments:update");
  const canUpdateStatus = roleHasPermission(role, "shipments:update-status");
  const canRunActions = canUpdate || canUpdateStatus;
  const status = shipment.status;
  // The state machine only allows cancellation before pickup.
  const cancellable = ["CREATED", "CONFIRMED", "ASSIGNED"].includes(status);

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

  async function doAssign(driverId: string): Promise<void> {
    if (!driverId) return;
    setAssigning(true);
    setActionError(null);
    try {
      await api.post(
        `/shipments/${shipment.id}/assign`,
        { driverId },
        { ifMatch: shipment.version },
      );
      setSelectedDriverId("");
      reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? `${cause.message}${cause.code ? ` (${cause.code})` : ""}`
          : cause instanceof Error
            ? cause.message
            : "Assignment failed",
      );
    } finally {
      setAssigning(false);
    }
  }

  async function doStatusAction(
    action: StatusAction,
    reason?: string,
  ): Promise<void> {
    setStatusAction(action);
    setActionError(null);
    try {
      // Only `fail` and `return` carry a body; the rest are bare POSTs.
      const body =
        action === "fail"
          ? { reason }
          : action === "return"
            ? { reason: reason ?? null }
            : undefined;
      await api.post(`/shipments/${shipment.id}/${action}`, body, {
        ifMatch: shipment.version,
      });
      if (action === "fail") {
        setShowFailForm(false);
        setFailReason("");
      }
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
      setStatusAction(null);
    }
  }

  /** A status button that shows a spinner while its own action is in flight. */
  function runButton(
    action: StatusAction,
    label: string,
    variant: "default" | "outline" = "default",
  ) {
    return (
      <Button
        size="sm"
        variant={variant}
        onClick={() => void doStatusAction(action)}
        disabled={statusAction !== null}
      >
        {statusAction === action ? (
          <Loader2 className="size-4 animate-spin" />
        ) : null}
        {label}
      </Button>
    );
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
            <div className="flex flex-wrap gap-2">
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
              {cancellable ? (
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
            <Field label="Driver" value={driverLabel(shipment, drivers)} />
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

        {canUpdate && status === "CONFIRMED" ? (
          <Card>
            <CardHeader>
              <CardTitle>Assign to driver</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label="Select driver"
                value={selectedDriverId}
                onChange={(event) => setSelectedDriverId(event.target.value)}
                className="sm:max-w-sm"
              >
                <option value="">Select an available driver</option>
                {drivers
                  .filter((driver) => driver.availability === "available")
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.licenseNo}
                    </option>
                  ))}
              </Select>
              <Button
                size="sm"
                onClick={() => void doAssign(selectedDriverId)}
                disabled={assigning || !selectedDriverId}
              >
                {assigning ? <Loader2 className="size-4 animate-spin" /> : null}
                Assign
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {canRunActions && !terminal ? (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Status actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {shipment.status === "ASSIGNED" ? (
                <Button
                  size="sm"
                  onClick={() => void doStatusAction("pickup")}
                  disabled={statusAction !== null}
                >
                  {statusAction === "pickup" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Pick up
                </Button>
              ) : null}
              {shipment.status === "PICKED_UP" ? (
                <Button
                  size="sm"
                  onClick={() => void doStatusAction("start-transit")}
                  disabled={statusAction !== null}
                >
                  {statusAction === "start-transit" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Start transit
                </Button>
              ) : null}
              {shipment.status === "IN_TRANSIT" ? (
                <Button
                  size="sm"
                  onClick={() => void doStatusAction("start-delivery")}
                  disabled={statusAction !== null}
                >
                  {statusAction === "start-delivery" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Start delivery
                </Button>
              ) : null}
              {shipment.status === "OUT_FOR_DELIVERY" ? (
                <Button
                  size="sm"
                  onClick={() => void doStatusAction("deliver")}
                  disabled={statusAction !== null}
                >
                  {statusAction === "deliver" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Mark delivered
                </Button>
              ) : null}
              {shipment.status === "OUT_FOR_DELIVERY" && !showFailForm ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowFailForm(true)}
                  disabled={statusAction !== null}
                >
                  Mark failed
                </Button>
              ) : null}

              {shipment.status === "OUT_FOR_DELIVERY" && showFailForm ? (
                <>
                  <Input
                    aria-label="Failure reason"
                    placeholder="Why did the attempt fail?"
                    value={failReason}
                    onChange={(event) => setFailReason(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && failReason.trim()) {
                        event.preventDefault();
                        void doStatusAction("fail", failReason.trim());
                      }
                    }}
                    className="h-9 w-56"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void doStatusAction("fail", failReason.trim())}
                    disabled={statusAction !== null || !failReason.trim()}
                  >
                    {statusAction === "fail" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Record failure
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowFailForm(false);
                      setFailReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : null}

              {shipment.status === "FAILED_ATTEMPT" ? (
                <>
                  {runButton("retry", "Retry delivery", "outline")}
                  {canUpdate
                    ? runButton("return", "Return to sender", "outline")
                    : null}
                </>
              ) : null}

              <p className="w-full text-xs text-muted-foreground">
                {NEXT_LABELS[status]}
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Price breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {shipment.priceBreakdown ? (
              <dl className="space-y-2 text-sm">
                <BreakdownRow
                  label={
                    shipment.priceBreakdown.ruleName
                      ? `Rate card · ${shipment.priceBreakdown.ruleName}`
                      : "Base fee"
                  }
                  value={formatMoney(
                    shipment.priceBreakdown.baseFeeMinor,
                    shipment.currency,
                  )}
                />
                <BreakdownRow
                  label={
                    shipment.priceBreakdown.distanceMeters !== null
                      ? `Distance · ${formatDistance(shipment.priceBreakdown.distanceMeters)}`
                      : "Distance · not known"
                  }
                  value={formatMoney(
                    shipment.priceBreakdown.distanceFeeMinor,
                    shipment.currency,
                  )}
                />
                <BreakdownRow
                  label={`Weight · ${shipment.priceBreakdown.weightKg} kg`}
                  value={formatMoney(
                    shipment.priceBreakdown.weightFeeMinor,
                    shipment.currency,
                  )}
                />
                <BreakdownRow
                  label="Subtotal"
                  value={formatMoney(
                    shipment.priceBreakdown.subtotalMinor,
                    shipment.currency,
                  )}
                />
                {shipment.priceBreakdown.surcharges.map((surcharge) => (
                  <BreakdownRow
                    key={surcharge.code}
                    label={`${surcharge.label} · ${
                      surcharge.kind === "percent"
                        ? `${surcharge.value / 100}%`
                        : "flat"
                    }`}
                    value={formatMoney(
                      surcharge.amountMinor,
                      shipment.currency,
                    )}
                    muted
                  />
                ))}
                <div className="border-t pt-2">
                  <BreakdownRow
                    label="Total"
                    value={formatMoney(
                      shipment.priceBreakdown.priceMinor,
                      shipment.currency,
                    )}
                  />
                </div>
                {shipment.priceBreakdown.subtotalMinor <
                shipment.priceBreakdown.minFeeMinor ? (
                  <p className="text-xs text-muted-foreground">
                    Raised to the minimum fee of{" "}
                    {formatMoney(
                      shipment.priceBreakdown.minFeeMinor,
                      shipment.currency,
                    )}
                    .
                  </p>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No breakdown stored for this shipment (created before price
                tracking was added). Quoted price:{" "}
                {formatMoney(shipment.priceMinor, shipment.currency)}.
              </p>
            )}
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

/** Prefer a driver's licence number over a bare UUID; fall back to a prefix. */
function driverLabel(
  shipment: Pick<Shipment, "driverId">,
  drivers: readonly Driver[],
): string {
  if (!shipment.driverId) return "Unassigned";
  const driver = drivers.find((candidate) => candidate.id === shipment.driverId);
  return driver?.licenseNo ?? `${shipment.driverId.slice(0, 8)}…`;
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

function BreakdownRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        muted ? "text-muted-foreground" : ""
      }`}
    >
      <dt className="truncate">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
