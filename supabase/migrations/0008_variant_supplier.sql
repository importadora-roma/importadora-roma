-- Supplier tag per variant (simple label, e.g. "MERSIN", "OTRO") — not a
-- full suppliers table, just enough to filter/report by origin.
alter table public.product_variants add column if not exists supplier text;
