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

function readStoredSession(allowExpired = false): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session & { expires_at?: number };
    if (!parsed?.access_token) return null;
    if (!allowExpired && parsed.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

/**
 * Cuentas guardadas en ESTE navegador (como Gmail): cambiar de tienda con un clic,
 * sin volver a escribir la contraseña. Se guarda la misma sesión que Supabase ya
 * guarda en este navegador; «Cerrar sesión» la borra de la lista.
 */
const SAVED_ACCOUNTS_KEY = "botsky-saved-accounts";
const MAX_SAVED_ACCOUNTS = 8;
type SavedAccountRecord = {
  userId: string;
  email: string;
  label: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  savedAt: number;
};
export type SavedAccount = Pick<SavedAccountRecord, "userId" | "email" | "label">;

function readSavedAccounts(): SavedAccountRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(window.localStorage.getItem(SAVED_ACCOUNTS_KEY) || "[]") as SavedAccountRecord[];
    return Array.isArray(list) ? list.filter((a) => a?.userId && a.refresh_token) : [];
  } catch {
    return [];
  }
}

function writeSavedAccounts(list: SavedAccountRecord[]) {
  try {
    window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(list.slice(0, MAX_SAVED_ACCOUNTS)));
  } catch {
    // sin almacenamiento: simplemente no se recuerdan cuentas
  }
}

function saveAccountSession(session: Session | null, label?: string | null) {
  if (typeof window === "undefined" || !session?.user?.id || !session.refresh_token) return;
  try {
    // «Solo mientras el navegador esté abierto»: no recordar la cuenta.
    if (window.localStorage.getItem(BROWSER_ONLY_KEY) === "1") return;
  } catch {
    return;
  }
  const list = readSavedAccounts();
  const previous = list.find((a) => a.userId === session.user.id);
  const record: SavedAccountRecord = {
    userId: session.user.id,
    email: session.user.email ?? previous?.email ?? "",
    label: (label || previous?.label || session.user.email || "Cuenta").trim(),
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? 0,
    savedAt: Date.now(),
  };
  writeSavedAccounts([record, ...list.filter((a) => a.userId !== record.userId)]);
}

export function listSavedAccounts(): SavedAccount[] {
  return readSavedAccounts().map(({ userId, email, label }) => ({ userId, email, label }));
}

export function forgetSavedAccount(userId: string) {
  writeSavedAccounts(readSavedAccounts().filter((a) => a.userId !== userId));
}

/** Pasa a otra cuenta guardada sin contraseña. La cuenta actual queda guardada (no se revoca). */
export async function switchToSavedAccount(userId: string): Promise<boolean> {
  const target = readSavedAccounts().find((a) => a.userId === userId);
  if (!target) return false;
  const current = readStoredSession(true);
  if (current && current.user?.id !== userId) saveAccountSession(current);
  try {
    // setSession reemplaza la sesión local SIN cerrar la anterior en el servidor
    // (signOut la revocaría y ya no se podría volver a ella sin contraseña).
    const { data, error } = await supabase.auth.setSession({
      access_token: target.access_token,
      refresh_token: target.refresh_token,
    });
    if (error || !data.session) throw error ?? new Error("Sesión vencida");
    rememberSession(true);
    saveAccountSession(data.session, target.label);
    return true;
  } catch {
    // La sesión guardada ya no sirve (cerrada en otro lado o vencida): pedir contraseña.
    forgetSavedAccount(userId);
    return false;
  }
}

/** «Agregar otra cuenta»: guarda la actual y abre el login sin cerrarla en el servidor. */
export function addAnotherAccount() {
  if (typeof window === "undefined") return;
  saveAccountSession(readStoredSession(true));
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignorar
  }
  window.location.assign("/auth");
}

/**
 * «Mantener sesión iniciada por 30 días» (se elige al iniciar sesión).
 * - Marcado: la sesión dura 30 días desde el inicio de sesión.
 * - Sin marcar: la sesión termina al cerrar el navegador.
 * Sin elección guardada (sesiones anteriores a esta opción) no se cierra nada.
 */
