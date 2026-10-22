import {useState} from 'react';
import {supabase} from '@/integrations/supabase/client';

const PUBLIC_KEY=import.meta.env.VITE_VAPID_PUBLIC_KEY;
function base64ToUint8Array(base64: string) {
  const padding='='.repeat((4-base64.length%4)%4);
  const raw=atob((base64+padding).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw, c=>c.charCodeAt(0));
}
export default function ActivarNotificacionesBotSky(){
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState(false);
  async function activate(){
    setBusy(true); setMsg('');
    try{
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) throw new Error('Este navegador no admite notificaciones push.');
      if(!PUBLIC_KEY) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en Vercel.');
      const permission=await Notification.requestPermission();
      if(permission!=='granted') throw new Error('Debés permitir las notificaciones del navegador.');
      await navigator.serviceWorker.register('/botsky-sw.js');
      const ready=await navigator.serviceWorker.ready;
      const existing=await ready.pushManager.getSubscription();
      const subscription=existing || await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToUint8Array(PUBLIC_KEY)});
      const {data:{session}}=await supabase.auth.getSession();
      if(!session) throw new Error('Iniciá sesión en BOT SKY.');
      const res=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(subscription)});
      if(!res.ok) throw new Error((await res.json()).error||'Error guardando el dispositivo');
      setMsg('✅ Notificaciones activadas en este dispositivo.');
    }catch(e:any){setMsg('❌ '+String(e?.message||e));}
    finally{setBusy(false);}
  }
  return <section className="rounded-xl border p-5 space-y-3"><h2 className="font-semibold">🔔 Notificaciones BOT SKY</h2><p className="text-sm text-muted-foreground">Recibí avisos de ventas y novedades en este celular, sin WhatsApp. En iPhone, primero agregá BOT SKY a tu pantalla de inicio.</p><button className="rounded-md bg-violet-600 px-4 py-2 text-white disabled:opacity-50" type="button" onClick={activate} disabled={busy}>{busy?'Activando…':'🔔 Activar avisos en este celular'}</button>{msg&&<p role="status" className="text-sm">{msg}</p>}</section>;
}
