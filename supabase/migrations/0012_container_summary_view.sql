-- Per-container aggregate (expected/scanned/items/pending-unknown), used by
-- ContainerHistoryPage.tsx so the list doesn't need to pull every item and
-- scan event for every container just to show totals. security_invoker
-- makes the view respect the querying user's RLS on the underlying tables
-- (same branch-scoping as containers/container_items themselves), instead
-- of running with the view owner's broader access.
create view public.container_summary
with (security_invoker = true) as
select
  c.id as container_id,
  coalesce(sum(ci.expected_qty), 0)::integer as expected_qty,
  coalesce((
    select sum(se.delta)
    from public.container_scan_events se
    join public.container_items ci2 on ci2.id = se.container_item_id
    where ci2.container_id = c.id
  ), 0)::integer as scanned_qty,
  count(ci.id) filter (where ci.deleted_at is null)::integer as items_total,
  count(ci.id) filter (where ci.deleted_at is null and ci.expected_qty = coalesce((
    select sum(se.delta) from public.container_scan_events se where se.container_item_id = ci.id
  ), 0))::integer as items_complete,
  (
    select count(*) from public.container_unknown_codes u
    where u.container_id = c.id and u.status in ('pending', 'review_later')
  )::integer as pending_unknown_count
from public.containers c
left join public.container_items ci on ci.container_id = c.id and ci.deleted_at is null
where c.deleted_at is null
group by c.id;

grant select on public.container_summary to authenticated;
