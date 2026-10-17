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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import type { PricingRule } from "@/lib/types";
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
            + (distance × per-km) + (weight × per-kg), floored at the minimum
            fee. Distance is the straight-line Haversine distance when both
            addresses have coordinates.
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
        <TableCell className="font-medium">{rule.name}</TableCell>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const body = {
      name: name.trim(),
      baseFeeMinor: toMinor(baseFee),
      perKmMinor: toMinor(perKm),
      perKgMinor: toMinor(perKg),
      minFeeMinor: toMinor(minFee),
      priority: Number(priority),
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
