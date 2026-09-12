-- Products have been catalogued under two parallel, overlapping quality
-- names: 'E'/'A'/'B' (from packing lists) and 'Primera'/'Segunda'/'Tercera'
-- (the business's own terminology) — for the SAME products, at overlapping
-- kilos, with real stock split arbitrarily between whichever naming was
-- used at the time. This merges every (product, kilo) pair that has both,
-- keeping the lettered variant's row (its cost/price is what gets
-- refreshed by packing-list uploads) but renaming it to the canonical
-- word, summing in the worded variant's stock, and reassigning every
-- historical reference before dropping the now-redundant worded row.
-- Kilo is already rendered as its own suffix everywhere calidad is shown
-- (`${calidad} ${formatKilo(kilo)}`), so fixing this text is the whole fix.

do $$
declare
  v_pair record;
  v_survivor_id uuid;
  v_loser_id uuid;
  v_merged_count int := 0;
begin
  for v_pair in
    select letter_v.id as letter_id, word_v.id as word_id
    from public.product_variants letter_v
    join public.product_variants word_v
      on word_v.product_id = letter_v.product_id
     and word_v.kilo = letter_v.kilo
     and word_v.deleted_at is null
    where letter_v.deleted_at is null
      and (
        (letter_v.calidad = 'E' and word_v.calidad = 'Primera') or
        (letter_v.calidad = 'A' and word_v.calidad = 'Segunda') or
        (letter_v.calidad = 'B' and word_v.calidad = 'Tercera')
      )
  loop
    v_survivor_id := v_pair.letter_id;
    v_loser_id := v_pair.word_id;

    insert into public.inventory (variant_id, branch_id, quantity)
    select v_survivor_id, branch_id, quantity
    from public.inventory where variant_id = v_loser_id
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    delete from public.inventory where variant_id = v_loser_id;

    update public.inventory_movements set variant_id = v_survivor_id where variant_id = v_loser_id;
    update public.sale_items set variant_id = v_survivor_id where variant_id = v_loser_id;
    update public.transfer_items set variant_id = v_survivor_id where variant_id = v_loser_id;
    update public.quotation_items set variant_id = v_survivor_id where variant_id = v_loser_id;
    update public.container_items set variant_id = v_survivor_id where variant_id = v_loser_id;

    delete from public.product_variants where id = v_loser_id;

    v_merged_count := v_merged_count + 1;
  end loop;

  -- Every remaining 'E'/'A'/'B' at this point has no worded duplicate left
  -- (any that did were just merged away above), so this rename can't
  -- collide with the unique (product_id, calidad, kilo) constraint.
  update public.product_variants set calidad = 'Primera' where calidad = 'E' and deleted_at is null;
  update public.product_variants set calidad = 'Segunda' where calidad = 'A' and deleted_at is null;
  update public.product_variants set calidad = 'Tercera' where calidad = 'B' and deleted_at is null;

  -- calidad_cost_defaults: prefer an existing worded default; only migrate
  -- the lettered one over if no worded row exists yet.
  delete from public.calidad_cost_defaults
  where calidad in ('E', 'A', 'B')
    and exists (
      select 1 from public.calidad_cost_defaults w
      where w.calidad = case public.calidad_cost_defaults.calidad
        when 'E' then 'Primera' when 'A' then 'Segunda' when 'B' then 'Tercera' end
    );

  update public.calidad_cost_defaults
  set calidad = case calidad when 'E' then 'Primera' when 'A' then 'Segunda' when 'B' then 'Tercera' end
  where calidad in ('E', 'A', 'B');

  insert into public.audit_logs (action, table_name, new_data)
  values ('calidad_naming_cleanup', 'product_variants', jsonb_build_object('merged_pairs', v_merged_count));
end $$;
