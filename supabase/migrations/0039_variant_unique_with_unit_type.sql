-- Saco and fardo of the same product/calidad/kilo are separate variants (own stock, own barcode).
alter table public.product_variants drop constraint product_variants_product_id_calidad_kilo_key;
alter table public.product_variants add constraint product_variants_product_calidad_kilo_unit_key unique (product_id, calidad, kilo, unit_type);
