# Panel /control — estado y qué falta

Documento de traspaso. Quien siga tiene que poder arrancar sin leer la
conversación donde salió esto. Actualizado el 2026-11-13.

## Qué es

Panel de control personal de Espacio Arquitectura, servido como `/control`
dentro del mismo sitio estático: https://espacio-arquitectura.vercel.app/control

El 2026-11-13 se replanteó. La primera versión estaba armada alrededor de las
obras y se leía como un sistema de gestión de obra; lo que el cliente pidió es
control personal. Ahora abre en **Hoy** (qué tengo hoy, qué está atrasado,
cuánto me deben, cuánto tengo que pagar, qué pedidos están por llegar) y las
obras son una etiqueta opcional, no el eje.

Cinco pantallas: **Hoy**, **Agenda**, **Plata** (antes "Pagos"), **Pedidos**
(antes "Materiales") y **Obras**. Más un **asistente con IA** que recibe texto,
audio o foto y propone qué cargar.

- **Sin paso de compilación.** HTML, CSS y módulos de JavaScript que el
  navegador carga tal cual. No hay bundler ni `package.json`, y no conviene
  agregarlos sin un motivo fuerte.
- **Supabase** pone base de datos y login. El navegador le habla directo.
- **La seguridad vive en la base.** Las políticas RLS deciden qué ve cada uno.
  El JavaScript del panel no protege nada y no debe intentarlo: cualquiera lo
  puede leer. Toda regla de acceso nueva va en SQL.
- Estar autenticado no alcanza: hay que figurar en la tabla `miembros`.
- **El repositorio es público.** Ninguna clave entra acá. Ver "Asistente".

Archivos:

| Ruta | Qué es |
|---|---|
| `control/index.html` | Las pantallas, la hoja del asistente y el modal |
| `control/control.js` | Sesión, navegación, las cinco pantallas y el modal |
| `control/asistente.js` | El asistente: conversación, tarjetas, foto y audio |
| `control/iconos.js` | Íconos SVG en línea |
| `control/control.css` | Estilos; se diseña primero para 375 px |
| `control/config.js` | URL y clave pública de Supabase (son públicas por diseño) |
| `supabase/migrations/` | Tres migraciones. No se editan: lo nuevo va en una nueva |
| `supabase/functions/asistente/` | La función del servidor que habla con Gemini |
| `herramientas/prueba-local/` | Servidor y doble de Supabase para probar sin contraseña. No se despliega (`.vercelignore`) |

Proyecto Supabase: **EspaArqui**, ref `mrmqwaotfhbfxqmnqmly`, región us-west-2.
Usuario del estudio: `espacioarquitectura@gmail.com` (Martín), ya cargado en
`miembros`.

## Asistente

El panel no puede guardar una clave de API: es JavaScript público en un repo
público. Por eso el asistente pasa por una **Edge Function de Supabase**,
`asistente`, que tiene la clave como secreto.

```
navegador  ──►  función `asistente`  ──►  Gemini
   ▲                  │
   └── propuesta ◄────┘        (la función no guarda nada del estudio)
   │
   └── la persona toca "Guardar"  ──►  insert con su sesión, bajo RLS
```

- **La IA propone, la persona confirma.** La función devuelve una propuesta
  validada; el panel la muestra como tarjeta. Recién al tocar "Guardar" o
  "Agendar" se escribe en la base, desde el navegador, con las mismas políticas
  RLS que cualquier alta. "Corregir" abre el formulario de siempre ya completo.
- **Las cuentas las hace el código.** El total de un pedido se suma en el
  panel a partir de los renglones.
- **La función no usa la clave de servicio.** Cada consulta a la base va con
  el token de quien llama. Comprueba la sesión contra Auth y después le
  pregunta a la base, con `ia_estado()`, si es del estudio, si el asistente
  está encendido y cuánto lleva usado.
- **Cupo:** 100 cargas por mes (audios y fotos), que es lo del presupuesto
  2026-37. Lo escrito no consume cargas; tiene un tope aparte de 1000. Desde el
  80 % el contador pasa a decir cuántas quedan.
