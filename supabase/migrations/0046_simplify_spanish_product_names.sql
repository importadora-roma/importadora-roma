-- Follow-up to 0045: use the plain Spanish name the business already uses (e.g. NYLON SOCKS -> CALCETIN).
update public.products p set name = t.n, updated_at = now() from (values
('CALCETIN DE NYLON','CALCETIN'),('PAÑUELO DE NYLON','PAÑUELOS'),('PANTIMEDIAS DE LANA','PANTIMEDIAS'),
('ROPA DE CICLISTA','CICLISTA'),('ROPA DE MOTOCICLISTA','MOTOCICLISTA'),('ROPA DEPORTIVA','DEPORTIVO'),
('BIKINI','TRAJE BAÑO'),('CORTINA BLACKOUT','CORTINA GRUESA'),('BOLSA DE COMPRAS','BOLSA REUTILIZABLE'),
('ROPA DE NIEVE MIX','ROPA DE NIEVE'),('CHALECO DE ESQUÍ','PARKA SIN MANGA')
) t(o,n) where p.name = t.o and p.deleted_at is null;
