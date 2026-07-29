import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { formatDate, formatGs } from "@/lib/format";
import { ContactInfoDialog } from "@/components/contact-info-dialog";

export const Route = createFileRoute("/_authenticated/contactos")({
  head: () => ({
    meta: [
      { title: "Contactos — BOT SKY" },
      {
        name: "description",
        content: "Base de clientes con historial de compras, gasto total y última compra.",
      },
      { property: "og:title", content: "Contactos — BOT SKY" },
      {
        property: "og:description",
        content: "Guarda los datos de cada cliente y mira sus métricas de compra.",
      },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: contacts } = useQuery({
    queryKey: ["contacts", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["contacts-orders", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("contact_id, total, status, product_title, created_at")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return data;
    },
  });

  const stats = useMemo(() => {
    const map = new Map<
      string,
      { count: number; total: number; last: string | null; lastProduct: string | null }
    >();
    for (const o of orders ?? []) {
      if (!o.contact_id || o.status === "cancelado") continue;
      const cur =
        map.get(o.contact_id) ?? { count: 0, total: 0, last: null, lastProduct: null };
      cur.count += 1;
      cur.total += Number(o.total ?? 0);
      if (!cur.last || new Date(o.created_at) > new Date(cur.last)) {
        cur.last = o.created_at;
        cur.lastProduct = o.product_title ?? null;
      }
      map.set(o.contact_id, cur);
    }
    return map;
  }, [orders]);

  const filtered = (contacts ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.city ?? "").toLowerCase().includes(q)
    );
  });

  const totalSpent = [...stats.values()].reduce((a, s) => a + s.total, 0);
  const buyers = [...stats.values()].filter((s) => s.count > 0).length;

  return (
    <PageShell>
      <PageHeader
        title="Contactos"
        description="Base de clientes con sus datos y métricas de compra."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Contactos</p>
            <p className="text-2xl font-semibold">{contacts?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Clientes que compraron</p>
            <p className="text-2xl font-semibold">{buyers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Facturado a contactos</p>
            <p className="text-2xl font-semibold">{formatGs(totalSpent)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nombre, teléfono o ciudad"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin contactos"
          description="Los contactos se crean automáticamente cuando un cliente te escribe."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c) => {
            const s = stats.get(c.id);
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name || c.phone}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.phone}
                      {c.city ? ` · ${c.city}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="secondary">{s?.count ?? 0} compras</Badge>
                      <Badge variant="outline">{formatGs(s?.total ?? 0)}</Badge>
                      {s?.last && (
                        <span className="text-muted-foreground">
                          Última: {formatDate(s.last)}
                          {s.lastProduct ? ` · ${s.lastProduct}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setActiveId(c.id)}>
                    Ver ficha
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ContactInfoDialog
        contactId={activeId}
        open={Boolean(activeId)}
        onOpenChange={(o) => !o && setActiveId(null)}
      />
    </PageShell>
  );
}
