import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  workspace_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: "pending" | "approved" | "rejected" | "blocked" | "active" | "suspended";
  status_message: string | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;

function readStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session & { expires_at?: number };
    if (!parsed?.access_token) return null;
    if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

/**
 * supabase-js serializes auth calls behind a Web Lock. If another tab/iframe
 * holds a stale lock, getSession() never resolves and the whole app renders
 * blank. Race it against a short timeout and fall back to the stored session.
 */
export async function getSessionFast(timeoutMs = 2000): Promise<Session | null> {
  const stored = readStoredSession();
  try {
    const result = await Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session),
      new Promise<Session | null>((resolve) => setTimeout(() => resolve(stored), timeoutMs)),
    ]);
    return result ?? stored;
  } catch {
    return stored;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, workspace_id, full_name, email, phone, company, status, status_message")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile((prof as Profile) ?? null);
    setIsAdmin(Boolean(roles?.some((r) => r.role === "admin")));
  }, []);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (!newSession) {
        setProfile(null);
        setIsAdmin(false);
      }
    });

    getSessionFast()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        await loadProfile(current?.user?.id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    if (session?.user.id) {
      void loadProfile(session.user.id);
    }
  }, [session?.user.id, loadProfile]);

  const refresh = useCallback(async () => {
    const current = await getSessionFast();
    setSession(current);
    await loadProfile(current?.user?.id);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // Quitar el vínculo del usuario al salir para evitar recibir avisos privados
    // después del cierre de sesión. Conservar la suscripción del navegador para
    // restaurarla automáticamente al volver a iniciar sesión.
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/botsky-sw.js');
        const subscription = await registration?.pushManager.getSubscription();
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        if (subscription && activeSession) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${activeSession.access_token}`,
            },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        }
      }
    } catch (error) {
      console.warn('[BOT SKY] No se pudo desvincular push durante cierre de sesión', error);
    }
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setIsAdmin(false);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isAdmin,
      loading,
      refresh,
      signOut,
    }),
    [session, profile, isAdmin, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

export function useWorkspaceId() {
  return useAuth().profile?.workspace_id ?? null;
}
