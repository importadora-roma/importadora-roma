-- Saco/fardo distinction is dropped: every variant is a fardo again, one barcode per variant.
-- Where the SARDES load created a saco twin next to a fardo variant, the twin is folded into the
-- oldest variant of the (product, calidad, kilo) group; a lone saco variant simply becomes the fardo one.
do $$
declare
  g record;
  v_survivor uuid;
  v_sku text;
  o record;
begin
  for g in
    select product_id, calidad, kilo
    from public.product_variants
    where deleted_at is null
    group by product_id, calidad, kilo
    having count(*) > 1
  loop
    select id into v_survivor
    from public.product_variants
    where product_id = g.product_id and calidad = g.calidad and kilo = g.kilo and deleted_at is null
    order by created_at, id limit 1;

    select sku into v_sku from public.product_variants where id = v_survivor;

    if v_sku is null then
      select sku into v_sku
      from public.product_variants
      where product_id = g.product_id and calidad = g.calidad and kilo = g.kilo and deleted_at is null
        and id <> v_survivor and sku is not null
      order by (unit_type = 'fardo') desc, created_at limit 1;
    end if;

    for o in
      select id, sku from public.product_variants
      where product_id = g.product_id and calidad = g.calidad and kilo = g.kilo and deleted_at is null and id <> v_survivor
    loop
      -- container lines that pointed at the twin follow the survivor
      update public.container_items
      set variant_id = v_survivor,
          code = case when o.sku is not null and code_normalized = upper(regexp_replace(o.sku, '[[:space:]-]', '', 'g')) then null else code end
      where variant_id = o.id;
      update public.container_items set code = v_sku
      where variant_id = v_survivor and code is null and source = 'import' and v_sku is not null
        and not exists (select 1 from public.container_items x
                        where x.container_id = container_items.container_id and x.deleted_at is null
                          and x.code_normalized = upper(regexp_replace(v_sku, '[[:space:]-]', '', 'g')));
      delete from public.inventory where variant_id = o.id and quantity = 0;
      update public.product_variants set sku = null where id = o.id;
      delete from public.product_variants where id = o.id;
    end loop;

    update public.product_variants set sku = v_sku where id = v_survivor and sku is distinct from v_sku;
  end loop;
end $$;

alter table public.product_variants drop constraint if exists product_variants_product_calidad_kilo_unit_key;
alter table public.product_variants add constraint product_variants_product_id_calidad_kilo_key unique (product_id, calidad, kilo);
alter table public.product_variants drop column unit_type;
