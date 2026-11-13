-- Asistente con IA del panel.
--
-- La IA lee y propone; nunca escribe datos del estudio. La función del
-- servidor (supabase/functions/asistente) devuelve una propuesta y es la
-- persona la que toca "Guardar": ese guardado lo hace el navegador con su
-- propia sesión, bajo las mismas políticas RLS que el resto del panel.
--
-- Lo único que la función escribe es el contador de uso, y lo hace con la
-- sesión del usuario, no con la clave de servicio. Por eso todo lo que limita
-- al asistente (si está encendido, cuántas cargas quedan) vive acá, en la
-- base, y no en el código de la función.

-- ---------------------------------------------------------------------------
-- Ajustes: una sola fila
-- ---------------------------------------------------------------------------

-- El asistente es un opcional pago. `activa` es el interruptor: en false el
-- panel esconde la barra del asistente y la función rechaza los pedidos.
-- `cupo_mensual` son las cargas (audios o fotos) incluidas por mes.
-- `cupo_texto` es un tope alto para lo escrito: no se cobra, pero sin tope
-- una sesión abierta podría gastar la clave sin límite.
--
-- La clave primaria booleana con CHECK deja que exista una sola fila: un
-- segundo insert choca contra la clave en vez de crear ajustes en disputa.
create table if not exists public.ia_ajustes (
    id           boolean primary key default true check (id),
    activa       boolean not null default true,
    cupo_mensual integer not null default 100 check (cupo_mensual >= 0),
    cupo_texto   integer not null default 1000 check (cupo_texto >= 0)
);

insert into public.ia_ajustes (id) values (true) on conflict (id) do nothing;

alter table public.ia_ajustes enable row level security;

drop policy if exists "ia_ajustes: el estudio los lee" on public.ia_ajustes;
create policy "ia_ajustes: el estudio los lee" on public.ia_ajustes
    for select to authenticated
    using (public.es_miembro());

-- Sin política de insert, update ni delete a propósito: encender, apagar o
-- ampliar el cupo se hace desde el panel de Supabase, igual que dar de alta a
-- un miembro. Desde el navegador no se puede tocar.

-- ---------------------------------------------------------------------------
-- Uso: una fila por pedido al asistente
-- ---------------------------------------------------------------------------

create table if not exists public.ia_usos (
    id      bigint generated always as identity primary key,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    tipo    text not null check (tipo in ('texto', 'audio', 'foto')),
    creado  timestamptz not null default now()
);

create index if not exists ia_usos_creado_idx on public.ia_usos (creado);

alter table public.ia_usos enable row level security;

drop policy if exists "ia_usos: el estudio los ve" on public.ia_usos;
create policy "ia_usos: el estudio los ve" on public.ia_usos
    for select to authenticated
    using (public.es_miembro());

drop policy if exists "ia_usos: el estudio suma los suyos" on public.ia_usos;
create policy "ia_usos: el estudio suma los suyos" on public.ia_usos
    for insert to authenticated
    with check (public.es_miembro() and user_id = (select auth.uid()));

-- No hay update ni delete: el contador sólo sube. Y el permiso de insert es
-- por columna: desde afuera se puede mandar únicamente `tipo`. `user_id` y
-- `creado` los pone la base, así nadie anota un uso a nombre de otro ni con
-- fecha del mes pasado para que no cuente.
revoke insert, update, delete, truncate on public.ia_usos from authenticated, anon;
grant insert (tipo) on public.ia_usos to authenticated;

-- ---------------------------------------------------------------------------
-- Estado del asistente: una sola consulta para la función y para el panel
-- ---------------------------------------------------------------------------

-- Devuelve los ajustes y lo usado en el mes en curso. El mes se corta en hora
-- de Argentina: en UTC, lo cargado el 31 a las 22:00 caería en el mes
-- siguiente.
--
-- SECURITY INVOKER: corre con los permisos de quien llama, así que las
-- políticas de arriba se aplican. A quien no es del estudio le devuelve cero
-- filas, y la función del servidor usa eso mismo como control de acceso.
create or replace function public.ia_estado()
returns table (
    activa       boolean,
    cupo_mensual integer,
    cupo_texto   integer,
    cargas       integer,
    textos       integer
)
language sql
stable
security invoker
set search_path = ''
as $func$
    with mes as (
        select date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
               at time zone 'America/Argentina/Buenos_Aires' as desde
    )
    select
        a.activa,
        a.cupo_mensual,
        a.cupo_texto,
        (select count(*)::integer from public.ia_usos u, mes
          where u.creado >= mes.desde and u.tipo in ('audio', 'foto')),
        (select count(*)::integer from public.ia_usos u, mes
          where u.creado >= mes.desde and u.tipo = 'texto')
    from public.ia_ajustes a;
$func$;

revoke execute on function public.ia_estado() from public;
revoke execute on function public.ia_estado() from anon;
grant  execute on function public.ia_estado() to authenticated;

-- ---------------------------------------------------------------------------
-- Pedido con sus materiales, de una
-- ---------------------------------------------------------------------------

-- Cuando el asistente lee un remito, el pedido y sus renglones tienen que
-- guardarse juntos o no guardarse. Desde el navegador serían dos inserts
-- separados, y un corte de señal entre uno y otro dejaba un pedido vacío.
-- Dentro de una función es una sola transacción.
--
-- También SECURITY INVOKER: no saltea nada. Las políticas RLS y los CHECK de
-- las dos tablas siguen decidiendo qué entra.
create or replace function public.crear_pedido_con_items(p_pedido jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $func$
declare
    v_id uuid;
begin
    insert into public.pedidos (obra_id, proveedor, estado, fecha_pedido, entrega_estimada, notas)
    values (
        nullif(p_pedido ->> 'obra_id', '')::uuid,
        nullif(btrim(p_pedido ->> 'proveedor'), ''),
        coalesce(nullif(p_pedido ->> 'estado', ''), 'borrador'),
        nullif(p_pedido ->> 'fecha_pedido', '')::date,
        nullif(p_pedido ->> 'entrega_estimada', '')::date,
        nullif(btrim(p_pedido ->> 'notas'), '')
    )
    returning id into v_id;

    insert into public.pedido_items (pedido_id, material, cantidad, unidad, precio_unitario, moneda, orden)
    select
        v_id,
        btrim(i.valor ->> 'material'),
        coalesce(nullif(i.valor ->> 'cantidad', '')::numeric, 1),
        coalesce(nullif(btrim(i.valor ->> 'unidad'), ''), 'u'),
        nullif(i.valor ->> 'precio_unitario', '')::numeric,
        coalesce(nullif(i.valor ->> 'moneda', ''), 'ARS'),
        i.posicion::integer
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as i (valor, posicion);

    return v_id;
end;
$func$;

revoke execute on function public.crear_pedido_con_items(jsonb, jsonb) from public;
revoke execute on function public.crear_pedido_con_items(jsonb, jsonb) from anon;
grant  execute on function public.crear_pedido_con_items(jsonb, jsonb) to authenticated;
