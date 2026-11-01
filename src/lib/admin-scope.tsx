import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";

/**
 * Vista «Todas las tiendas» para el administrador (Productos, Dashboard, Pedidos).
 * Se recuerda en el navegador. Para vendedores siempre es «Mi tienda».
 */
const STORAGE_KEY = "botsky-admin-all-stores";
const EVENT = "botsky-admin-all-stores-change";

export function useStoreScope() {
  const { isAdmin } = useAuth();
  const [allStores, setAllStoresState] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setAllStoresState(localStorage.getItem(STORAGE_KEY) === "1"); } catch { /* sin almacenamiento */ }
    };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  const setAllStores = (value: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); } catch { /* sin almacenamiento */ }
    setAllStoresState(value);
    window.dispatchEvent(new Event(EVENT));
  };
  return { isAdmin, allStores: isAdmin && allStores, setAllStores };
}

export function StoreScopeToggle() {
  const { isAdmin, allStores, setAllStores } = useStoreScope();
  if (!isAdmin) return null;
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium shadow-sm">
      <Store className="h-4 w-4 text-primary" />
      Todas las tiendas
      <Switch checked={allStores} onCheckedChange={setAllStores} aria-label="Ver los datos de todas las tiendas" />
    </label>
  );
}

export type StoreInfo = { id: string; name: string; email: string };

/** Tiendas con el correo de su vendedor (dueño), para mostrar separadores. */
export function useStoreDirectory(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-store-directory"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [{ data: workspaces, error: wsError }, { data: profiles, error: prError }] = await Promise.all([
        supabase.from("workspaces").select("id, name, owner_id"),
        supabase.from("profiles").select("id, email, workspace_id, company, full_name"),
      ]);
      if (wsError) throw wsError;
      if (prError) throw prError;
      const byId = new Map<string, StoreInfo>();
      for (const ws of workspaces ?? []) {
        const owner = (profiles ?? []).find(p => p.id === ws.owner_id)
          ?? (profiles ?? []).find(p => p.workspace_id === ws.id);
        byId.set(ws.id, {
          id: ws.id,
          name: owner?.company || ws.name || owner?.full_name || "Tienda",
          email: owner?.email || "sin correo",
        });
      }
      return byId;
    },
  });
}
