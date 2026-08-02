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
        window.setTimeout(() => resolve(stored), timeoutMs);
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
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(
    async (userId: string | undefined) => {
      if (!userId) {
        setProfile(null);
        setWorkspaceId(null);
        setIsAdmin(false);
        return;
      }

      try {
        const [profileResult, membershipResult, rolesResult] =
          await Promise.all([
            supabase
              .from("profiles")
              .select(
                `
                  id,
                  workspace_id,
                  full_name,
                  email,
                  phone,
                  company,
                  status,
                  status_message
                `,
              )
              .eq("id", userId)
              .maybeSingle(),

            supabase
              .from("workspace_members")
              .select("workspace_id")
              .eq("user_id", userId)
              .limit(1)
              .maybeSingle(),

            supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", userId),
          ]);

        if (profileResult.error) {
          console.error(
            "Error cargando profile:",
            profileResult.error,
          );
        }

        if (membershipResult.error) {
          console.error(
            "Error cargando workspace_members:",
            membershipResult.error,
          );
        }

        if (rolesResult.error) {
          console.error(
            "Error cargando roles:",
            rolesResult.error,
          );
        }

        const loadedProfile =
          (profileResult.data as Profile | null) ?? null;

        /*
         * Primero usa profiles.workspace_id.
         * Si el perfil no existe o no tiene workspace,
         * usa workspace_members como respaldo.
         */
        const resolvedWorkspaceId =
          loadedProfile?.workspace_id ??
          membershipResult.data?.workspace_id ??
          null;

        setProfile(loadedProfile);
        setWorkspaceId(resolvedWorkspaceId);

        setIsAdmin(
          Boolean(
            rolesResult.data?.some(
              (row) => row.role === "admin",
            ),
          ),
        );

        console.log("AUTH WORKSPACE DEBUG", {
          authUserId: userId,
          profileId: loadedProfile?.id ?? null,
          profileWorkspaceId:
            loadedProfile?.workspace_id ?? null,
          membershipWorkspaceId:
            membershipResult.data?.workspace_id ?? null,
          resolvedWorkspaceId,
        });
      } catch (error) {
        console.error(
          "Error inesperado cargando autenticación:",
          error,
        );

        setProfile(null);
        setWorkspaceId(null);
        setIsAdmin(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!active) return;

        setSession(newSession);

        if (!newSession) {
          setProfile(null);
          setWorkspaceId(null);
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        setLoading(true);

        void loadProfile(newSession.user.id).finally(() => {
          if (active) {
            setLoading(false);
          }
        });
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
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const currentSession = await getSessionFast();

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
    setWorkspaceId(null);
    setIsAdmin(false);
  }, []);

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
