-- Inventario > Stock should be able to show variants in the order they
-- were uploaded from an Excel/CSV import, instead of always alphabetical
-- by calidad/kilo. A plain insertion-order column can't guarantee that on
-- its own: ImportPage.tsx creates rows through several concurrent workers,
-- so DB insertion order (and therefore any default-sequence value) doesn't
-- reliably match file row order. Instead the client precomputes the exact
-- file-row order for the *new* variants a given import will create and
-- reserves a contiguous block of sort_order values up front via
-- reserve_variant_sort_order_block(), then assigns them in that order —
-- this keeps assignment atomic/collision-free (backed by a real sequence)
-- while still being exact regardless of concurrency.
alter table public.product_variants add column sort_order bigint;

create sequence public.product_variants_sort_order_seq;

alter table public.product_variants
  alter column sort_order set default nextval('public.product_variants_sort_order_seq');

-- freeze today's existing (alphabetical) order as the starting sort_order,
-- so nothing visually changes until the next import.
with ordered as (
  select id, row_number() over (order by calidad, kilo, created_at) as rn
  from public.product_variants
)
update public.product_variants pv
set sort_order = ordered.rn
from ordered
where pv.id = ordered.id;

select setval(
  'public.product_variants_sort_order_seq',
  (select coalesce(max(sort_order), 0) from public.product_variants) + 1,
  false
);

alter table public.product_variants alter column sort_order set not null;

create or replace function public.reserve_variant_sort_order_block(p_count integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start bigint;
begin
  if p_count is null or p_count <= 0 then
    return null;
  end if;
  select nextval('public.product_variants_sort_order_seq') into v_start;
  if p_count > 1 then
    perform nextval('public.product_variants_sort_order_seq') from generate_series(2, p_count);
  end if;
  return v_start;
end;
$$;

grant execute on function public.reserve_variant_sort_order_block(integer) to authenticated;
