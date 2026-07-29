import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Clock, ShieldAlert, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/pendiente")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cuenta pendiente de aprobación — BOT SKY" },
      { name: "description", content: "Tu registro en BOT SKY está en revisión." },
      { property: "og:title", content: "Cuenta pendiente de aprobación — BOT SKY" },
      { property: "og:description", content: "Tu registro en BOT SKY está en revisión." },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const { profile, loading, signOut, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) navigate({ to: "/auth" });
    else if (profile && (profile.status === "approved" || profile.status === "active")) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, session, profile, navigate]);

  const rejected = profile?.status === "rejected";
  const blocked = profile?.status === "blocked" || profile?.status === "suspended";

  return (
    <div className="gradient-hero flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg surface-glow">
        <CardHeader className="text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            {rejected || blocked ? (
              <ShieldAlert className="h-6 w-6" />
            ) : (
              <Clock className="h-6 w-6" />
            )}
          </span>
          <CardTitle>
            {rejected
              ? "Registro rechazado"
              : blocked
                ? "Cuenta bloqueada"
                : "Pendiente de aprobación"}
          </CardTitle>
          <CardDescription>
            {rejected
              ? "El administrador rechazó tu solicitud de acceso."
              : blocked
                ? "Tu acceso fue bloqueado temporalmente."
                : "Tu cuenta fue creada correctamente. Un administrador debe aprobarla antes de que puedas ingresar al panel."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {profile?.status_message && (
            <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              {profile.status_message}
            </p>
          )}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Bot className="h-3.5 w-3.5" /> BOT SKY
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Actualizar estado
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
            >
              Cerrar sesión
            </Button>
          </div>
          <Link to="/" className="block text-xs text-muted-foreground underline">
            Volver al inicio
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
