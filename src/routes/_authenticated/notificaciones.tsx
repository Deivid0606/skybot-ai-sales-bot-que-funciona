import { useEffect } from "react";
import { formatDateTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, EmptyState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { SellerNotificationPreferences } from "@/components/seller-notification-preferences";

export const Route = createFileRoute("/_authenticated/notificaciones")({
  head: () => ({ meta: [{title:"Notificaciones — BOT SKY"}] }),
  component: NotificationsPage,
});
function NotificationsPage() {
  const { user, profile } = useAuth();
  const workspaceId = profile?.workspace_id;
  const qc = useQueryClient();
  const {data:items=[], isLoading, error} = useQuery({
    queryKey:["notifications",workspaceId,user?.id],
    enabled:!!user && !!workspaceId,
    queryFn:async()=>{
      const {data,error}=await supabase.from("notifications").select("*")
        .eq("user_id",user!.id).order("created_at",{ascending:false}).limit(100);
      if(error)throw error;
      return data??[];
    }
  });
  useEffect(()=>{
    if(!user)return;
    const channel=supabase.channel(`notifications-page-${user.id}`)
       .on("postgres_changes",{event:"*",schema:"public",table:"notifications",filter:`user_id=eq.${user.id}`},
          ()=>{void qc.invalidateQueries({queryKey:["notifications",workspaceId,user.id]});}).subscribe();
    return ()=>{void supabase.removeChannel(channel)};
  },[user?.id,workspaceId,qc]);
  const markAll=useMutation({
    mutationFn:async()=>{
      if(!user)throw new Error("Sesión no válida");
      const {error}=await supabase.from("notifications").update({read_at:new Date().toISOString()})
        .eq("user_id",user.id).is("read_at",null);
      if(error)throw error;
    },
    onSuccess:()=>{void qc.invalidateQueries({queryKey:["notifications"]});void qc.invalidateQueries({queryKey:["notifications-unread"]});}
  });
  return <PageShell>
    <PageHeader title="Notificaciones" description="Ventas, pagos y avisos de tu cuenta." actions={
      <Button variant="outline" disabled={markAll.isPending || !items.length} onClick={()=>markAll.mutate()}><CheckCheck className="mr-1 h-4 w-4"/> Marcar todo como leído</Button>
    }/>
    <SellerNotificationPreferences/>
    {isLoading?<p>Cargando avisos…</p>:error?<p role="alert">Error al cargar notificaciones.</p>:!items.length?
      <EmptyState title="Sin notificaciones" description="Aquí verás la actividad de tu cuenta."/>:
      <div className="space-y-2">{items.map(n=><Card key={n.id} className={n.read_at?"opacity-70":""}><CardContent className="flex items-start gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{n.title}</p><Badge variant="outline">{n.type}</Badge></div>{n.body&&<p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}</div><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</span></CardContent></Card>)}</div>}
  </PageShell>;
}
