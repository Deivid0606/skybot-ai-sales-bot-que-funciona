-- Schedule safe background resumption of checkout conversations after an AI outage.
-- The request uses the existing Vault secret; never embed credentials in migrations.
select cron.schedule(
  'botsky-ai-recovery',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://skybot-ai-sales-130022.vercel.app/api/internal/ai-recovery-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'botsky_cron_secret'
          order by created_at desc limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
