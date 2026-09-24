-- Packing lists grade fardos E / A / B; the system names them Primera / Segunda / Tercera.
-- The importer converts them, and this trigger covers any other way of inserting container items.
create or replace function public.normalize_container_item_calidad() returns trigger
language plpgsql as $$
begin
  new.calidad := case upper(btrim(new.calidad))
    when 'E' then 'Primera' when 'A' then 'Segunda' when 'B' then 'Tercera' else new.calidad end;
  return new;
end $$;

drop trigger if exists container_items_normalize_calidad on public.container_items;
create trigger container_items_normalize_calidad
  before insert or update of calidad on public.container_items
  for each row execute function public.normalize_container_item_calidad();

update public.container_items set calidad = case upper(btrim(calidad))
  when 'E' then 'Primera' when 'A' then 'Segunda' when 'B' then 'Tercera' end
where upper(btrim(calidad)) in ('E', 'A', 'B');
