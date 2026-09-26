-- Prices typed in thousands ("119" for $119.000) were stored as-is; scale them up.
update public.product_variants set price = price * 1000, updated_at = now()
where deleted_at is null and price > 0 and price < 1000;
