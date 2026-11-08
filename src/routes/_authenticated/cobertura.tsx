import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, MapPin, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { PY_CITIES } from "@/lib/py-cities";
import type { CoverageMethod } from "@/lib/managed-coverage";

export const Route = createFileRoute("/_authenticated/cobertura")({
  head: () => ({
    meta: [
      { title: "Zonas de cobertura — BOT SKY" },
      { name: "description", content: "Elegí a qué ciudades de Paraguay enviás y con qué modalidad." },
    ],
  }),
  component: CoveragePage,
});

type Row = { method: CoverageMethod; fee: string; address: boolean; note: string };
const keyOf = (city: string, department: string) => `${city}|${department}`;
const EMPTY: Row = { method: "sin_envio", fee: "", address: true, note: "" };
const DEPARTMENTS = [...new Set(PY_CITIES.map(c => c.department))].sort((a, b) => a.localeCompare(b, "es"));
const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const METHOD_LABEL: Record<CoverageMethod, string> = {
  contraentrega: "Contraentrega (pago al recibir)",
  encomienda: "Encomienda (pago anticipado)",
  sin_envio: "Sin envío",
};

function CoveragePage() {
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState<"" | CoverageMethod>("");
  const [bulkFee, setBulkFee] = useState("");

  const { data: saved, isLoading } = useQuery({
    queryKey: ["workspace-coverage", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("workspace_coverage")
        .select("city, department, method, shipping_fee, address_required, note").eq("workspace_id", workspaceId);
      if (error) throw error;
      return (data ?? []) as Array<{ city: string; department: string; method: CoverageMethod; shipping_fee: number | null; address_required: boolean; note: string | null }>;
    },
  });

  useEffect(() => {
    if (!saved || dirty) return;
    const next: Record<string, Row> = {};
    for (const r of saved) next[keyOf(r.city, r.department)] = {
      method: r.method, fee: r.shipping_fee == null ? "" : String(Math.round(Number(r.shipping_fee))),
      address: r.address_required !== false, note: r.note ?? "",
    };
    setRows(next);
  }, [saved, dirty]);

  const rowFor = (city: string, dep: string) => rows[keyOf(city, dep)] ?? EMPTY;
  const update = (city: string, dep: string, patch: Partial<Row>) => {
    setRows(prev => ({ ...prev, [keyOf(city, dep)]: { ...(prev[keyOf(city, dep)] ?? EMPTY), ...patch } }));
    setDirty(true);
  };
  const updateMany = (pred: (city: string, dep: string, row: Row) => boolean, patch: (row: Row) => Partial<Row>) => {
    setRows(prev => {
      const next = { ...prev };
      for (const c of PY_CITIES) {
        const row = next[keyOf(c.city, c.department)] ?? EMPTY;
        if (pred(c.city, c.department, row)) next[keyOf(c.city, c.department)] = { ...row, ...patch(row) };
      }
      return next;
    });
    setDirty(true);
  };

  const counts = useMemo(() => {
    const out = { contraentrega: 0, encomienda: 0, sin_envio: 0 };
    for (const c of PY_CITIES) out[rowFor(c.city, c.department).method]++;
    return out;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const q = norm(search.trim());
    return PY_CITIES.filter(c => (!department || c.department === department) &&
      (!status || rowFor(c.city, c.department).method === status) &&
      (!q || norm(c.city).includes(q) || norm(c.department).includes(q)));
  }, [search, department, status, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const c of visible) map.set(c.department, [...(map.get(c.department) ?? []), c]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [visible]);

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Sesión no válida");
      const now = new Date().toISOString();
      const active = PY_CITIES.map(c => ({ c, r: rowFor(c.city, c.department) })).filter(x => x.r.method !== "sin_envio");
      for (const { r } of active) {
        if (r.fee.trim() && (!/^\d+$/.test(r.fee.trim()) || Number(r.fee) > 5_000_000)) throw new Error("Revisá los costos: solo números en guaraníes (ej. 20000).");
      }
      const payload = active.map(({ c, r }) => ({
        workspace_id: workspaceId, city: c.city, department: c.department, method: r.method,
        shipping_fee: r.fee.trim() === "" ? null : Number(r.fee), address_required: r.method === "contraentrega" ? r.address : false,
        note: r.note.trim() || null, updated_at: now,
      }));
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await (supabase as any).from("workspace_coverage").upsert(payload.slice(i, i + 200), { onConflict: "workspace_id,city,department" });
        if (error) throw error;
      }
      // Las que quedaron «Sin envío» se borran (sin fila = sin envío).
      const keep = new Set(active.map(({ c }) => keyOf(c.city, c.department)));
      const toDelete = (saved ?? []).filter(r => !keep.has(keyOf(r.city, r.department)));
      for (const r of toDelete) {
        const { error } = await (supabase as any).from("workspace_coverage").delete()
          .eq("workspace_id", workspaceId).eq("city", r.city).eq("department", r.department);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["workspace-coverage"] });
      toast.success("Cobertura guardada. El bot ya la usa en los próximos mensajes.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Sesión no válida");
      const { error } = await (supabase as any).from("workspace_coverage").delete().eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: () => {
      setRows({}); setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["workspace-coverage"] });
      toast.success("Cobertura borrada. El bot vuelve a usar la cobertura escrita en tu entrenamiento.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importTraining = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/coverage/import", {
        method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const result = await response.json().catch(() => null) as {
        error?: string; rows?: Array<{ city: string; department: string; method: CoverageMethod; shipping_fee: number | null; address_required: boolean }>;
        restOfCountry?: CoverageMethod | null; unmatched?: string[]; source?: string;
      } | null;
      if (!response.ok || !result) throw new Error(result?.error ?? "No se pudo importar");
      return result;
    },
    onSuccess: (result) => {
      const next: Record<string, Row> = {};
      for (const r of result.rows ?? []) next[keyOf(r.city, r.department)] = {
        method: r.method, fee: r.shipping_fee == null ? "" : String(r.shipping_fee), address: r.address_required !== false, note: "",
      };
      if (result.restOfCountry === "encomienda") {
        for (const c of PY_CITIES) if (!next[keyOf(c.city, c.department)]) next[keyOf(c.city, c.department)] = { ...EMPTY, method: "encomienda", address: false };
      }
      setRows(next); setDirty(true);
      const n = (result.rows ?? []).length;
      if (!n && result.restOfCountry !== "encomienda") toast.warning("No encontré ciudades en tu entrenamiento. Cargalas a mano con los interruptores.");
      else toast.success(`Importé ${n} ciudades${result.restOfCountry === "encomienda" ? " y el resto del país por encomienda" : ""}. Revisá y tocá «Guardar».`);
      if (result.unmatched?.length) toast.info(`No reconocí: ${result.unmatched.slice(0, 8).join(", ")}${result.unmatched.length > 8 ? "…" : ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managed = (saved?.length ?? 0) > 0;

  return (
    <PageShell>
      <PageHeader
        title="Zonas de cobertura"
        description="Prendé las ciudades a las que enviás y elegí la modalidad. El bot usa esto para responder (y reemplaza la lista de ciudades de tu entrenamiento)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => importTraining.mutate()} disabled={importTraining.isPending}>
              {importTraining.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Importar desde mi entrenamiento
            </Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="bg-emerald-600 hover:bg-emerald-600">{counts.contraentrega} contraentrega</Badge>
            <Badge className="bg-amber-500 hover:bg-amber-500">{counts.encomienda} encomienda</Badge>
            <Badge variant="secondary">{counts.sin_envio} sin envío</Badge>
            <span className="text-muted-foreground">
              {managed ? "El bot usa esta cobertura." : "Todavía no guardaste: el bot usa la cobertura escrita en tu entrenamiento."}
              {dirty && " · Tenés cambios sin guardar."}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar ciudad…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">Todos los departamentos</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={e => setStatus(e.target.value as "" | CoverageMethod)}>
              <option value="">Todas las modalidades</option>
              <option value="contraentrega">Contraentrega</option>
              <option value="encomienda">Encomienda</option>
              <option value="sin_envio">Sin envío</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {department && (
              <Button size="sm" variant="outline" onClick={() => updateMany((_c, d, r) => d === department && r.method === "sin_envio", () => ({ method: "contraentrega", address: true }))}>
                Contraentrega en todo {department}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => updateMany((_c, _d, r) => r.method === "sin_envio", () => ({ method: "encomienda", address: false }))}>
              Resto del país por encomienda
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              if (confirm("¿Apagar todas las ciudades? (no se guarda hasta que toques «Guardar»)")) updateMany(() => true, () => ({ method: "sin_envio" }));
            }}>
              Apagar todo
            </Button>
            <div className="flex items-center gap-2">
              <Input className="h-9 w-32" inputMode="numeric" placeholder="Costo Gs." value={bulkFee} onChange={e => setBulkFee(e.target.value.replace(/\D/g, ""))} />
              <Button size="sm" variant="outline" disabled={!bulkFee} onClick={() => updateMany((_c, _d, r) => r.method === "contraentrega", () => ({ fee: bulkFee }))}>
                Aplicar a las de contraentrega
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([dep, cities]) => (
            <Card key={dep}>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-primary" /> {dep}
                  <span className="font-normal text-muted-foreground">({cities.length})</span>
                </div>
                <div className="divide-y">
                  {cities.map(c => {
                    const r = rowFor(c.city, c.department);
                    const on = r.method !== "sin_envio";
                    return (
                      <div key={keyOf(c.city, c.department)} className="flex flex-wrap items-center gap-2 px-4 py-2">
                        <Switch checked={on} onCheckedChange={v => update(c.city, c.department, v ? { method: "contraentrega", address: true } : { method: "sin_envio" })} aria-label={`Envío a ${c.city}`} />
                        <span className={`min-w-[9rem] flex-1 text-sm ${on ? "font-medium" : "text-muted-foreground"}`}>{c.city}</span>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={r.method}
                          onChange={e => update(c.city, c.department, { method: e.target.value as CoverageMethod, address: e.target.value === "contraentrega" })}
                        >
                          {(Object.keys(METHOD_LABEL) as CoverageMethod[]).map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                        </select>
                        {on && (
                          <Input
                            className="h-9 w-32" inputMode="numeric"
                            placeholder={r.method === "contraentrega" ? "0 = gratis" : "a confirmar"}
                            value={r.fee}
                            onChange={e => update(c.city, c.department, { fee: e.target.value.replace(/\D/g, "") })}
                            aria-label={`Costo de envío a ${c.city}`}
                          />
                        )}
                        {r.method === "contraentrega" && (
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input type="checkbox" checked={r.address} onChange={e => update(c.city, c.department, { address: e.target.checked })} />
                            Pide dirección
                          </label>
                        )}
                        {on && (
                          <Input className="h-9 min-w-[8rem] flex-1" placeholder="Nota (ej. entrega 24 a 48 h)" value={r.note}
                            onChange={e => update(c.city, c.department, { note: e.target.value.slice(0, 200) })} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {!grouped.length && <p className="text-sm text-muted-foreground">No hay ciudades con ese filtro.</p>}
        </div>
      )}

      {managed && (
        <div className="flex justify-end">
          <Button variant="ghost" className="text-destructive" onClick={() => {
            if (confirm("¿Borrar toda la cobertura de esta pestaña? El bot volverá a usar la escrita en tu entrenamiento.")) clearAll.mutate();
          }} disabled={clearAll.isPending}>
            <Trash2 className="mr-2 h-4 w-4" /> Borrar cobertura de la pestaña
          </Button>
        </div>
      )}
    </PageShell>
  );
}
