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
- Las cuatro pantallas andan a 375px y en escritorio, con datos de prueba.

### Hecho pero NO verificado

Esto se escribió y quedó sin mirar en pantalla. **Revisarlo primero.**

1. **Materiales a 375px.** Se cambió el renglón de cada material para que el
   nombre ocupe el ancho y la cantidad con el precio bajen al renglón de
   abajo (`.item` en el media query de 760px). No se vio el resultado.
2. **Confirmación al quitar un material.** Se agregó un `confirm()`; no se
   probó que el texto salga bien ni que no se dispare de más.
3. **El aviso flotante arriba en el teléfono** (`.aviso { top: 5.5rem }`).
4. **El manifest.** No se probó agregar el panel a la pantalla de inicio en un
   teléfono real, ni en Android ni en iOS.
5. **Login real desde el navegador.** Nunca se hizo: hace falta la contraseña
   de Martín. Todo lo que está detrás del login sí está probado.

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

## Qué falta

### 1. Terminar la revisión en teléfono

Mirar los cinco puntos de "hecho pero no verificado". Después, recorrer a 375px
las cuatro pantallas creando, editando y borrando en cada una.

### 2. Cosas que molestan y no se llegaron a arreglar

- **Los días vacíos ocupan una tarjeta entera.** En la lista vertical del
  teléfono, un sábado sin nada hace scrollear igual que uno lleno. Convendría
  que el día sin eventos sea un renglón fino, o esconderlo con un "mostrar días
  vacíos".
- **No hay validación de horarios.** Se puede cargar una reunión que termina
  antes de empezar y se guarda sin chistar.
- **Un pago marcado "pagado" sin fecha de pago** no muestra ninguna fecha en la
  lista: queda el renglón a medias. O se exige la fecha al marcar pagado desde
  el formulario, o se muestra algo en su lugar.
- **No hay pantalla de una obra.** Hoy para saber cómo viene "Casa Mendoza" hay
  que mirar tres pantallas y filtrar a ojo. Una vista por obra con su agenda,
  sus pagos y sus pedidos juntos es, lejos, lo que más valor agrega y lo
  primero que va a pedir el cliente cuando lo use en serio.
- **No se puede buscar.** Sin buscador, con cincuenta pedidos cargados la
  pantalla de materiales se vuelve incómoda.
- **Los materiales asumen pesos.** `pedido_items` no tiene columna de moneda y
  el total se arma como ARS. Si el estudio cotiza aberturas en dólares, miente.
- **No anda sin señal.** En una obra sin datos el panel no abre. Resolverlo de
  verdad (service worker + cola de escrituras) es un proyecto aparte, no un
  ajuste; conviene decidirlo antes de prometerlo.

### 3. Antes de mostrárselo al cliente

La base tiene **datos de demostración** cargados a propósito: cuatro obras
(Casa Mendoza, Local Bahia Shoes, Oficinas Rossi, Reforma Guemes 1450), catorce
entradas de agenda, nueve pagos y tres pedidos. Sirven para que el panel no se
vea vacío en la demo.

Para dejarlo limpio antes del uso real, en el SQL Editor de Supabase:

```sql
truncate public.pedido_items, public.pedidos, public.pagos, public.agenda, public.obras restart identity cascade;
```

Eso borra todo salvo los usuarios y la lista de miembros. No se puede deshacer.

### 4. Desplegar

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
