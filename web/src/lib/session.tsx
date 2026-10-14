"use client";

import * as React from "react";
import { ApiClient, type TokenPair } from "./api";
import type { AuthResponse } from "./types";

const STORAGE_KEY = "routiq.session";

interface SessionState {
  accessToken: string;
  refreshToken: string;
  user: AuthResponse["user"];
  tenant: AuthResponse["tenant"];
}

interface SessionContextValue {
  ready: boolean;
  session: SessionState | null;
  api: ApiClient;
  login: (email: string, password: string, tenantId?: string) => Promise<AuthResponse>;
  switchTenant: (tenantId: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

function readStored(): SessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}

function writeStored(session: SessionState | null): void {
  if (typeof window === "undefined") return;
  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Holds the signed-in session (tokens + user + tenant) in memory and
 * localStorage, and exposes an {@link ApiClient} wired to it. Token refresh is
 * handled inside the client; a failed refresh clears the session so the UI can
 * redirect to the login screen.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [ready, setReady] = React.useState(false);
  const tokensRef = React.useRef<TokenPair | null>(null);
  const sessionRef = React.useRef<SessionState | null>(null);

  const updateSession = React.useCallback((next: SessionState | null) => {
    sessionRef.current = next;
    tokensRef.current = next
      ? { accessToken: next.accessToken, refreshToken: next.refreshToken }
      : null;
    writeStored(next);
    setSession(next);
  }, []);

  const api = React.useMemo(
    () =>
      new ApiClient(
        () => tokensRef.current,
        (tokens) => {
          if (!tokens) {
            updateSession(null);
            return;
          }
          tokensRef.current = tokens;
          const current = sessionRef.current;
          if (current) {
            const next: SessionState = {
              ...current,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            };
            sessionRef.current = next;
            writeStored(next);
            setSession(next);
          }
        },
      ),
    [updateSession],
  );

  React.useEffect(() => {
    const stored = readStored();
    if (stored) {
      sessionRef.current = stored;
      tokensRef.current = {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
      };
      setSession(stored);
    }
    setReady(true);
  }, []);

  const login = React.useCallback(
    async (email: string, password: string, tenantId?: string) => {
      const auth = await api.login(email, password, tenantId);
      updateSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user,
        tenant: auth.tenant,
      });
      return auth;
    },
    [api, updateSession],
  );

  const switchTenant = React.useCallback(
    async (tenantId: string) => {
      const auth = await api.switchTenant(tenantId);
      updateSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user,
        tenant: auth.tenant,
      });
      return auth;
    },
    [api, updateSession],
  );

  const logout = React.useCallback(async () => {
    await api.logout();
    updateSession(null);
  }, [api, updateSession]);

  const value = React.useMemo<SessionContextValue>(
    () => ({ ready, session, api, login, switchTenant, logout }),
    [ready, session, api, login, switchTenant, logout],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within <SessionProvider>");
  }
  return context;
}
