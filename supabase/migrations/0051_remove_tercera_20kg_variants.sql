-- Tercera is only sold as 45KG; drop the empty Tercera 20KG variants (soft delete keeps their movement history).
update public.product_variants set active = false, deleted_at = now(), delete_reason = 'Tercera 20KG no existe (Tercera es 45KG)'
where deleted_at is null and calidad = 'Tercera' and kilo = 20
  and not exists (select 1 from public.inventory i where i.variant_id = product_variants.id and i.quantity <> 0);
