# Panel /control — estado y qué falta

Documento de traspaso. Quien siga tiene que poder arrancar sin leer la
conversación donde salió esto.

## Qué es

Panel interno del estudio Espacio Arquitectura, servido como `/control` dentro
del mismo sitio estático. Tres pantallas: agenda semanal, pagos y pedidos de
materiales, más un ABM de obras que ata a las otras tres.

- **Sin paso de compilación.** HTML, CSS y un módulo de JavaScript que el
  navegador carga tal cual. No hay bundler ni `package.json`, y no conviene
  agregarlos sin un motivo fuerte.
- **Supabase** pone base de datos y login. El navegador le habla directo; no
  hay servidor propio.
- **La seguridad vive en la base.** Las políticas RLS deciden qué ve cada uno.
  `control/control.js` no protege nada y no debe intentarlo: cualquiera lo
  puede leer. Toda regla de acceso nueva va en SQL.
- Estar autenticado no alcanza: hay que figurar en la tabla `miembros`.

Archivos:

| Ruta | Qué es |
|---|---|
| `control/index.html` | Las cuatro pantallas y el modal |
| `control/control.js` | Toda la lógica |
| `control/control.css` | Estilos; la paleta sale de la web pública |
| `control/config.js` | URL y clave pública de Supabase (son públicas por diseño) |
| `control/manifest.webmanifest` + `control/iconos/` | Para sumarlo a la pantalla de inicio |
| `supabase/migrations/20261112000000_control_inicial.sql` | Tablas, índices y políticas |
| `supabase/migrations/20261112010000_pedido_items_moneda.sql` | Columna `moneda` (ARS/USD) en `pedido_items` |
| `control/README.md` | Puesta en marcha |

Proyecto Supabase: **EspaArqui**, ref `mrmqwaotfhbfxqmnqmly`, región us-west-2.
Usuario del estudio: `espacioarquitectura@gmail.com` (Martín), ya cargado en
`miembros`.

## Estado

