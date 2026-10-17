"use client";

import { useState } from "react";
import { Copy, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { roleHasPermission, roleLabel } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { InviteResponse, TenantMember } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

const INVITABLE_ROLES = ["tenant_admin", "dispatcher", "driver", "customer"];

export default function TeamPage() {
  const { session, api } = useSession();
  const role = session?.tenant?.role ?? null;
  const canRead = roleHasPermission(role, "users:read");
  const canInvite = roleHasPermission(role, "users:invite");
  const canUpdate = roleHasPermission(role, "memberships:update");

  const { data, loading, error, reload } = useApiQuery<TenantMember[]>(
    async (client) => (await client.get<{ data: TenantMember[] }>("/users")).data,
    [],
  );

  const members = data ?? [];

  if (!canRead) {
    return (
      <>
        <PageHeader title="Team" />
        <ErrorState message="Only tenant administrators can manage the team." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team & roles"
        description={
          members.length > 0
            ? `${members.length} member${members.length === 1 ? "" : "s"}`
            : undefined
        }
        action={
          <Button variant="outline" onClick={reload} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        }
      />

      {canInvite ? <InviteCard onInvited={reload} /> : null}

      {error ? (
        <ErrorState message={error} />
      ) : members.length === 0 && !loading ? (
        <EmptyState message="No members yet. Invite your first teammate above." />
      ) : (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <MemberRow
                    key={member.membershipId}
                    member={member}
                    canUpdate={canUpdate}
                    api={api}
                    onChanged={reload}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const { api } = useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("driver");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    try {
      const result = await api.post<InviteResponse>("/users/invitations", {
        email: email.trim(),
        role,
        name: name.trim() || undefined,
      });
      setEmail("");
      setName("");
      setInviteUrl(result.inviteUrl ?? null);
      onInvited();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" />
          Invite a teammate
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Could not send the invitation</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {inviteUrl ? (
          <Alert className="mb-4">
            <AlertTitle>Invitation created</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Email delivery is disabled, so share this one-time link directly.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                  {inviteUrl}
                </code>
                <Button type="button" size="sm" variant="outline" onClick={copy}>
                  <Copy className="size-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Amina Diallo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {INVITABLE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Send invitation
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member,
  canUpdate,
  api,
  onChanged,
}: {
  member: TenantMember;
  canUpdate: boolean;
  api: ReturnType<typeof useSession>["api"];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(changes: { role?: string; status?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/memberships/${member.membershipId}`, changes);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const statusVariant =
    member.membershipStatus === "active"
      ? "default"
      : member.membershipStatus === "invited"
        ? "secondary"
        : "destructive";

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{member.name ?? member.email}</div>
        {member.name ? (
          <div className="text-xs text-muted-foreground">{member.email}</div>
        ) : null}
        {error ? (
          <div className="mt-1 text-xs text-destructive">{error}</div>
        ) : null}
      </TableCell>
      <TableCell>
        {canUpdate ? (
          <Select
            value={member.role}
            disabled={busy}
            onChange={(event) => void patch({ role: event.target.value })}
            className="w-40"
          >
            {INVITABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge variant="outline">{roleLabel(member.role)}</Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>
          {member.membershipStatus === "active"
            ? "Active"
            : member.membershipStatus === "invited"
              ? "Invited"
              : "Suspended"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {canUpdate ? (
          member.membershipStatus === "suspended" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void patch({ status: "active" })}
            >
              <ShieldCheck className="size-4" />
              Reactivate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void patch({ status: "suspended" })}
            >
              Suspend
            </Button>
          )
        ) : null}
      </TableCell>
    </TableRow>
  );
}
