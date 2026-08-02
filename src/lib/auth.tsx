import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "blocked"
    | "active"
    | "suspended";
  status_message: string | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  workspaceId: string | null;
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

    const parsed = JSON.parse(raw) as Session & {
      expires_at?: number;
    };

    if (!parsed?.access_token) return null;

    if (
      parsed.expires_at &&
      parsed.expires_at * 1000 < Date.now()
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getSessionFast(
  timeoutMs = 2000,
): Promise<Session | null> {
  const stored = readStoredSession();

  try {
    const result = await Promise.race([
      supabase.auth
        .getSession()
        .then(({ data }) => data.session),

      new Promise<Session | null>((resolve) => {
        setTimeout(() => resolve(stored), timeoutMs);
      }),
    ]);

    return result ?? stored;
  } catch {
    return stored;
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(
    async (userId: string | undefined) => {
      if (!userId) {
        setProfile(null);
        setIsAdmin(false);
        return;
      }

      const [profileResult, rolesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            `
              id,
              user_id,
              workspace_id,
              full_name,
              email,
              phone,
              company,
              status,
              status_message
            `,
          )
          .eq("user_id", userId)
          .maybeSingle(),

        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId),
      ]);

      if (profileResult.error) {
        console.error(
          "Error cargando perfil:",
          profileResult.error,
        );
      }

      if (rolesResult.error) {
        console.error(
          "Error cargando roles:",
          rolesResult.error,
        );
      }

      setProfile(
        (profileResult.data as Profile | null) ?? null,
      );

      setIsAdmin(
        Boolean(
          rolesResult.data?.some(
            (row) => row.role === "admin",
          ),
        ),
      );
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const { data: authListener } =
      supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          if (!active) return;

          setSession(newSession);

          if (!newSession) {
            setProfile(null);
            setIsAdmin(false);
            setLoading(false);
            return;
          }

          void loadProfile(newSession.user.id);
        },
      );

    void getSessionFast()
      .then(async (currentSession) => {
        if (!active) return;

        setSession(currentSession);

        await loadProfile(
          currentSession?.user?.id,
        );
      })
      .catch((error) => {
        console.error(
          "Error cargando sesión:",
          error,
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const currentSession =
        await getSessionFast();

      setSession(currentSession);

      await loadProfile(
        currentSession?.user?.id,
      );
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();

    setSession(null);
    setProfile(null);
    setIsAdmin(false);
  }, []);

  const workspaceId =
    profile?.workspace_id ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      workspaceId,
      isAdmin,
      loading,
      refresh,
      signOut,
    }),
    [
      session,
      profile,
      workspaceId,
      isAdmin,
      loading,
      refresh,
      signOut,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth debe usarse dentro de AuthProvider",
    );
  }

  return context;
}

export function useWorkspaceId() {
  return useAuth().workspaceId;
}
