-- Bugfix: sale_payments_payment_method_check (from 0001_initial_schema.sql)
-- never included 'credito', even though create_sale has always tried to
-- insert it for credit sales (0009_credit_sales.sql). Every credit-sale
-- attempt has therefore been rejected by Postgres at insert time — the
-- Créditos feature has never actually been able to record a sale.
alter table public.sale_payments drop constraint sale_payments_payment_method_check;
alter table public.sale_payments add constraint sale_payments_payment_method_check
  check (payment_method in ('efectivo', 'tarjeta', 'transferencia', 'credito'));
