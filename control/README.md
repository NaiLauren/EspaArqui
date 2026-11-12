# Panel de control — Espacio Arquitectura

Panel interno del estudio, servido como `/control` dentro del mismo sitio.
Tres pantallas: agenda semanal, pagos y pedidos de materiales.

## Cómo está armado

- **Sin build.** HTML, CSS y un módulo de JavaScript, igual que la web
  pública. Se despliega solo, junto con el resto del sitio.
- **Supabase** pone la base de datos y el login. El navegador le habla
  directo; no hay servidor propio en el medio.
- **La seguridad vive en la base**, no en el navegador. Las políticas RLS de
  `supabase/migrations/20261112000000_control_inicial.sql` deciden quién ve qué.
  Cualquier regla nueva va en SQL. El JavaScript del panel no protege nada y
  no debe intentar hacerlo: cualquiera puede leerlo y modificarlo.

## Puesta en marcha

### 1. Proyecto en Supabase — hecho

Proyecto **EspaArqui** (`mrmqwaotfhbfxqmnqmly`), región us-west-2.

### 2. Tablas y permisos — hecho

La migración `supabase/migrations/20261112000000_control_inicial.sql` ya corrió:
seis tablas, todas con RLS, seis políticas.

Si hubiera que rehacerla en otro proyecto: **SQL Editor → New query**, pegar el
archivo entero y ejecutar. Está escrita para poder correrse más de una vez sin
romper nada.

### 3. Crear el usuario del estudio — hecho

Hay un usuario (`espacioarquitectura@gmail.com`, Martín) creado y cargado en
`miembros`. Para sumar a alguien más, los pasos siguen siendo estos.

**Authentication → Users → Add user**, con mail y contraseña. Marcar
*Auto Confirm User* para no tener que confirmar por correo.

Después hay que sumarlo a la lista blanca, porque estar registrado no alcanza
para entrar. En el SQL Editor:

```sql
insert into public.miembros (user_id, email, nombre)
select id, email, 'Nombre del usuario'
from auth.users
where lower(email) = lower('ElMail@delestudio.com')
on conflict (user_id) do nothing;
```

> El `lower()` de los dos lados no sobra: Supabase guarda el mail siempre en
> minúsculas, así que comparar contra un mail escrito con mayúsculas no
> encuentra nada y el `insert` no agrega ninguna fila **sin dar error**. Queda
> la sensación de que el alta funcionó y después el panel rechaza al usuario.

Para dar de alta a alguien más, los mismos dos pasos. Para sacarle el acceso a
alguien, alcanza con borrar su fila de `miembros`.

### 4. Cerrar el registro público — pendiente

**Authentication → Providers → Email**, desactivar *Enable Sign Ups*.

No es imprescindible —la lista blanca ya frena a los desconocidos— pero evita
que se acumulen cuentas sueltas en el proyecto.

### 5. Conectar el panel — hecho

`control/config.js` ya tiene la URL del proyecto y la clave pública
(*publishable*). Ambos valores son públicos por diseño y van al repositorio sin
problema: lo que cada usuario puede ver lo deciden las políticas RLS, no la
clave.

La que **nunca** va acá es la clave `service_role`: saltea RLS y le daría
acceso total a cualquiera que mire el código de la página.

Si alguna vez hay que cambiarlos: **Project Settings → API**.

### 6. Desplegar — pendiente

Commit y push. Vercel publica el sitio y el panel queda en
`/control` del mismo dominio.

## Qué hace cada pantalla

**Agenda.** La semana de lunes a domingo. Reuniones y trabajos son la misma
tabla con dos campos que los distinguen: `tipo` separa reunión de trabajo, y
una `fecha` vacía es un trabajo pendiente todavía sin día. El panel de la
derecha junta lo que no tiene fecha y lo que ya venció. Clic en un hueco del
día para cargar algo en esa fecha; clic en una ficha para editarla.

**Pagos.** Registro interno: se anota lo que se cobró y lo que falta cobrar,
acá no se cobra nada. Los totales se calculan por moneda, porque sumar pesos
con dólares daría un número sin sentido. "Marcar pagado" pone el estado y la
fecha de hoy de una.

**Materiales.** Un pedido por proveedor, con su lista de materiales adentro.
Los ítems se tildan a medida que llegan y la ficha muestra cuántos faltan.

**Obras.** Es lo que ata a las otras tres: conviene cargar las obras primero.
Borrar una obra no borra su historial de pagos ni su agenda; esos registros
quedan sin obra asignada.

## Correrlo local

```bash
python -m http.server 8777
```

Y abrir `http://localhost:8777/control/`. Apunta a la misma base que
producción, así que lo que se cargue probando queda cargado de verdad.

## Qué no hace (todavía)

- **No cobra online.** Si en algún momento hace falta que el cliente pague
  desde un link, hay que sumar pasarela, webhooks y conciliación. El modelo de
  datos de `pagos` está armado para que eso se pueda enchufar sin rehacerlo.
- **No tiene acceso para clientes ni proveedores.** Hoy todos los que entran
  ven todo. Dar acceso parcial exige políticas RLS nuevas y una vista aparte.
- **No manda recordatorios.** Los vencimientos y los pendientes hay que ir a
  mirarlos.
