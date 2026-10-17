"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { errorMessage } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { roleHasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { Address, Customer, Shipment } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

export default function NewShipmentPage() {
  const router = useRouter();
  const { session, api } = useSession();
  const canCreate = roleHasPermission(session?.tenant?.role, "shipments:create");
  const canManageCustomers = roleHasPermission(
    session?.tenant?.role,
    "customers:manage",
  );

  const {
    data: customers,
    loading,
    error,
    reload,
  } = useApiQuery<Customer[]>(
    async (client) => (await client.get<{ data: Customer[] }>("/customers")).data,
    [],
  );

  const [customerId, setCustomerId] = useState("");
  const [pickupAddressId, setPickupAddressId] = useState("");
  const [dropoffAddressId, setDropoffAddressId] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [volumeM3, setVolumeM3] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Shipment | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewAddress, setShowNewAddress] = useState(false);

  // Default to the first customer once the list arrives.
  useEffect(() => {
    if (!customerId && customers && customers.length > 0) {
      setCustomerId(customers[0].id);
    }
  }, [customers, customerId]);

  // Load the selected customer's saved addresses.
  useEffect(() => {
    if (!customerId) {
      setAddresses([]);
      return;
    }
    let active = true;
    setAddressesLoading(true);
    setPickupAddressId("");
    setDropoffAddressId("");
    api
      .get<{ data: Address[] }>(`/customers/${customerId}/addresses`)
      .then((result) => {
        if (active) setAddresses(result.data);
      })
      .catch(() => {
        if (active) setAddresses([]);
      })
      .finally(() => {
        if (active) setAddressesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, api]);

  const selectedCustomer = useMemo(
    () => customers?.find((customer) => customer.id === customerId) ?? null,
    [customers, customerId],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const weight = Number(weightKg);
    if (!customerId || !pickupAddressId || !dropoffAddressId) {
      setFormError("Choose a customer and both pickup and drop-off addresses.");
      return;
    }
    if (pickupAddressId === dropoffAddressId) {
      setFormError("Pickup and drop-off must be different addresses.");
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setFormError("Enter a positive weight in kilograms.");
      return;
    }

    const body: Record<string, unknown> = {
      customerId,
      pickupAddressId,
      dropoffAddressId,
      weightKg: weight,
    };
    if (volumeM3.trim()) body.volumeM3 = Number(volumeM3);
    if (windowStart) body.windowStart = new Date(windowStart).toISOString();
    if (windowEnd) body.windowEnd = new Date(windowEnd).toISOString();

    setSubmitting(true);
    try {
      const shipment = await api.post<Shipment>("/shipments", body);
      setCreated(shipment);
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="New shipment" />
        <ErrorState message="You do not have permission to create shipments." />
      </>
    );
  }

  if (created) {
    return (
      <BookedShipment
        shipment={created}
        onDone={() => router.push(`/shipments/${created.id}`)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="New shipment"
        description="Book a delivery for a customer. The price is quoted when you book."
        action={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {formError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Could not book the shipment</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Customer</CardTitle>
            {canManageCustomers ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewCustomer((value) => !value)}
              >
                <Plus className="size-4" />
                New customer
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {showNewCustomer ? (
              <NewCustomerForm
                onCreated={(customer) => {
                  setShowNewCustomer(false);
                  reload();
                  setCustomerId(customer.id);
                }}
                onCancel={() => setShowNewCustomer(false)}
              />
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading customers…
              </div>
            ) : (customers?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                No customers yet.
                {canManageCustomers
                  ? " Create one to book its first shipment."
                  : " Ask an administrator to add one."}
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="customer">Customer</Label>
                <Select
                  id="customer"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  {customers?.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Route</CardTitle>
            {canManageCustomers && customerId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewAddress((value) => !value)}
              >
                <Plus className="size-4" />
                New address
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {showNewAddress && customerId ? (
              <NewAddressForm
                customerId={customerId}
                onCreated={(address) => {
                  setShowNewAddress(false);
                  setAddresses((current) => [...current, address]);
                  setPickupAddressId((current) => current || address.id);
                }}
                onCancel={() => setShowNewAddress(false)}
              />
            ) : null}

            {addressesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading addresses…
              </div>
            ) : addresses.length < 2 ? (
              <p className="text-sm text-muted-foreground">
                {selectedCustomer?.name ?? "This customer"} needs at least two
                saved addresses (a pickup and a drop-off).
                {canManageCustomers ? " Add one above." : ""}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pickup">Pickup</Label>
                  <Select
                    id="pickup"
                    value={pickupAddressId}
                    onChange={(event) => setPickupAddressId(event.target.value)}
                    required
                  >
                    <option value="">Select an address…</option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {formatAddress(address)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dropoff">Drop-off</Label>
                  <Select
                    id="dropoff"
                    value={dropoffAddressId}
                    onChange={(event) => setDropoffAddressId(event.target.value)}
                    required
                  >
                    <option value="">Select an address…</option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {formatAddress(address)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parcel</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                min="0.1"
                step="0.1"
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
                placeholder="12"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="volume">Volume (m³, optional)</Label>
              <Input
                id="volume"
                type="number"
                min="0"
                step="0.01"
                value={volumeM3}
                onChange={(event) => setVolumeM3(event.target.value)}
                placeholder="0.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window-start">Window start (optional)</Label>
              <Input
                id="window-start"
                type="datetime-local"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window-end">Window end (optional)</Label>
              <Input
                id="window-end"
                type="datetime-local"
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={submitting || addresses.length < 2}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Book shipment
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/shipments")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}

/** Post-booking panel: shows the quoted price and offers confirmation. */
function BookedShipment({
  shipment,
  onDone,
}: {
  shipment: Shipment;
  onDone: () => void;
}) {
  const { api } = useSession();
  const [current, setCurrent] = useState(shipment);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const updated = await api.post<Shipment>(
        `/shipments/${current.id}/confirm`,
        undefined,
        { ifMatch: current.version },
      );
      setCurrent(updated);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <PageHeader title="Shipment booked" />
      <Card className="max-w-xl">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-600" />
            <div>
              <p className="font-medium">{current.trackingNumber}</p>
              <p className="text-sm text-muted-foreground">
                {formatMoney(current.priceMinor, current.currency)} quoted
              </p>
            </div>
            <div className="ml-auto">
              <StatusBadge status={current.status} />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not confirm</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {current.status === "CREATED" ? (
            <p className="text-sm text-muted-foreground">
              Confirm the booking to make it available for dispatch.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This shipment is {current.status.toLowerCase()} and ready for
              dispatch.
            </p>
          )}

          <div className="flex items-center gap-3">
            {current.status === "CREATED" ? (
              <Button onClick={confirm} disabled={confirming}>
                {confirming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Confirm shipment
              </Button>
            ) : null}
            <Button variant="outline" onClick={onDone}>
              View shipment
            </Button>
            <Link
              href="/shipments/new"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Book another
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function NewCustomerForm({
  onCreated,
  onCancel,
}: {
  onCreated: (customer: Customer) => void;
  onCancel: () => void;
}) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const customer = await api.post<Customer>("/customers", {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onCreated(customer);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border bg-muted/30 p-4"
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="new-customer-name">Name</Label>
          <Input
            id="new-customer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-customer-email">Email (optional)</Label>
          <Input
            id="new-customer-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-customer-phone">Phone (optional)</Label>
          <Input
            id="new-customer-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Create customer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NewAddressForm({
  customerId,
  onCreated,
  onCancel,
}: {
  customerId: string;
  onCreated: (address: Address) => void;
  onCancel: () => void;
}) {
  const { api } = useSession();
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [postalCode, setPostalCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const address = await api.post<Address>(
        `/customers/${customerId}/addresses`,
        {
          line1: line1.trim(),
          city: city.trim(),
          country: country.trim(),
          region: region.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
        },
      );
      onCreated(address);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border bg-muted/30 p-4"
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="new-address-line1">Street address</Label>
          <Input
            id="new-address-line1"
            value={line1}
            onChange={(event) => setLine1(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-address-city">City</Label>
          <Input
            id="new-address-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-address-region">State / region (optional)</Label>
          <Input
            id="new-address-region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-address-country">Country</Label>
          <Input
            id="new-address-country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-address-postal">Postal code (optional)</Label>
          <Input
            id="new-address-postal"
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Save address
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function formatAddress(address: Address): string {
  return [address.line1, address.city, address.region]
    .filter(Boolean)
    .join(", ");
}
