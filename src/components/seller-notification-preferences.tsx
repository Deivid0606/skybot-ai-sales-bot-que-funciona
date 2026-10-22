import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

/** Insertar <SellerNotificationPreferences /> en Mi perfil o Configuraciones. */
export function SellerNotificationPreferences() {
  const { user } = useAuth();
  const [phone, setPhone] = useState('');
  const [sales, setSales] = useState(true);
  const [news, setNews] = useState(true);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.from('seller_whatsapp_preferences' as any).select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error) { setMessage(error.message); return; }
        if (data) {
          setPhone(String(data.whatsapp_number ?? ''));
          setSales(data.notify_sales !== false);
          setNews(data.notify_news !== false);
          setConsent(Boolean(data.consented_at));
        }
      });
    return () => { active = false; };
  }, [user?.id]);
  async function save() {
    if (!user) return;
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('0') ? '595' + digits.slice(1) : digits.startsWith('9') ? '595' + digits : digits;
    if (!/^595\d{9}$/.test(normalized)) { setMessage('Ingresá un número paraguayo válido (ej.: 0974123456).'); return; }
    if (!consent) { setMessage('Debés autorizar los avisos para activar WhatsApp.'); return; }
    setBusy(true); setMessage('');
    const { error } = await supabase.from('seller_whatsapp_preferences' as any).upsert({
      user_id: user.id, whatsapp_number: normalized, notify_sales: sales, notify_news: news,
      consented_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as any, { onConflict: 'user_id' });
    setBusy(false);
    setMessage(error ? error.message : 'Preferencias guardadas. Los avisos necesitan las plantillas aprobadas y el servidor de envío activo.');
  }
  return <section className="rounded-xl border p-4 space-y-3">
    <h2 className="font-semibold">Mis notificaciones de WhatsApp</h2>
    <p className="text-sm">Elegí el número donde querés recibir tus avisos.</p>
    <label className="block text-sm">Mi WhatsApp
      <input className="mt-1 w-full rounded-md border bg-background p-2" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0974123456" />
    </label>
    <label className="flex gap-2"><input type="checkbox" checked={sales} onChange={e => setSales(e.target.checked)}/>Mis ventas confirmadas</label>
    <label className="flex gap-2"><input type="checkbox" checked={news} onChange={e => setNews(e.target.checked)}/>Novedades del administrador</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>Acepto recibir notificaciones de BOT SKY por WhatsApp</label>
    <button type="button" disabled={busy} onClick={save} className="rounded-md bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Guardando...':'Guardar mi número'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