- **Es un opcional pago.** Se enciende y se apaga desde la base, sin tocar
  código:
  ```sql
  update public.ia_ajustes set activa = false;      -- la barra desaparece
  update public.ia_ajustes set cupo_mensual = 200;  -- ampliar el cupo
  ```
- **Modelo:** `gemini-3.8-flash`, con `gemini-3.6-flash` y
  `gemini-3.5-flash-lite` de respaldo. El principal se cambia sin redesplegar
  con el secreto `GEMINI_MODEL`.
- **Secretos de la función** (Supabase → Edge Functions → Secrets):
  `GEMINI_API_KEY` obligatorio, `GEMINI_MODEL` opcional.
- **Desplegar la función:** con `verify_jwt` apagado (la verificación la hace
  el código). Si se cambia una pantalla o el nombre de un botón, hay que
  actualizar `MANUAL` en `nucleo.ts` y redesplegar: de ahí salen las respuestas
  sobre cómo se usa el panel.

## Estado

Rama `control-personal-ia`, PR abierto contra `main`. **Producción sigue con la
versión anterior** hasta que se mergee: Vercel despliega a producción desde
`main`.

Lo que ya está en producción y no depende del merge: la migración
`20261113000000_asistente_ia.sql` (aplicada) y la función `asistente`
(desplegada, versión 2). Son aditivas: el panel viejo no las usa.

### Verificado

- **Base.** La migración nueva probada con roles simulados y revertida: un
  miembro lee el estado y suma usos; no puede forzar la fecha de un uso, borrar
  usos ni cambiar el cupo. Un autenticado que no es miembro ve cero filas y no
  puede sumar usos ni crear pedidos. `anon` no puede ejecutar `ia_estado()`.
  `crear_pedido_con_items()` guarda pedido y renglones juntos, y si un renglón
  no pasa un CHECK no queda nada.
- **Función desplegada.** Sin sesión, con la clave pública como token o con un
  token inventado responde 401; el preflight de CORS responde 204.
- **Lectura con Gemini** (el núcleo de la función, corrido suelto con la clave
  real): una factura de corralón de ejemplo devuelve gasto con total, fecha de
  vencimiento y obra, y además el pedido con sus cuatro renglones; un audio en
  WAV agenda la reunión con día y hora correctos; "no, mejor a las 11 y media"
  corrige la propuesta anterior; las preguntas sobre el panel se contestan con
  el manual, y lo que no existe ("¿manda recordatorios?") dice que no.
- **Panel a 375 px**, con Chrome sin cabeza contra el doble de Supabase: las
  cinco pantallas, el modal y el asistente. Medido en cada una: sin desborde
  horizontal, ninguna zona táctil menor a 44 px y ningún texto por debajo de
  4,5:1. Flujos probados de punta a punta contra el doble: tildar una tarea,
  marcar un cobro, foto → elegir "como pedido" → quitar un renglón → guardar,
  texto → agendar, y "Corregir" → formulario → guardar.

### Sin verificar

1. **El asistente con una sesión real.** La función desplegada no se pudo
   probar autenticada: hace falta la contraseña del estudio. Es lo primero a
   probar después del merge (o en el preview de Vercel): mandar un texto, un
   audio y una foto, y guardar una propuesta.
2. **Grabar audio en un teléfono.** Chrome sin cabeza niega el micrófono. La
   conversión a WAV y el envío están escritos pero no corrieron en un
   dispositivo real, ni en Android ni en iPhone.
3. **El panel nuevo contra la base real.** Se probó contra el doble. Las
   consultas son las mismas de la versión anterior más cuatro nuevas en "Hoy".
4. **El manifest** en un teléfono real (Android e iOS), como antes.

### Antes de mostrárselo al cliente

- **La clave de Gemini es de plan gratuito.** Límite de 5 pedidos por minuto
  por modelo, y el 2026-11-13 `gemini-3.8-flash` no respondió en 6 de 6
  intentos (503 o sin respuesta); `gemini-3.6-flash` respondió en 2 a 6
  segundos cuando no estaba saturado. Con el respaldo funciona igual, pero una
  lectura puede tardar 15 a 40 segundos. Conviene activar la facturación en el
  proyecto de Google de esa clave antes de la demo. Además, en el plan gratuito
  de la API de Gemini Google puede usar lo enviado para mejorar sus productos:
  no es donde tienen que ir las facturas de un cliente.
