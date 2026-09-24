-- Keep container items in the order of the packing list they were imported from.
-- created_at is identical for every row of one import, so it can't carry the order.
create sequence if not exists public.container_items_line_no_seq;
alter table public.container_items add column line_no bigint not null default nextval('public.container_items_line_no_seq');
alter sequence public.container_items_line_no_seq owned by public.container_items.line_no;
create index if not exists container_items_container_line_idx on public.container_items (container_id, line_no);
