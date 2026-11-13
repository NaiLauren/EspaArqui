# Panel de control — Espacio Arquitectura

Panel de control personal del estudio, servido como `/control` dentro del mismo
sitio. Abre en "Hoy" y tiene agenda semanal, plata (cobros y gastos), pedidos a
proveedores y obras, más un asistente con IA que recibe texto, audio o foto.

El estado, lo verificado y lo que falta están en `PENDIENTES.md`.

## Cómo está armado

- **Sin build.** HTML, CSS y un módulo de JavaScript, igual que la web
  pública. Se despliega solo, junto con el resto del sitio.
- **Supabase** pone la base de datos y el login. El navegador le habla
  directo; no hay servidor propio en el medio. La única excepción es el
  asistente, que pasa por una Edge Function (`supabase/functions/asistente`)
  porque necesita una clave que no puede vivir en el navegador.
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

### 7. Asistente con IA

Hace falta la migración `20261113000000_asistente_ia.sql`, la función
`asistente` desplegada con `verify_jwt` apagado, y el secreto `GEMINI_API_KEY`
cargado en **Edge Functions → Secrets**. La clave no va nunca al repositorio.

Se enciende y se apaga desde la base (`update public.ia_ajustes set activa =
false;`). Apagado, la barra del asistente no aparece y el resto del panel
funciona igual.

## Qué hace cada pantalla

**Hoy.** La pantalla de inicio: lo agendado para hoy, lo pendiente (atrasado o
sin fecha), cuánto te deben y cuánto tenés que pagar, los pedidos por llegar y
lo que viene. El círculo de cada renglón lo da por hecho.

**Agenda.** La semana de lunes a domingo. Reuniones y tareas son la misma
tabla con dos campos que los distinguen: `tipo` separa reunión de tarea (en la
base, `trabajo`), y una `fecha` vacía es una tarea pendiente todavía sin día.
"Pendientes" junta lo que no tiene fecha y lo que ya venció. El "+" de cada día
carga algo en esa fecha; tocar un renglón lo abre para editarlo.

**Plata.** Registro interno: se anota lo que se cobró y lo que falta cobrar,
acá no se cobra nada. Los totales se calculan por moneda, porque sumar pesos
con dólares daría un número sin sentido. El círculo de cada movimiento lo marca
como cobrado o pagado con la fecha de hoy; otro toque lo deshace.

**Pedidos.** Un pedido por proveedor, con su lista de materiales adentro.
Los materiales se tildan a medida que llegan y la barra muestra el avance.

**Obras.** Opcionales: cualquier tarea, cobro, gasto o pedido puede ir sin
obra. Tocando una se ve todo lo suyo junto. Borrar una obra no borra su
historial; esos registros quedan sin obra asignada.

**Asistente.** La barra oscura de abajo. Entiende pedidos por texto o audio
("reunión con Rossi el martes a las 10") y lee fotos de facturas, tickets,
remitos y presupuestos. Muestra una tarjeta con lo que entendió y **no guarda
nada hasta que la persona toca el botón**. También contesta cómo se usa el
panel.

## Correrlo local

```bash
node --experimental-strip-types herramientas/prueba-local/servidor.mjs
```

Y abrir `http://localhost:8777/control`. Así corre con datos de ejemplo en
memoria y sin contraseña. Con `STUB=0` adelante apunta a la misma base que
producción, y lo que se cargue probando queda cargado de verdad. El detalle
está en `PENDIENTES.md`.

## Qué no hace (todavía)

- **No cobra online.** Si en algún momento hace falta que el cliente pague
  desde un link, hay que sumar pasarela, webhooks y conciliación. El modelo de
  datos de `pagos` está armado para que eso se pueda enchufar sin rehacerlo.
- **No tiene acceso para clientes ni proveedores.** Hoy todos los que entran
  ven todo. Dar acceso parcial exige políticas RLS nuevas y una vista aparte.
- **No manda recordatorios.** Los vencimientos y los pendientes hay que ir a
  mirarlos; "Hoy" los pone adelante, pero no avisa.
- **No anda sin señal.**
