update public.products p set name = t.n, updated_at = now()
from (values ('CAMISON','VESTIDO DE NOCHE'), ('ANORAK ADULTO','ADULT ANORAK')) t(o,n)
where p.name = t.o and p.deleted_at is null;