- La base tiene **datos de demostración** (cuatro obras, catorce entradas de
  agenda, nueve pagos y tres pedidos). Para dejarla limpia antes del uso real:
  ```sql
  truncate public.pedido_items, public.pedidos, public.pagos, public.agenda, public.obras restart identity cascade;
  ```
  No se puede deshacer. No toca usuarios, miembros ni el contador del asistente.

## Cómo probarlo

**Sin contraseña**, con datos de ejemplo en memoria y el asistente de verdad:

```bash
node --experimental-strip-types herramientas/prueba-local/servidor.mjs
```

y abrir `http://localhost:8777/control`. El asistente usa el mismo núcleo que
la función desplegada, con la clave de `GEMINI_API_KEY` o del archivo
`geminiapikey.nosubir.txt` (ignorado por git; el servidor se niega a servirlo).

**Contra la base real** (hace falta la contraseña; lo que se cargue queda):

```bash
STUB=0 node --experimental-strip-types herramientas/prueba-local/servidor.mjs
```

### Trampa importante al probar

`python -m http.server` redirige `/control` a `/control/` antes de responder.
**Vercel no redirige**: sirve las dos formas. Probar sólo con la barra final
esconde los errores de ruta — ya pasó una vez y dejó la página en blanco en
producción. El servidor de `herramientas/` responde las dos sin redirigir, que
es lo que hace Vercel. Probar siempre:

```
http://localhost:8777/control
http://localhost:8777/control/
```

## Qué falta

- **Uso sin señal.** En una obra sin datos el panel no abre. Resolverlo de
  verdad (service worker + cola de escrituras) es un proyecto aparte, no un
  ajuste; conviene decidirlo antes de prometerlo.
- **El asistente no ve los datos cargados.** Contesta cómo se usa el panel y
  carga cosas nuevas; no sabe "qué tengo mañana". Si se quiere, hay que pasarle
  un resumen de la agenda y decidir qué sale de la base hacia el modelo.
- **El asistente no edita ni borra.** Sólo propone altas.
- **Las fotos no se guardan.** Se leen y se descartan. Guardarlas es "adjuntos
  en cada obra", que el presupuesto cotiza aparte.

## Trampas del código

- **Las fechas no se parsean con `new Date("2026-11-12")`.** Eso es medianoche
  UTC, que en Argentina es el día anterior a las 21:00, y una reunión del lunes
  aparece el domingo. Hay `aFecha()` y `aISO()` para eso; usarlas siempre.
- **"Hoy" es `hoyISO()`, una función, no una constante.** El panel queda
  abierto días en el teléfono; con una constante seguiría en el día en que se
  abrió.
- **`map` pasa el índice como segundo argumento.** `lista.map(filaAgenda)`
  haría que la fila tome el índice por sus opciones. Envolver en un arrow.
- **Nada de rutas relativas en `index.html`.** Van absolutas (`/control/...`)
  por lo del párrafo sobre Vercel.
- **Nada de enlaces `#ancla` adentro del panel.** El hash de la dirección lo
  usa la navegación entre pantallas; para bajar a una sección se usa
  `data-bajar`.
- **El `required` del navegador acepta espacios.** Un campo con sólo espacios
  pasa la validación, se recorta a vacío y la base lo rechaza. Por eso
  `guardarModal()` valida después de recortar.
- **No mostrar nunca el error crudo de Supabase.** Viene en inglés y hablando
  de columnas y restricciones. Pasa por `mensajeDeError()`.
- **El callback de `onAuthStateChange` no puede llamar a la base de adentro.**
  supabase-js toma un lock mientras corre y la consulta queda esperando para
  siempre. Por eso hay un `setTimeout(..., 0)`.
- **Un campo vacío va como `null`, nunca como `""`.** Postgres rechaza `""` en
  columnas `date`, `time` y `uuid`.
- **En el esquema de salida de Gemini, los objetos van como obligatorios**
  aunque puedan ser `null`. Como opcionales, el modelo contestaba "es un pago"
  y no devolvía el pago.
- **La clave que está en `config.js` es pública por diseño.** Las que nunca van
  al repo son la `service_role` (saltea RLS) y la de Gemini.
