import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { MAX_FILE_BYTES, uploadWorkspaceFile } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/planes")({
  head: () => ({
    meta: [
      { title: "Planes y recargas — BOT SKY" },
      { name: "description", content: "Compra conversaciones y consulta tu saldo disponible." },
      { property: "og:title", content: "Planes y recargas — BOT SKY" },
      { property: "og:description", content: "Planes de conversaciones para tu bot de ventas." },
    ],
  }),
  component: PlansPage,
});

function PlansPage() {
  const { profile, user } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ id: string; name: string; price: number; conversations: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("price");
      if (error) throw error;
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ["balance", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_balances")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: purchases } = useQuery({
    queryKey: ["purchases", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_purchases")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const request = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !user || !selected) throw new Error("Sesión no válida");
      let receiptPath: string | null = null;
      if (file) {
        if (file.size > MAX_FILE_BYTES) throw new Error("El comprobante supera 25MB");
        receiptPath = await uploadWorkspaceFile("receipts", workspaceId, file, "planes");
      }
      const { error } = await supabase.from("plan_purchases").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        plan_id: selected.id,
        plan_name: selected.name,
        amount: selected.price,
        conversations: selected.conversations,
        receipt_url: receiptPath,
        status: "pendiente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Solicitud enviada. Un administrador la revisará pronto.");
      setSelected(null);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setUploading(false),
  });

  return (
    <PageShell>
      <PageHeader
        title="Planes y recargas"
        description="Tu saldo se descuenta por conversación nueva atendida por la IA."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Disponibles", value: balance?.available ?? 0 },
          { label: "Compradas", value: balance?.purchased ?? 0 },
          { label: "Consumidas", value: balance?.consumed ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-display text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans?.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-6">
              <h3 className="font-display text-lg font-bold">{p.name}</h3>
              <p className="font-display text-3xl font-bold text-primary">
                {formatGs(p.price)}
              </p>
              <p className="text-sm text-muted-foreground">
                {p.conversations} conversaciones · {p.duration_days} días
              </p>
              <ul className="space-y-1.5 text-sm">
                {(p.benefits ?? []).map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-auto"
                onClick={() =>
                  setSelected({
                    id: p.id,
                    name: p.name,
                    price: Number(p.price),
                    conversations: p.conversations,
                  })
                }
              >
                Solicitar recarga
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="font-display text-base font-semibold">Mis solicitudes</h2>
          <div className="mt-3 space-y-2">
            {!purchases?.length && (
              <p className="text-sm text-muted-foreground">Aún no has solicitado recargas.</p>
            )}
            {purchases?.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <span className="font-medium">{p.plan_name}</span>
                <span className="text-muted-foreground">
                  {formatGs(p.amount)} · {p.conversations} conv.
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(p.created_at)}
                </span>
                <Badge
                  className="ml-auto"
                  variant={
                    p.status === "aprobado"
                      ? "default"
                      : p.status === "rechazado"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {p.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar {selected?.name}</DialogTitle>
            <DialogDescription>
              Adjunta el comprobante de pago. Un administrador aprobará tu recarga.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Comprobante (opcional)</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancelar
            </Button>
            <Button
              disabled={request.isPending || uploading}
              onClick={() => {
                setUploading(true);
                request.mutate();
              }}
            >
              {request.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Enviar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
