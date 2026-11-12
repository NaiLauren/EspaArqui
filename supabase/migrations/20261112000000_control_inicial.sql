-- Esquema del panel de control de Espacio Arquitectura.
--
-- El panel es de uso interno del estudio: no entran ni clientes ni
-- proveedores. Por eso no hay roles ni permisos por obra; la única pregunta
-- que hace cada política es "¿este usuario pertenece al estudio?".
--
-- Las tres patas del panel (agenda, pagos, materiales) cuelgan de `obras`.
-- Son opcionales: una reunión o un gasto pueden no pertenecer a ninguna obra,
-- así que las claves foráneas permiten NULL y usan ON DELETE SET NULL. Borrar
-- una obra vieja no debe hacer desaparecer el historial de pagos.

-- ---------------------------------------------------------------------------
-- Quién puede entrar
-- ---------------------------------------------------------------------------

-- Supabase deja que cualquiera se registre con mail y contraseña si esa opción
-- está activa. Confiar sólo en "está autenticado" significaría que un
-- desconocido que se registra ve la facturación del estudio. Esta tabla es la
-- lista blanca: estar autenticado no alcanza, hay que estar acá.
create table if not exists public.miembros (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email   text not null,
    nombre  text,
    creado  timestamptz not null default now()
);

-- La función va SECURITY DEFINER a propósito. Si consultara `miembros` como el
-- usuario que llama, la política de `miembros` volvería a llamar a esta
-- función y Postgres cortaría por recursión infinita. Al correr como dueña
-- saltea RLS y la cadena termina.
-- El search_path vacío evita que alguien con permiso de crear tablas en otro
-- esquema anteponga un `miembros` falso y se autoapruebe; por eso adentro
-- todas las referencias llevan el esquema escrito completo.
create or replace function public.es_miembro()
returns boolean
language sql
security definer
stable
set search_path = ''
as $func$
    select exists (
        select 1 from public.miembros m where m.user_id = (select auth.uid())
    );
$func$;

alter table public.miembros enable row level security;

drop policy if exists "miembros: el estudio se ve entre si" on public.miembros;
create policy "miembros: el estudio se ve entre si" on public.miembros for select to authenticated
    using (public.es_miembro());

-- No hay política de insert, update ni delete sobre `miembros` a propósito:
-- dar de alta a alguien se hace desde el panel de Supabase. Así ni una falla
-- en el frontend puede sumar usuarios al estudio.

-- ---------------------------------------------------------------------------
-- Obras
-- ---------------------------------------------------------------------------

