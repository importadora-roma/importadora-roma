-- Some English-named products are the same product as an existing Spanish one; use that Spanish name.
update public.products p set name = t.n, updated_at = now() from (values
('ADULT ANORAK','PARKA ADULTO'),('ANORAK NIÑO','PARKA NIÑO'),('VESTIDO DE NOCHE','VESTIDO FIESTA'),
('JUVENIL WINTER MAN','JUVENIL HOMBRE INVIERNO'),('NOEL MIX','NAVIDAD MIX'),('FLEECE','POLAR'),
('LEGGINS','CALZAS'),('CORSE','CORSET'),('JUVENIL SHORT','SHORT JUVENIL')
) t(o,n) where p.name = t.o and p.deleted_at is null;