const REMEMBER_UNTIL_KEY = "botsky-session-until";
const BROWSER_ONLY_KEY = "botsky-session-browser-only";
const BROWSER_ALIVE_KEY = "botsky-session-alive";
const REMEMBER_DAYS = 30;

export function rememberSession(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (remember) {
      window.localStorage.setItem(REMEMBER_UNTIL_KEY, String(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000));
      window.localStorage.removeItem(BROWSER_ONLY_KEY);
    } else {
      window.localStorage.setItem(BROWSER_ONLY_KEY, "1");
      window.localStorage.removeItem(REMEMBER_UNTIL_KEY);
    }
    window.sessionStorage.setItem(BROWSER_ALIVE_KEY, "1");
  } catch {
    // Sin almacenamiento disponible: se mantiene el comportamiento habitual.
  }
}

function clearSessionPreference() {
  try {
    window.localStorage.removeItem(REMEMBER_UNTIL_KEY);
    window.localStorage.removeItem(BROWSER_ONLY_KEY);
  } catch {
    // ignorar
  }
}

/** true si la sesión guardada ya no debe seguir abierta según la opción elegida. */
function sessionPolicyExpired(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Recién llegado desde un enlace del correo (restablecer contraseña o
    // confirmar cuenta): es un ingreso nuevo, no cerrar esa sesión.
    if (/access_token=|type=recovery/.test(window.location.hash) || /[?&]code=/.test(window.location.search)) {
      window.sessionStorage.setItem(BROWSER_ALIVE_KEY, "1");
      return false;
    }
    const until = Number(window.localStorage.getItem(REMEMBER_UNTIL_KEY) || 0);
    if (until && Date.now() > until) return true;
    const browserOnly = window.localStorage.getItem(BROWSER_ONLY_KEY) === "1";
    if (browserOnly && window.sessionStorage.getItem(BROWSER_ALIVE_KEY) !== "1") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * supabase-js serializes auth calls behind a Web Lock. If another tab/iframe
 * holds a stale lock, getSession() never resolves and the whole app renders
 * blank. Race it against a short timeout and fall back to the stored session.
 */
export async function getSessionFast(timeoutMs = 2000): Promise<Session | null> {
  if (sessionPolicyExpired()) {
    clearSessionPreference();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return null;
  }
  const stored = readStoredSession();
  try {
    const pending = supabase.auth.getSession().then(({ data }) => data.session);
    const result = await Promise.race([
      pending,
      new Promise<Session | null>((resolve) => setTimeout(() => resolve(stored), timeoutMs)),
    ]);
    if (result) return result;
    // Volviste después de un rato: el token venció y se está renovando. Con internet
    // lento eso tarda más de 2 s; esperar en vez de mandar al login.
    if (readStoredSession(true)?.refresh_token) {
      const renewed = await Promise.race([
        pending,
        new Promise<Session | null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (renewed) return renewed;
    }
    return stored;
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
    const label = (prof as Profile | null)?.company || (prof as Profile | null)?.full_name;
    if (label) {
      const list = readSavedAccounts();
      const mine = list.find((a) => a.userId === userId);
      if (mine && mine.label !== label) writeSavedAccounts(list.map((a) => (a.userId === userId ? { ...a, label } : a)));
    }
    setIsAdmin(Boolean(roles?.some((r) => r.role === "admin")));
  }, []);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      // Enlace de «Olvidé mi contraseña»: llevar siempre a la pantalla de nueva
      // contraseña, aunque el correo haya abierto otra página del sitio.
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/restablecer") {
        window.location.replace("/restablecer");
        return;
      }
      setSession(newSession);
      if (newSession) saveAccountSession(newSession);
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
    // scope local: cerrar SOLO en este dispositivo. Antes cerraba en todos y un
    // vendedor que salía desde su celular le cerraba la sesión al dueño.
    const { data: { session: leaving } } = await supabase.auth.getSession();
    if (leaving?.user?.id) forgetSavedAccount(leaving.user.id);
    await supabase.auth.signOut({ scope: "local" });
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