create table if not exists public.obras (
    id      uuid primary key default gen_random_uuid(),
    nombre  text not null,
    cliente text,
    estado  text not null default 'activa'
            check (estado in ('activa', 'pausada', 'terminada')),
    notas   text,
    creado  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------

-- Las tres cosas que pidió el cliente (reuniones, trabajos a realizar y
-- trabajos pendientes) son dos ejes de una misma fila, no tres tablas:
--   - `tipo` separa reunión de trabajo;
--   - `fecha` NULL es el trabajo pendiente que todavía no tiene día.
-- Modelarlo así deja mandar un pendiente a la semana poniéndole fecha, en vez
-- de moverlo de tabla.
create table if not exists public.agenda (
    id          uuid primary key default gen_random_uuid(),
    tipo        text not null default 'trabajo'
                check (tipo in ('reunion', 'trabajo')),
    titulo      text not null,
    obra_id     uuid references public.obras (id) on delete set null,
    fecha       date,
    hora_inicio time,
    hora_fin    time,
    lugar       text,
    estado      text not null default 'pendiente'
                check (estado in ('pendiente', 'hecho', 'cancelado')),
    notas       text,
    creado      timestamptz not null default now()
);

-- La vista semanal siempre filtra por rango de fechas; sin el índice, cada
-- cambio de semana recorre la tabla entera.
create index if not exists agenda_fecha_idx on public.agenda (fecha);

-- ---------------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------------

-- Registro interno: acá no se cobra nada, se anota lo que ya pasó o lo que
-- está por vencer. No hay datos de tarjeta ni de cuentas bancarias, y es a
-- propósito: guardarlos traería obligaciones que este panel no necesita.
--
-- `monto` va NUMERIC y no float: en coma flotante 0.1 + 0.2 no da 0.3, y en
-- una tabla de plata ese error se acumula hasta que los totales no cierran.
create table if not exists public.pagos (
    id         uuid primary key default gen_random_uuid(),
    obra_id    uuid references public.obras (id) on delete set null,
    tipo       text not null default 'cobro'
               check (tipo in ('cobro', 'gasto')),
    concepto   text not null,
    monto      numeric(14, 2) not null check (monto >= 0),
    moneda     text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    estado     text not null default 'pendiente'
               check (estado in ('pendiente', 'pagado')),
    vence      date,
    fecha_pago date,
    metodo     text,
    notas      text,
    creado     timestamptz not null default now()
);

create index if not exists pagos_estado_vence_idx on public.pagos (estado, vence);

-- ---------------------------------------------------------------------------
-- Pedidos de materiales
-- ---------------------------------------------------------------------------

create table if not exists public.pedidos (
    id               uuid primary key default gen_random_uuid(),
    obra_id          uuid references public.obras (id) on delete set null,
    proveedor        text,
    estado           text not null default 'borrador'
                     check (estado in ('borrador', 'pedido', 'recibido', 'cancelado')),
    fecha_pedido     date,
    entrega_estimada date,
    notas            text,
    creado           timestamptz not null default now()
);

-- Los ítems sí van en cascada: una lista de materiales no tiene sentido sin el
-- pedido que la contiene.
create table if not exists public.pedido_items (
    id              uuid primary key default gen_random_uuid(),
    pedido_id       uuid not null references public.pedidos (id) on delete cascade,
    material        text not null,
    cantidad        numeric(12, 2) not null default 1 check (cantidad > 0),
    unidad          text not null default 'u',
    precio_unitario numeric(14, 2),
    moneda          text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    recibido        boolean not null default false,
    orden           integer not null default 0
);

create index if not exists pedido_items_pedido_idx on public.pedido_items (pedido_id);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

-- Mismo criterio en las cinco tablas: el estudio hace todo, el resto no
-- existe. Va `with check` además de `using` para que tampoco se puedan
-- insertar filas desde afuera de la lista blanca.
alter table public.obras        enable row level security;
alter table public.agenda       enable row level security;
alter table public.pagos        enable row level security;
alter table public.pedidos      enable row level security;
alter table public.pedido_items enable row level security;

drop policy if exists "obras: solo el estudio" on public.obras;
create policy "obras: solo el estudio" on public.obras
    for all to authenticated
    using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "agenda: solo el estudio" on public.agenda;
create policy "agenda: solo el estudio" on public.agenda
    for all to authenticated
    using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "pagos: solo el estudio" on public.pagos;
create policy "pagos: solo el estudio" on public.pagos
    for all to authenticated
    using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "pedidos: solo el estudio" on public.pedidos;
create policy "pedidos: solo el estudio" on public.pedidos
    for all to authenticated
    using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "pedido_items: solo el estudio" on public.pedido_items;
create policy "pedido_items: solo el estudio" on public.pedido_items
    for all to authenticated
    using (public.es_miembro()) with check (public.es_miembro());

-- ---------------------------------------------------------------------------
-- Permisos sobre la función
-- ---------------------------------------------------------------------------

-- Postgres otorga EXECUTE a PUBLIC en toda función nueva, así que `es_miembro`
-- quedaba colgada en `/rest/v1/rpc/es_miembro` para cualquiera, incluso sin
-- iniciar sesión. No filtraba datos (sólo dice si quien llama es del estudio),
-- pero no hay motivo para dejarla expuesta: la necesitan únicamente las
-- políticas RLS, que corren como `authenticated`.
revoke execute on function public.es_miembro() from public;
revoke execute on function public.es_miembro() from anon;
grant  execute on function public.es_miembro() to authenticated;
