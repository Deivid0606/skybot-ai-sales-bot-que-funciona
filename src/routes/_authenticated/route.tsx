import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { BalanceBadge } from "@/components/balance-badge";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getSessionFast();
    if (!session?.user) throw redirect({ to: "/auth" });
    return { user: session.user };
  },
  pendingComponent: LoadingScreen,
  component: AuthenticatedLayout,
});

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedLayout() {
  const { profile, loading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !profile) return;
    const allowed = profile.status === "approved" || profile.status === "active";
    if (!allowed && !isAdmin) navigate({ to: "/pendiente" });
  }, [loading, profile, isAdmin, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur">
            <SidebarTrigger />
            <div className="min-w-0 flex-1 truncate text-sm font-medium">
              {profile?.company || profile?.full_name || "Panel"}
            </div>
            <BalanceBadge />
            <NotificationsBell />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cerrar sesión"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </header>
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
