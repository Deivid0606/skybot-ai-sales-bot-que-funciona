-- Copy del anuncio (Click-to-WhatsApp) y vínculo automático anuncio → producto.
alter table public.conversations add column if not exists ad_body text;
alter table public.ads add column if not exists body text;
alter table public.ads add column if not exists auto_linked boolean not null default false;
create unique index if not exists ads_workspace_ad_id_key on public.ads(workspace_id, ad_id);
-- Seguimiento del pedido en DCANP.
alter table public.orders add column if not exists dcanp_order_number text;
alter table public.orders add column if not exists dcanp_status text;
alter table public.orders add column if not exists dcanp_guide_at timestamptz;
alter table public.orders add column if not exists dcanp_checked_at timestamptz;
create index if not exists orders_dcanp_check_idx on public.orders (created_at) where dcanp_checked_at is null;
