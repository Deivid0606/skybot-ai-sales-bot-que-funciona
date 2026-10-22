/**
 * Servidor BOT SKY: ejecutar processBotSkyNotificationBatch() desde una tarea
 * cron protegida (cada minuto o cada 5 minutos). NUNCA desde el navegador.
 * Requiere plantillas aprobadas de WhatsApp y acceso server-side al service role.
 */
import { supabaseAdmin } from '@/integrations/supabase/client.server';

const GRAPH = 'https://graph.facebook.com/v21.0'; // Ajustar a la versión oficial soportada en tu proyecto.

type QueueItem = {
  id: number; user_id: string; event_type: 'sale' | 'news'; attempts: number;
  payload: Record<string, any>;
};

function asText(x: unknown, max = 800): string {
  return String(x ?? '').trim().slice(0, max) || '-';
}

async function sendTemplate(args: {
  token: string; phoneId: string; recipient: string;
  template: string; parts: string[]; imageUrl?: string;
}) {
  const components: any[] = [{
    type: 'body',
    parameters: args.parts.map(text => ({ type: 'text', text })),
  }];
  if (args.imageUrl) components.unshift({
    type: 'header', parameters: [{ type: 'image', image: { link: args.imageUrl } }],
  });
  const response = await fetch(`${GRAPH}/${args.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: args.recipient, type: 'template',
      template: { name: args.template, language: { code: 'es' }, components },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(asText(payload?.error?.message || 'Meta rechazó el mensaje', 500));
  return String(payload?.messages?.[0]?.id ?? '');
}

export async function processBotSkyNotificationBatch() {
  const { data, error } = await (supabaseAdmin as any).rpc('botsky_claim_notifications', { batch_size: 20 });
  if (error) throw error;
  const batch = (data ?? []) as QueueItem[];
  const results: { id: number; status: string }[] = [];

  for (const item of batch) {
    try {
      const { data: pref, error: prefError } = await (supabaseAdmin as any)
        .from('seller_whatsapp_preferences').select('whatsapp_number,notify_sales,notify_news,consented_at')
        .eq('user_id', item.user_id).maybeSingle();
      if (prefError) throw prefError;
      if (!pref?.consented_at || !pref.whatsapp_number ||
          (item.event_type === 'sale' && !pref.notify_sales) ||
          (item.event_type === 'news' && !pref.notify_news)) {
        await (supabaseAdmin as any).from('botsky_whatsapp_outbox').update({ status: 'failed', last_error: 'Destinatario no suscrito' }).eq('id', item.id);
        results.push({ id: item.id, status: 'skipped' }); continue;
      }
      const { data: profile, error: profileError } = await (supabaseAdmin as any)
        .from('profiles').select('workspace_id,status').eq('id', item.user_id).single();
      if (profileError || !profile?.workspace_id) throw new Error('Sin workspace');
      if (item.event_type === 'news' && !['approved','active'].includes(profile.status))
        throw new Error('Cuenta no habilitada');
      const { data: conn, error: connError } = await (supabaseAdmin as any)
        .from('whatsapp_connections').select('phone_number_id,access_token')
        .eq('workspace_id', profile.workspace_id).maybeSingle();
      if (connError || !conn?.phone_number_id || !conn?.access_token)
        throw new Error('WhatsApp Cloud API no está conectada en el workspace');

      const p = item.payload ?? {};
      let template: string;
      let parts: string[];
      let imageUrl: string | undefined;
      if (item.event_type === 'sale') {
        template = 'botsky_venta_confirmada';
        parts = [asText(p.order_number, 80), asText(p.product, 250),
          `${Number(p.total || 0).toLocaleString('es-PY')} Gs.`];
      } else {
        const images = Array.isArray(p.images) ? p.images : [];
        const first = typeof images[0] === 'string' && /^https:\/\//.test(images[0]) ? images[0] : undefined;
        // Plantilla distinta con cabecera de imagen aprobada.
        imageUrl = first;
        template = imageUrl ? 'botsky_novedad_imagen' : 'botsky_novedad_texto';
        const attachments = (Array.isArray(p.links) ? p.links : [])
          .filter((l: any) => l && typeof l.url === 'string' && /^https:\/\//.test(l.url))
          .slice(0, 3).map((l: any) => `${asText(l.label, 45)}: ${l.url}`).join(' | ');
        // Usar URL estable de la aplicación, NO el dominio preview de Lovable.
        const link = `${process.env.BOTSKY_PUBLIC_URL?.replace(/\/$/, '') || ''}/novedades`;
        if (!process.env.BOTSKY_PUBLIC_URL) throw new Error('Configurar BOTSKY_PUBLIC_URL');
        parts = [asText(p.title, 180), asText(p.body, 550), asText(attachments || link, 950)];
      }
      const wamid = await sendTemplate({
        token: conn.access_token, phoneId: conn.phone_number_id,
        recipient: pref.whatsapp_number, template, parts, imageUrl,
      });
      const { error: updateError } = await (supabaseAdmin as any).from('botsky_whatsapp_outbox')
        .update({ status: 'sent', wamid, sent_at: new Date().toISOString(), last_error: null, locked_at: null })
        .eq('id', item.id);
      if (updateError) throw updateError;
      results.push({ id: item.id, status: 'sent' });
    } catch (e) {
      const last_error = asText(e instanceof Error ? e.message : e, 700);
      const retry = item.attempts < 5;
      await (supabaseAdmin as any).from('botsky_whatsapp_outbox').update({
        status: retry ? 'pending' : 'failed', last_error, locked_at: null,
        next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** item.attempts) * 60_000).toISOString(),
      }).eq('id', item.id);
      results.push({ id: item.id, status: retry ? 'retry' : 'failed' });
    }
  }
  return results;
}
