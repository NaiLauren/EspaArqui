-- Agrega soporte de moneda (ARS / USD) a los ítems de pedidos de materiales.
-- Los ítems cargados antes de esta migración quedan en ARS por defecto.

alter table public.pedido_items
    add column if not exists moneda text not null default 'ARS'
    check (moneda in ('ARS', 'USD'));