Rama `claude/cliente-software-gestion-5d7fed`, PR
[#1](https://github.com/NaiLauren/EspaArqui/pull/1) abierto contra `main`, sin
mergear. **Producción todavía no tiene el panel**: Vercel despliega a producción
desde `main`.

### Verificado

- Esquema aplicado: seis tablas, todas con RLS, seis políticas.
- Un autenticado que no está en `miembros` ve cero filas y no puede insertar;
  un miembro lee y escribe en las tres pantallas. Probado con consultas que
  simulan cada rol y se revierten al terminar.
- `es_miembro()` no es ejecutable por `anon` (la dejaba expuesta en
  `/rest/v1/rpc/`; lo marcó el linter de Supabase).
- El login llega a Supabase: con un correo inexistente devuelve el mensaje de
  credenciales incorrectas, no un error de red.
- Login real probado desde el navegador con `espacioarquitectura@gmail.com`.
- Las cuatro pantallas andan a 375px y en escritorio, probadas con alta,
  edición y baja real contra Supabase:
  - Materiales a 375px con renglón apilado (nombre arriba, cantidad y precio
    abajo).
  - Confirmación `confirm()` al quitar un material del pedido.
  - Aviso flotante `.aviso` arriba (`top: 5.5rem`) en móvil.
  - Días vacíos compactos (`.dia-vacio`) en la vista vertical de agenda.
  - Validación de horarios (`hora_fin > hora_inicio`) en agenda.
  - Fecha de pago automática (`HOY`) al guardar un pago como pagado sin fecha,
    y texto de respaldo si no la tuviera.
  - Vista individual por obra ("Ver obra") con su resumen, totales, agenda,
    pagos y pedidos de materiales juntos, y alta rápida precargando la obra.
  - Buscador en vivo en pedidos de materiales (filtra por proveedor, obra,
    material o nota).
  - Soporte de moneda (ARS / USD) por ítem de material y totales separados por
    moneda en cada pedido.

### Pendiente de probar en dispositivo físico

1. **El manifest.** Agregar el panel a la pantalla de inicio en un teléfono real
   (Android e iOS) una vez desplegado en HTTPS.

## Cómo probarlo

Local, contra la base real:

```bash
python -m http.server 8777
```

y abrir `http://localhost:8777/control/`. Hace falta la contraseña del usuario.

**Sin la contraseña**, la forma de recorrer el panel es reemplazar supabase-js
por un doble. Se hace con un import map en una copia del HTML, sin tocar el
código de producción:

1. Copiar `index.html` a `_prueba.html`.
2. Antes de la etiqueta `<script type="module" src="/control/control.js">`,
   insertar:
   ```html
   <script type="importmap">
   {"imports":{"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm":"/control/_stub.js"}}
   </script>
   ```
3. Escribir `_stub.js` exportando `createClient()` con un `from()` encadenable
   (`select`, `eq`, `gte`, `lte`, `or`, `order`, `single`, `insert`, `update`,
   `delete`) que sea *thenable* y devuelva `{ data, error }`, y un `auth` con
   `onAuthStateChange`, `signInWithPassword` y `signOut`.
4. Borrar los dos archivos antes de commitear.

Conviene que el doble imite también los NOT NULL y los CHECK de la base: así se
ve cómo el panel muestra un error real.

### Trampa importante al probar

El servidor de python redirige `/control` a `/control/` antes de responder.
**Vercel no redirige**: sirve las dos formas. Probar sólo con la barra final
esconde los errores de ruta — ya pasó una vez y dejó la página en blanco en
producción. Probar siempre las dos:

```
http://localhost:8777/control
http://localhost:8777/control/
```

Para reproducir el comportamiento de Vercel, un servidor que devuelva el
`index.html` en `/control` sin redirigir.

### Otra trampa: capturas de teléfono

Chrome sin ventana (`--headless --window-size=390,...`) no baja de unos 500px
de ancho: la página se dibuja a 500 y la captura sale recortada a 390, como si
todo se desbordara a la derecha. No es un bug del panel. Para ver el ancho real
de un teléfono hay que emular el dispositivo por el protocolo de depuración
(`Emulation.setDeviceMetricsOverride`) o meter la página en un `<iframe>` de
390px.

### Qué hace cada toque en una ficha

Las fichas son tocables enteras y tienen botones adentro. El orden en que el
manejador de clics de `control.js` revisa los selectores es lo que decide qué
pasa; si se toca, volver a probar estos casos:

| Toque | Debe |
|---|---|
| "Marcar cobrado" en un pago | Registrar el pago, sin abrir el formulario |
| Resto de la ficha de pago | Abrir el formulario |
| Lápiz de un pedido (escritorio) | Abrir "Editar pedido", sin desplegar |
| Cabecera de un pedido | Desplegar los materiales |
| Círculo de una entrada de agenda | Marcarla hecha, sin abrir el formulario |
| Ficha de obra / su lápiz | Abrir la obra / abrir "Editar obra" |
| Botón flotante (teléfono) | Crear lo que corresponde a la pestaña actual |

## Qué falta

### 1. Uso sin señal (decisión a futuro)

- **No anda sin señal.** En una obra sin datos el panel no abre. Resolverlo de
  verdad (service worker + cola de escrituras) es un proyecto aparte, no un
  ajuste; conviene decidirlo antes de prometerlo.

### 2. Antes de mostrárselo al cliente

La base tiene **datos de demostración** cargados a propósito: cuatro obras
(Casa Mendoza, Local Bahia Shoes, Oficinas Rossi, Reforma Guemes 1450), catorce
entradas de agenda, nueve pagos y tres pedidos. Sirven para que el panel no se
vea vacío en la demo.

Para dejarlo limpio antes del uso real, en el SQL Editor de Supabase:

```sql
truncate public.pedido_items, public.pedidos, public.pagos, public.agenda, public.obras restart identity cascade;
```

Eso borra todo salvo los usuarios y la lista de miembros. No se puede deshacer.

### 3. Desplegar

Mergear el PR #1. Vercel despliega a producción solo y `/control` queda en el
dominio de siempre.

## Trampas del código

- **Las fechas no se parsean con `new Date("2026-11-12")`.** Eso es medianoche
  UTC, que en Argentina es el día anterior a las 21:00, y una reunión del lunes
  aparece el domingo. Hay `aFecha()` y `aISO()` para eso; usarlas siempre.
- **`map` pasa el índice como segundo argumento.** `lista.map(chipEvento)` hizo
  que del segundo evento de cada día en adelante se dibujaran como fichas de
  pendiente. Si una función de dibujo tiene un segundo parámetro, envolverla en
  un arrow.
- **Nada de rutas relativas en `index.html`.** Van absolutas (`/control/...`)
  por lo del párrafo sobre Vercel.
- **El `required` del navegador acepta espacios.** Un campo con sólo espacios
  pasa la validación, se recorta a vacío y la base lo rechaza. Por eso
  `guardarModal()` valida después de recortar.
- **No mostrar nunca el error crudo de Supabase.** Viene en inglés y hablando
  de columnas y restricciones. Pasa por `mensajeDeError()`; lo que no esté
  contemplado cae en un genérico y el detalle queda en la consola.
- **El callback de `onAuthStateChange` no puede llamar a la base de adentro.**
  supabase-js toma un lock mientras corre y la consulta queda esperando para
  siempre. Por eso hay un `setTimeout(..., 0)`.
- **Un campo vacío va como `null`, nunca como `""`.** Postgres rechaza `""` en
  columnas `date`, `time` y `uuid`.
- **La clave que está en `config.js` es pública por diseño.** La que nunca va
  ahí es la `service_role`: saltea RLS.
