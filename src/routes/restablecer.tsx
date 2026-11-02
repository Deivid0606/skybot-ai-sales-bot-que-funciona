import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, rememberSession } from "@/lib/auth";

export const Route = createFileRoute("/restablecer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Nueva contraseña — BOT SKY" },
      { name: "description", content: "Creá una contraseña nueva para tu cuenta de BOT SKY." },
    ],
  }),
  component: ResetPasswordPage,
});

/** Lee el error que Supabase deja en la URL cuando el enlace venció o ya se usó. */
function linkError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  const code = params.get("error_code") || params.get("error");
  if (!code) return null;
  return code === "otp_expired"
    ? "El enlace venció o ya fue usado. Pedí uno nuevo."
    : "El enlace no es válido. Pedí uno nuevo.";
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error] = useState(linkError);
  // El enlace del correo inicia la sesión; damos un momento a que se procese.
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Mínimo 8 caracteres");
    if (password.length > 72) return toast.error("Máximo 72 caracteres");
    if (password !== confirm) return toast.error("Las contraseñas no coinciden");
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      rememberSession(true);
      toast.success("Contraseña actualizada. ¡Bienvenido!");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No fue posible cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  const ready = Boolean(session?.user) && !error;
  const checking = !ready && !error && (authLoading || waiting);

  return (
    <div className="gradient-hero flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold">BOT SKY</span>
        </Link>
        <Card className="surface-glow">
          <CardHeader>
            <CardTitle>Nueva contraseña</CardTitle>
            <CardDescription>
              {ready ? `Cuenta: ${session?.user.email ?? ""}` : "Restablecé el acceso a tu cuenta."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {checking ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Verificando el enlace…
              </p>
            ) : ready ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">Contraseña nueva</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Repetir contraseña</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar contraseña
                </Button>
              </form>
            ) : (
              <>
                <p className="text-sm">
                  {error ?? "Abrí este enlace desde el correo de recuperación. Si ya venció, pedí uno nuevo."}
                </p>
                <Button asChild className="w-full">
                  <Link to="/auth">Pedir un enlace nuevo</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
