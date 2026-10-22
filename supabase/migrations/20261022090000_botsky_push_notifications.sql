-- BOT SKY / Push notifications: run in Supabase SQL Editor.
create table if not exists public.botsky_push_subscriptions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 subscription jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists botsky_push_subscriptions_user_id_idx on public.botsky_push_subscriptions(user_id);
create table if not exists public.botsky_push_outbox (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 event_type text not null check(event_type in ('sale','news')),
 title text not null,
 body text not null,
 click_url text not null default '/',
 status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
 attempts int not null default 0,
 next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists botsky_push_outbox_work_idx on public.botsky_push_outbox(status,next_attempt_at);
create table if not exists public.botsky_push_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 notify_sales boolean not null default true,
 notify_news boolean not null default true
);
-- Server-only data: do not grant direct API access to subscriptions, queue or preferences.
alter table public.botsky_push_subscriptions enable row level security;
alter table public.botsky_push_outbox enable row level security;
alter table public.botsky_push_preferences enable row level security;
revoke all on public.botsky_push_subscriptions from anon, authenticated;
revoke all on public.botsky_push_outbox from anon, authenticated;
revoke all on public.botsky_push_preferences from anon, authenticated;
-- Atomic claim prevents duplicate sends by simultaneous cron requests.
create or replace function public.botsky_claim_push(batch_size integer default 20)
returns setof public.botsky_push_outbox
language sql security definer set search_path = '' as $$
 with selected as (
  select id from public.botsky_push_outbox
  where (status='pending' and next_attempt_at <= now())
     or (status='processing' and locked_at < now() - interval '10 minutes')
  order by id for update skip locked limit least(greatest(batch_size,1),50)
 )
 update public.botsky_push_outbox o
 set status='processing', locked_at=now(), attempts=attempts+1
 from selected s where o.id=s.id returning o.*;
$$;
revoke all on function public.botsky_claim_push(integer) from public, anon, authenticated;
grant execute on function public.botsky_claim_push(integer) to service_role;

-- Dedupe across webhook repeats and immutable database events.
alter table public.botsky_push_outbox add column if not exists event_key text;
create unique index if not exists botsky_push_event_key_unique on public.botsky_push_outbox(user_id,event_key) where event_key is not null;

-- Orders are written by AI/webhook and by server manual registration.
create or replace function public.botsky_order_push_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    insert into public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
    select new.user_id,'sale','💰 ¡Nueva venta!',
     'Pedido #' || coalesce(new.order_number::text,new.id::text) || ' — G. ' || coalesce(new.total::text,'0'),
     '/pedidos','sale:'||new.id::text
    where exists (select 1 from public.botsky_push_subscriptions s where s.user_id=new.user_id)
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists botsky_orders_push on public.orders;
create trigger botsky_orders_push after insert on public.orders for each row execute function public.botsky_order_push_trigger();

-- news_posts is a live app table (not present in the downloaded schema snapshot).
-- Only newly published posts, and draft->published transitions, trigger an alert.
create or replace function public.botsky_news_push_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.is_published is true and (tg_op='INSERT' or old.is_published is distinct from true) then
   insert into public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
   select p.id,'news','📢 Nueva novedad BOT SKY', left(new.title::text,180),'/novedades',
          'news:'||new.id::text
   from public.profiles p
   join public.user_roles ur on ur.user_id=p.id and ur.role='seller'
   where p.status in ('approved','active')
     and exists (select 1 from public.botsky_push_subscriptions s where s.user_id=p.id)
   on conflict do nothing;
 end if;
 return new;
end $$;
do $$ begin
  if to_regclass('public.news_posts') is not null then
    execute 'drop trigger if exists botsky_news_push on public.news_posts';
    execute 'create trigger botsky_news_push after insert or update of is_published on public.news_posts for each row execute function public.botsky_news_push_trigger()';
  else
    raise notice 'news_posts missing: news trigger not installed; deploy after table exists';
  end if;
end $$;
