"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { roleHasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import type { PricingRule, PricingSurcharge, SurchargeKind } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

export default function PricingPage() {
  const { session, api } = useSession();
  const canManage = roleHasPermission(session?.tenant?.role, "pricing:manage");

  const { data, loading, error, reload } = useApiQuery<PricingRule[]>(
    async (api) => (await api.get<{ data: PricingRule[] }>("/pricing-rules")).data,
  );

  const rules = data ?? [];

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function closeForms() {
    setCreating(false);
    setEditingId(null);
  }

  function onSaved() {
    closeForms();
    setActionError(null);
    void reload();
  }

  async function remove(rule: PricingRule) {
    setBusyId(rule.id);
    setActionError(null);
    try {
      await api.delete(`/pricing-rules/${rule.id}`);
      setDeletingId(null);
      await reload();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Tenant rate cards. The quote engine evaluates rules by priority and only applies ones whose start date has passed."
        action={
          <div className="flex items-center gap-2">
            {canManage ? (
              <Button
                onClick={() => {
                  setCreating((open) => !open);
                  setEditingId(null);
                  setDeletingId(null);
                }}
              >
                <Plus className="size-4" />
                {creating ? "Close" : "New rate card"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <Card className="mb-4 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">How a quote is priced</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Total</span> = base fee
            + (distance × per-km) + (weight × per-kg) + opted-in surcharges,
            floored at the minimum fee. Distance is the straight-line Haversine
            distance when both addresses have coordinates.
          </p>
          <p className="mt-2">
            Surcharges are optional extras (express delivery, difficult terrain,
            fragile handling) a dispatcher ticks when booking. A percentage
            surcharge is charged on the subtotal above; a flat one is added
            as-is. Nothing is applied unless it is selected.
          </p>
        </CardContent>
      </Card>

      {actionError ? (
        <p className="mb-3 text-sm text-destructive">{actionError}</p>
      ) : null}

      {creating ? (
        <RateCardForm onSaved={onSaved} onCancel={closeForms} />
      ) : null}

      {error ? <ErrorState message={error} /> : null}

      {loading && rules.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!error && !loading && rules.length === 0 ? (
        <EmptyState message="No rate cards configured for this tenant." />
      ) : null}

      {rules.length > 0 ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Per km</TableHead>
                  <TableHead className="text-right">Per kg</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead>Active from</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <PricingRow
                    key={rule.id}
                    rule={rule}
                    isLastRule={rules.length === 1}
                    canManage={canManage}
                    editing={editingId === rule.id}
                    deleting={deletingId === rule.id}
                    busy={busyId === rule.id}
                    onEdit={() => {
                      setEditingId(rule.id);
                      setCreating(false);
                      setDeletingId(null);
                      setActionError(null);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => {
                      setDeletingId(rule.id);
                      setEditingId(null);
                      setActionError(null);
                    }}
                    onCancelDelete={() => setDeletingId(null)}
                    onConfirmDelete={() => void remove(rule)}
                    onSaved={onSaved}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function PricingRow({
  rule,
  isLastRule,
  canManage,
  editing,
  deleting,
  busy,
  onEdit,
  onCancelEdit,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
  onSaved,
}: {
  rule: PricingRule;
  isLastRule: boolean;
  canManage: boolean;
  editing: boolean;
  deleting: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onSaved: () => void;
}) {
  return (
    <>
      <TableRow className={editing ? "border-b-0" : undefined}>
        <TableCell className="font-medium">
          <div>{rule.name}</div>
          <div className="mt-0.5 text-xs font-normal text-muted-foreground">
            {surchargeSummary(rule.surcharges)}
          </div>
        </TableCell>
        <TableCell className="text-right">
          {formatMoney(rule.baseFeeMinor)}
        </TableCell>
        <TableCell className="text-right">
          {formatMoney(rule.perKmMinor)}
        </TableCell>
        <TableCell className="text-right">
          {formatMoney(rule.perKgMinor)}
        </TableCell>
        <TableCell className="text-right">
          {formatMoney(rule.minFeeMinor)}
        </TableCell>
        <TableCell className="text-right">{rule.priority}</TableCell>
        <TableCell className="text-muted-foreground">
          {formatDate(rule.activeFrom)}
        </TableCell>
        {canManage ? (
          <TableCell className="text-right">
            {deleting ? (
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">
                  {isLastRule
                    ? "Your only rate card — new shipments would stop being quoted. Delete?"
                    : "Delete this rate card?"}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={onConfirmDelete}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelDelete}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onEdit}
                  aria-label={`Edit ${rule.name}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDelete}
                  aria-label={`Delete ${rule.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </TableCell>
        ) : null}
      </TableRow>
      {editing ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="px-4 py-4">
            <RateCardForm initial={rule} onSaved={onSaved} onCancel={onCancelEdit} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * Create or edit one rate card. The API works in integer minor units (kobo),
 * so the form speaks major units and converts on submit — nobody enters a
 * base fee as "5000000".
 */
function RateCardForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: PricingRule;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { api } = useSession();
  const [name, setName] = useState(initial?.name ?? "");
  const [baseFee, setBaseFee] = useState(toMajor(initial?.baseFeeMinor ?? 0));
  const [perKm, setPerKm] = useState(toMajor(initial?.perKmMinor ?? 0));
  const [perKg, setPerKg] = useState(toMajor(initial?.perKgMinor ?? 0));
  const [minFee, setMinFee] = useState(toMajor(initial?.minFeeMinor ?? 0));
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [activeFrom, setActiveFrom] = useState(initial
    ? initial.activeFrom.slice(0, 10)
    : "");
  const [surcharges, setSurcharges] = useState<SurchargeDraft[]>(
    () => initial?.surcharges.map(surchargeToDraft) ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateSurcharge(index: number, patch: Partial<SurchargeDraft>) {
    setSurcharges((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeSurcharge(index: number) {
    setSurcharges((rows) => rows.filter((_, i) => i !== index));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Validate the surcharge rows before sending: a half-filled row would
    // otherwise be silently dropped by the API (it validates the shape).
    const parsed: PricingSurcharge[] = [];
    const seen = new Set<string>();
    for (const draft of surcharges) {
      const surcharge = draftToSurcharge(draft);
      if (!surcharge) {
        setError(
          "Each surcharge needs a code, a label, and an amount greater than zero.",
        );
        return;
      }
      if (seen.has(surcharge.code)) {
        setError(`Surcharge code "${surcharge.code}" is used more than once.`);
        return;
      }
      seen.add(surcharge.code);
      parsed.push(surcharge);
    }

    setSubmitting(true);

    const body = {
      name: name.trim(),
      baseFeeMinor: toMinor(baseFee),
      perKmMinor: toMinor(perKm),
      perKgMinor: toMinor(perKg),
      minFeeMinor: toMinor(minFee),
      priority: Number(priority),
      surcharges: parsed,
      // Left empty, a new rule starts applying immediately.
      ...(activeFrom ? { activeFrom: new Date(activeFrom).toISOString() } : {}),
    };

    try {
      if (initial) {
        await api.patch(`/pricing-rules/${initial.id}`, body);
      } else {
        await api.post<PricingRule>("/pricing-rules", body);
      }
      onSaved();
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
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="rate-name">Rule name</Label>
          <Input
            id="rate-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Standard rate"
            required
            minLength={2}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-base">Base fee (₦)</Label>
          <Input
            id="rate-base"
            type="number"
            min="0"
            step="0.01"
            required
            value={baseFee}
            onChange={(event) => setBaseFee(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-per-km">Per km (₦)</Label>
          <Input
            id="rate-per-km"
            type="number"
            min="0"
            step="0.01"
            required
            value={perKm}
            onChange={(event) => setPerKm(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-per-kg">Per kg (₦)</Label>
          <Input
            id="rate-per-kg"
            type="number"
            min="0"
            step="0.01"
            required
            value={perKg}
            onChange={(event) => setPerKg(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-min">Minimum fee (₦)</Label>
          <Input
            id="rate-min"
            type="number"
            min="0"
            step="0.01"
            required
            value={minFee}
            onChange={(event) => setMinFee(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-priority">Priority (higher wins)</Label>
          <Input
            id="rate-priority"
            type="number"
            min="0"
            step="1"
            required
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-active-from">Active from (optional)</Label>
          <Input
            id="rate-active-from"
            type="date"
            value={activeFrom}
            onChange={(event) => setActiveFrom(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border bg-background/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label>Surcharges</Label>
            <p className="text-xs text-muted-foreground">
              Optional extras a dispatcher can tick when booking (express speed,
              rough terrain, special handling). Nothing is charged unless it is
              selected.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setSurcharges((rows) => [
                ...rows,
                { code: "", label: "", kind: "flat", amount: "" },
              ])
            }
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {surcharges.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet — bookings are priced by base, distance and weight only.
          </p>
        ) : (
          <div className="space-y-2">
            {surcharges.map((row, index) => (
              <div
                key={index}
                className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_9rem_8rem_auto]"
              >
                <Input
                  aria-label="Surcharge code"
                  placeholder="code"
                  value={row.code}
                  onChange={(event) =>
                    updateSurcharge(index, { code: event.target.value })
                  }
                />
                <Input
                  aria-label="Surcharge label"
                  placeholder="Label shown to customers"
                  value={row.label}
                  onChange={(event) =>
                    updateSurcharge(index, { label: event.target.value })
                  }
                />
                <Select
                  aria-label="Surcharge kind"
                  value={row.kind}
                  onChange={(event) =>
                    updateSurcharge(index, {
                      kind: event.target.value as SurchargeKind,
                    })
                  }
                >
                  <option value="flat">Flat ₦</option>
                  <option value="percent">Percent %</option>
                </Select>
                <Input
                  aria-label="Surcharge amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={row.kind === "percent" ? "25" : "1500.00"}
                  value={row.amount}
                  onChange={(event) =>
                    updateSurcharge(index, { amount: event.target.value })
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove surcharge"
                  onClick={() => removeSurcharge(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {initial ? "Save changes" : "Create rate card"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function toMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

function toMinor(major: string): number {
  const value = Number(major);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
}

/**
 * An editable surcharge row. `amount` is the human number the admin types -
 * 25 for 25%, 1500 for ₦1,500 - which converts to the API's basis points or
 * minor units by multiplying by 100.
 */
interface SurchargeDraft {
  code: string;
  label: string;
  kind: SurchargeKind;
  amount: string;
}

function surchargeToDraft(surcharge: PricingSurcharge): SurchargeDraft {
  return {
    code: surcharge.code,
    label: surcharge.label,
    kind: surcharge.kind,
    amount: String(surcharge.value / 100),
  };
}

function draftToSurcharge(draft: SurchargeDraft): PricingSurcharge | null {
  const code = draft.code.trim();
  const label = draft.label.trim();
  const amount = Number(draft.amount);
  if (!code || !label || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return { code, label, kind: draft.kind, value: Math.round(amount * 100) };
}

function surchargeSummary(surcharges: PricingSurcharge[]): string {
  if (surcharges.length === 0) return "No surcharges";
  const labels = surcharges.map((surcharge) => surcharge.label);
  const shown = labels.slice(0, 3).join(", ");
  return labels.length > 3 ? `${shown} +${labels.length - 3} more` : shown;
}
