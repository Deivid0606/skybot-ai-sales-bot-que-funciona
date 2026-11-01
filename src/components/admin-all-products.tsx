import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatGs } from "@/lib/format";
import { useStoreDirectory } from "@/lib/admin-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/page-shell";

type Row = {
  id: string; workspace_id: string; name: string; sku: string | null; price: number; promo_price: number | null;
  stock: number; is_active: boolean;
  product_prices: Array<{ id: string; label: string; price: number; sort_order: number }>;
};

/** Productos de TODAS las tiendas, agrupados por el correo del vendedor (solo lectura). */
export function AdminAllProducts() {
  const [search, setSearch] = useState("");
  const { data: stores } = useStoreDirectory(true);
  const { data: products, isLoading, error } = useQuery({
    queryKey: ["admin-all-products"],
    queryFn: async () => {
      const all: Row[] = [];
      for (let page = 0; page < 20; page++) {
        const { data, error } = await supabase.from("products")
          .select("id, workspace_id, name, sku, price, promo_price, stock, is_active, product_prices(id, label, price, sort_order)")
          .order("name").range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        all.push(...((data ?? []) as unknown as Row[]));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, Row[]>();
    for (const p of products ?? []) {
      const store = stores?.get(p.workspace_id);
      const text = `${p.name} ${p.sku ?? ""} ${store?.email ?? ""} ${store?.name ?? ""}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      map.set(p.workspace_id, [...(map.get(p.workspace_id) ?? []), p]);
    }
    return [...map.entries()]
      .map(([id, rows]) => ({ id, store: stores?.get(id), rows }))
      .sort((a, b) => (a.store?.email ?? "").localeCompare(b.store?.email ?? ""));
  }, [products, stores, search]);

  if (isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>;
  if (error) return <EmptyState title="No se pudieron cargar los productos" description={error instanceof Error ? error.message : ""} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar producto, SKU o correo" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">
          {(products ?? []).length} productos · {groups.length} tiendas · solo lectura (cada vendedor edita los suyos)
        </p>
      </div>
      {groups.length === 0 && <EmptyState title="Sin resultados" description="No hay productos que coincidan con la búsqueda." />}
      {groups.map(group => (
        <section key={group.id} className="space-y-3">
          {/* Separador por vendedor */}
          <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 backdrop-blur">
            <Mail className="h-4 w-4 text-primary" />
            <span className="font-semibold">{group.store?.email ?? "sin correo"}</span>
            <span className="text-sm text-muted-foreground">· {group.store?.name ?? "Tienda"}</span>
            <Badge variant="secondary" className="ml-auto">
              {group.rows.filter(r => r.is_active).length} activos / {group.rows.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {group.rows.map(p => (
              <Card key={p.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={p.name}>{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku || "Sin SKU"} · Stock {p.stock}</p>
                    </div>
                    <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Activo" : "Inactivo"}</Badge>
                  </div>
                  {p.product_prices?.length ? (
                    <div className="space-y-1">
                      {[...p.product_prices].sort((a, b) => a.sort_order - b.sort_order).slice(0, 3).map(item => (
                        <div key={item.id} className="flex justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
                          <span className="truncate">{item.label}</span><span className="shrink-0 font-semibold">{formatGs(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-semibold">{formatGs(p.promo_price ?? p.price)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
