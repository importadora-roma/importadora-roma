-- Fardo (balya) vs saco (çuval): the same product/calidad/kilo can now exist
-- as both, each with its own stock and barcode. Everything already in the
-- catalog starts as 'fardo'; barcodes that a supplier list identifies as
-- sacks flip it (see 0039).
alter table public.product_variants
  add column unit_type text not null default 'fardo'
  check (unit_type in ('fardo', 'saco'));
