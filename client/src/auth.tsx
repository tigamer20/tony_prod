import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Member } from "./types";

interface AuthState {
  me: Member | null;
  loading: boolean;
  perms: Set<string>;
  can: (...keys: string[]) => boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

interface MePayload {
  user: Member;
  permissions: string[];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Member | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const apply = useCallback((p: MePayload | null) => {
    setMe(p?.user ?? null);
    setPerms(new Set(p?.permissions ?? []));
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<MePayload>("/auth/me"));
    } catch {
      apply(null);
    }
  }, [apply]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const onExpired = () => apply(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [refresh, apply]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      perms,
      can: (...keys) => keys.some((k) => perms.has(k)),
      login: async (identifier, password) => apply(await api.post<MePayload>("/auth/login", { identifier, password })),
      register: async (data) => apply(await api.post<MePayload>("/auth/register", data)),
      logout: async () => {
        await api.post("/auth/logout");
        apply(null);
      },
      refresh,
    }),
    [me, loading, perms, apply, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
