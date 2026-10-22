import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

type PushState = 'checking' | 'enabled' | 'disabled' | 'busy';

function base64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/botsky-sw.js');
  return registration ? registration.pushManager.getSubscription() : null;
}

async function registerForCurrentUser(subscription: PushSubscription) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Iniciá sesión en BOT SKY.');
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'No se pudo guardar la suscripción en BOT SKY.');
  }
}

export default function ActivarNotificacionesBotSky() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>('checking');
  const [message, setMessage] = useState('');

  // Consultar el dispositivo al entrar; si ya estaba habilitado, volver a asociarlo
  // con el usuario autenticado sin solicitar permiso otra vez.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      setState('checking');
      setMessage('');
      try {
        if (!user || !('Notification' in window) || Notification.permission !== 'granted') {
          if (!cancelled) setState('disabled');
          return;
        }
        const existing = await getExistingSubscription();
        if (!existing) {
          if (!cancelled) setState('disabled');
          return;
        }
        await registerForCurrentUser(existing);
        if (!cancelled) setState('enabled');
      } catch (error) {
        if (!cancelled) {
          setState('disabled');
          setMessage('No se pudo restaurar la conexión: ' + String(error instanceof Error ? error.message : error));
        }
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [user?.id]);

  async function activate() {
    setState('busy');
    setMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Este navegador no admite notificaciones push.');
      }
      if (!PUBLIC_KEY) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en Vercel.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Debés permitir las notificaciones del navegador.');
      await navigator.serviceWorker.register('/botsky-sw.js');
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(PUBLIC_KEY),
      });
      await registerForCurrentUser(subscription);
      setState('enabled');
      setMessage('Notificaciones activadas en este celular.');
    } catch (error) {
      setState('disabled');
      setMessage('❌ ' + String(error instanceof Error ? error.message : error));
    }
  }

  async function deactivate() {
    setState('busy');
    setMessage('');
    try {
      const existing = await getExistingSubscription();
      if (existing) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Iniciá sesión para desactivar los avisos.');
        const response = await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        if (!response.ok) throw new Error('No se pudo eliminar el registro de este celular.');
        await existing.unsubscribe();
      }
      setState('disabled');
      setMessage('Notificaciones desactivadas en este celular.');
    } catch (error) {
      setState('enabled');
      setMessage('❌ ' + String(error instanceof Error ? error.message : error));
    }
  }

  return <section className="rounded-xl border p-5 space-y-3">
    <h2 className="font-semibold">🔔 Notificaciones BOT SKY</h2>
    <p className="text-sm text-muted-foreground">Recibí avisos de ventas y novedades en este celular, sin WhatsApp.</p>
    {state === 'checking' && <p role="status" className="text-sm">Comprobando notificaciones…</p>}
    {state === 'enabled' && <p role="status" className="text-sm text-green-600 font-medium">✅ Notificaciones activadas en este celular</p>}
    {(state === 'disabled' || state === 'busy') && <button className="rounded-md bg-violet-600 px-4 py-2 text-white disabled:opacity-50" type="button" onClick={activate} disabled={state === 'busy'}>{state === 'busy' ? 'Procesando…' : '🔔 Activar avisos en este celular'}</button>}
    {state === 'enabled' && <button className="rounded-md border px-4 py-2 disabled:opacity-50" type="button" onClick={deactivate}>Desactivar en este celular</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
