import { supabaseAdmin } from '@/integrations/supabase/client.server';
import webpush from 'web-push';

export async function authUser(request: Request) {
  const match = /^Bearer (.+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(match[1]);
  return error ? null : data.user;
}
function configure() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
    throw new Error('Faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT');
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
export async function enqueuePush(userId: string, eventType: 'sale' | 'news', title: string, body: string, clickUrl: string) {
  // Call on the server AFTER the order/news was saved successfully. Never call from browser.
  const { error } = await supabaseAdmin.from('botsky_push_outbox').insert({
    user_id: userId, event_type: eventType, title, body, click_url: clickUrl,
  } as any);
  if (error) throw error;
}
export async function enqueueNewsForUsers(userIds: string[], title: string, body: string, clickUrl: string) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const { error } = await supabaseAdmin.from('botsky_push_outbox').insert(
    unique.map(userId => ({ user_id: userId, event_type: 'news', title, body, click_url: clickUrl })) as any,
  );
  if (error) throw error;
}
export async function processPushBatch() {
  configure();
  const { data: claimed, error: claimError } = await (supabaseAdmin as any).rpc('botsky_claim_push', { batch_size: 20 });
  if (claimError) throw claimError;
  const stats = { claimed: claimed?.length ?? 0, sent: 0, retries: 0, failed: 0, skipped: 0 };
  for (const job of claimed || []) {
    try {
      const { data: prefs } = await supabaseAdmin.from('botsky_push_preferences').select('*').eq('user_id', job.user_id).maybeSingle();
      if ((job.event_type === 'sale' && (prefs as any)?.notify_sales === false) ||
          (job.event_type === 'news' && (prefs as any)?.notify_news === false)) {
        await supabaseAdmin.from('botsky_push_outbox').update({ status:'sent', sent_at: new Date().toISOString(), locked_at:null }).eq('id',job.id);
        stats.skipped++; continue;
      }
      const { data: subs, error: subErr } = await supabaseAdmin.from('botsky_push_subscriptions').select('endpoint,subscription').eq('user_id',job.user_id);
      if (subErr) throw subErr;
      if (!subs?.length) {
        // No subscribed device yet. Keep in queue for a limited period.
        throw new Error('El vendedor aún no activó las notificaciones en un dispositivo');
      }
      let delivered = 0; let errorText = '';
      for (const s of subs) {
        try {
          await webpush.sendNotification((s as any).subscription, JSON.stringify({
            title:job.title, body:job.body, url:job.click_url, tag:`botsky-${job.id}`
          }), { TTL: 3600 });
          delivered++;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabaseAdmin.from('botsky_push_subscriptions').delete().eq('endpoint',(s as any).endpoint);
          }
          errorText = String(err?.message || err);
        }
      }
      if (!delivered) throw new Error(errorText || 'Ningún dispositivo recibió el push');
      const { error: updateError } = await supabaseAdmin.from('botsky_push_outbox').update({status:'sent',sent_at:new Date().toISOString(), locked_at:null,last_error:null}).eq('id',job.id);
      if (updateError) throw updateError;
      stats.sent++;
    } catch (err: any) {
      const terminal = job.attempts >= 8;
      const delay = Math.min(60 * 2 ** Math.min(job.attempts, 6), 3600);
      const { error } = await supabaseAdmin.from('botsky_push_outbox').update({
        status: terminal ? 'failed' : 'pending', locked_at:null,
        next_attempt_at:new Date(Date.now() + delay*1000).toISOString(),
        last_error:String(err?.message || err).slice(0,500),
      }).eq('id',job.id);
      if (error) console.error('BOT SKY push queue update failed', job.id, error.message);
      stats[terminal ? 'failed' : 'retries']++;
    }
  }
  return stats;
}
