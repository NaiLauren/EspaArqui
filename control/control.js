// Panel de control de Espacio Arquitectura.
//
// Sin paso de compilación, igual que la web pública: el navegador carga este
// módulo tal cual está en el repositorio.
//
// El navegador habla directo con Supabase; no hay servidor propio en el
// medio. Eso es seguro únicamente porque las políticas RLS de la base deciden
// qué puede ver cada usuario: este archivo no protege nada y no debe intentar
// hacerlo. Cualquier regla de acceso nueva va en SQL, no acá.
//
// La única pieza que sí corre en un servidor es el asistente (ver
// asistente.js y supabase/functions/asistente): necesita una clave que no
// puede vivir en el navegador.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { ico, completarIconos } from "./iconos.js";
import { iniciarAsistente, cerrarAsistente } from "./asistente.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

completarIconos();

// Si todavía no se cargaron las credenciales, mostramos la pantalla que
// explica qué falta en vez de reventar con un error de consola que el cliente
// no sabría leer.
if (!SUPABASE_URL || !SUPABASE_KEY) {
    $("#pantalla-config").hidden = false;
    throw new Error("Faltan las credenciales de Supabase en control/config.js");
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

// Postgres devuelve las fechas como "2026-11-12". `new Date("2026-11-12")` las
// interpreta como medianoche UTC, que en Argentina (UTC-3) es el día
// anterior a las 21:00: una reunión del lunes aparecería el domingo. Por eso
// armamos la fecha a mano con los tres números y nunca le pasamos la cadena
// al constructor.
function aFecha(iso) {
    const [a, m, d] = iso.split("-").map(Number);
    return new Date(a, m - 1, d);
}

// El camino de vuelta tiene la misma trampa: toISOString() pasa a UTC y
// adelanta o atrasa el día. Armamos la cadena con los getters locales.
function aISO(fecha) {
    const mes = String(fecha.getMonth() + 1).padStart(2, "0");
    const dia = String(fecha.getDate()).padStart(2, "0");
    return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function lunesDe(fecha) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    // getDay() cuenta desde el domingo; este corrimiento mueve el origen al
    // lunes, que es como se mira la semana.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
}

function sumarDias(fecha, dias) {
    const d = new Date(fecha);
    d.setDate(d.getDate() + dias);
    return d;
}

// "Hoy" se calcula cada vez y no una sola vez al cargar: el panel queda
// abierto días enteros en la pantalla de inicio del teléfono, y con una
// constante el miércoles seguiría creyendo que es lunes.
function hoyISO() {
    return aISO(new Date());
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const nombreDia = (fecha) => DIAS[(fecha.getDay() + 6) % 7];

function fechaCorta(iso) {
    if (!iso) return "";
    const f = aFecha(iso);
    return `${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)}`;
}

function fechaLarga(iso) {
    const f = aFecha(iso);
    return `${nombreDia(f)} ${f.getDate()} de ${MESES[f.getMonth()]}`;
}

// Cómo se nombra un día cuando está cerca: "hoy", "mañana", "lun 16". Más
// lejos que una semana ya no ayuda el día de la semana y va "20 nov".
function diaCercano(iso) {
    const hoy = aFecha(hoyISO());
    const dias = Math.round((aFecha(iso) - hoy) / 86400000);
    if (dias === 0) return "hoy";
    if (dias === 1) return "mañana";
    if (dias === -1) return "ayer";
    if (dias > 1 && dias < 7) return `${nombreDia(aFecha(iso)).slice(0, 3).toLowerCase()} ${aFecha(iso).getDate()}`;
    return fechaCorta(iso);
}

const conArticulo = (dia) => (["hoy", "mañana", "ayer"].includes(dia) ? dia : "el " + dia);
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function plata(monto, moneda) {
    const n = Number(monto) || 0;
    const simbolo = moneda === "USD" ? "US$" : "$";
    return simbolo + " " + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// Todo lo que viene de la base se escapa antes de entrar al HTML. Lo carga
// sólo el estudio, así que no es defensa contra un atacante: es que un
// presupuesto titulado 'Reforma "Centro"' no rompa la página.
function esc(texto) {
    if (texto === null || texto === undefined) return "";
    return String(texto)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const estado = {
    vista: "hoy",
    lunes: lunesDe(new Date()),
    obras: [],
    obraActiva: null,
    filtroPagos: "todos",
    busquedaPedidos: "",
    // Qué pedidos están desplegados. Se guarda acá y no en el DOM para que al
    // redibujar la lista (por ejemplo tras tildar un material) los pedidos
    // abiertos no se cierren solos.
    pedidosAbiertos: new Set(),
};

function aviso(texto, mal = false) {
    const el = $("#aviso");
    el.textContent = texto;
    el.classList.toggle("mal", mal);
    el.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { el.hidden = true; }, 2800);
}

// Cómo se llama cada columna cuando hay que nombrarla en un mensaje.
const NOMBRES = {
    titulo: "el título", concepto: "el concepto", nombre: "el nombre",
    material: "el material", monto: "el monto", cantidad: "la cantidad",
    tipo: "el tipo", estado: "el estado", moneda: "la moneda",
    fecha: "la fecha", vence: "el vencimiento", proveedor: "el proveedor",
};

// Postgres contesta en inglés y hablando de columnas y restricciones. Eso no
// se le muestra a nadie: acá se traduce a algo que diga qué hacer. Lo que no
// esté contemplado cae en un mensaje genérico, y el detalle técnico queda en
// la consola para poder diagnosticarlo.
function mensajeDeError(error) {
    const texto = error && error.message ? error.message : "";

    const faltante = texto.match(/null value in column "(\w+)"/);
    if (faltante) return `Falta completar ${NOMBRES[faltante[1]] || faltante[1]}.`;

    const invalido = texto.match(/violates check constraint "\w+?_(\w+)_check"/);
    if (invalido) return `Ese valor no sirve para ${NOMBRES[invalido[1]] || invalido[1]}.`;

    if (/numeric field overflow/i.test(texto)) return "Ese número es demasiado grande.";
    if (/invalid input syntax for type date/i.test(texto)) return "Esa fecha no es válida.";
    if (/invalid input syntax for type time/i.test(texto)) return "Esa hora no es válida.";
    if (/duplicate key/i.test(texto)) return "Ya existe un registro igual.";
    if (/Failed to fetch|NetworkError/i.test(texto)) return "Sin conexión. Fijate la señal y probá de nuevo.";

    return "No se pudo guardar. Probá de nuevo.";
}

// Un único lugar donde se mira el error de Supabase, así ninguna pantalla se
// queda en blanco sin decir por qué.
function fallo(error, contexto) {
    console.error(contexto, error);
    aviso(`No se pudo ${contexto}. ${mensajeDeError(error)}`, true);
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

$("#form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const boton = $("#btn-entrar");
    const err = $("#login-error");
    err.hidden = true;
    boton.disabled = true;
    boton.textContent = "Entrando...";

    const { error } = await db.auth.signInWithPassword({
        email: $("#login-email").value.trim(),
        password: $("#login-pass").value,
    });

    boton.disabled = false;
    boton.textContent = "Entrar";

    if (error) {
        err.textContent = error.message === "Invalid login credentials"
            ? "Correo o contraseña incorrectos."
            : error.message;
        err.hidden = false;
    }
    // Si salió bien no hacemos nada: onAuthStateChange se encarga de abrir el
    // panel, y así el mismo camino sirve para el login y para la sesión que
    // ya venía guardada.
});

$("#btn-salir").addEventListener("click", () => db.auth.signOut());

// Marca si el panel ya está armado, para que un refresco de token (que
// dispara este mismo evento cada hora) no vuelva a cargar todo y mande al
// usuario de vuelta al inicio mientras mira otra cosa.
let panelArmado = false;

db.auth.onAuthStateChange((_evento, sesion) => {
    if (!sesion) {
        panelArmado = false;
        mostrarLogin();
        return;
    }
    if (panelArmado) return;
    panelArmado = true;

    // El setTimeout no es cosmético: supabase-js toma un lock interno
    // mientras corre este callback, y llamar a la base desde adentro puede
    // quedarse esperando para siempre. Salir del callback antes de consultar
    // evita ese bloqueo.
    setTimeout(() => entrar(sesion), 0);
});

function mostrarLogin() {
    cerrarAsistente();
    $("#app").hidden = true;
    $("#pantalla-login").hidden = false;
    $("#login-pass").value = "";
}

async function entrar(sesion) {
    // Estar autenticado no alcanza: hay que figurar en `miembros`. Si no está,
    // las políticas RLS devolverían listas vacías en todas las pantallas y
    // parecería que el panel está roto. Mejor decirlo de frente.
    const { data, error } = await db.from("miembros").select("user_id").limit(1);

    if (error || !data || data.length === 0) {
        panelArmado = false;
        await db.auth.signOut();
        const err = $("#login-error");
        err.textContent = "Ese usuario no está habilitado para el panel.";
        err.hidden = false;
        return;
    }

    $("#pantalla-login").hidden = true;
    $("#app").hidden = false;
    $("#usuario").textContent = sesion.user.email;

    await cargarObras();
    irA(location.hash.replace("#", "") || "hoy");

    // El asistente se enciende aparte y sin esperarlo: si no está contratado
    // o la consulta falla, el panel funciona igual, sólo que sin la barra.
    iniciarAsistente({
        db, esc, plata, fechaLarga, hoyISO, mensajeDeError, abrirModal, irA,
        nombreObra,
        refrescar: () => VISTAS[estado.vista](),
    });
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

const VISTAS = { hoy: pintarHoy, agenda: pintarAgenda, pagos: pintarPagos, pedidos: pintarPedidos, obras: pintarObras };

// Nombres que tuvieron estas pantallas: quien tenga guardado un enlace viejo
// cae en la que corresponde en vez de en el inicio.
const ALIAS = { plata: "pagos", materiales: "pedidos" };

let ultimoPintado = 0;

function irA(vista) {
    vista = ALIAS[vista] || vista;
    if (!VISTAS[vista]) vista = "hoy";
    // Cambiar de pantalla con un formulario abierto (por ejemplo con el botón
    // Atrás del navegador) dejaba el modal flotando sobre la vista nueva.
    if (modalActual) cerrarModal();
    const cambio = vista !== estado.vista;
    estado.vista = vista;
    location.hash = vista;

    $$(".vista").forEach((v) => { v.hidden = true; });
    $(`#vista-${vista}`).hidden = false;
    $$(".nav-item").forEach((b) => b.classList.toggle("activo", b.dataset.vista === vista));
    $("#btn-obras").classList.toggle("activo", vista === "obras");
    if (cambio) window.scrollTo(0, 0);

    ultimoPintado = Date.now();
    VISTAS[vista]();
}

$("#nav").addEventListener("click", (ev) => {
    const boton = ev.target.closest(".nav-item");
    if (boton) irA(boton.dataset.vista);
});

// Cualquier cosa con data-ir lleva a una pantalla, esté donde esté: en la
// barra, en el inicio o adentro del asistente.
document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-ir]");
    if (!el) return;
    const d = el.dataset;
    if (d.ir === "obras") estado.obraActiva = d.obra || null;
    if (d.ir === "pagos" && d.filtro) fijarFiltroPagos(d.filtro);
    if (d.ir === "pedidos" && d.pedido) estado.pedidosAbiertos.add(d.pedido);
    if (d.ir === "agenda" && d.fecha) estado.lunes = lunesDe(aFecha(d.fecha));
    cerrarAsistente();
    irA(d.ir);
    if (d.obra) window.scrollTo(0, 0);
});

window.addEventListener("hashchange", () => {
    const vista = location.hash.replace("#", "");
    if (vista && (ALIAS[vista] || vista) !== estado.vista) irA(vista);
});

// Al volver al panel después de un rato (el teléfono estuvo bloqueado, o era
// otro día) se vuelve a pedir lo que se está mirando. Si hay algo abierto no
// se toca: redibujar por debajo de un formulario a medio llenar molesta.
document.addEventListener("visibilitychange", () => {
    if (document.hidden || $("#app").hidden || modalActual || !$("#asis-fondo").hidden) return;
    if (Date.now() - ultimoPintado < 60000) return;
    ultimoPintado = Date.now();
    VISTAS[estado.vista]();
});

$("#obra-volver").addEventListener("click", () => {
    estado.obraActiva = null;
    pintarObras();
});

// ---------------------------------------------------------------------------
// Piezas que se repiten en todas las pantallas
// ---------------------------------------------------------------------------

async function cargarObras() {
    const { data, error } = await db.from("obras").select("*").order("nombre");
    if (error) return fallo(error, "cargar las obras");
    estado.obras = data;
}

function nombreObra(id) {
    const o = estado.obras.find((x) => x.id === id);
    return o ? o.nombre : "";
}

// Una tarea o reunión: el círculo la da por hecha y el texto la abre. Son dos
// botones y no uno porque un <button> no puede contener otro.
function filaAgenda(e, { conFecha = false, conObra = true } = {}) {
    const hecho = e.estado === "hecho";
    const atrasado = e.estado === "pendiente" && e.fecha && e.fecha < hoyISO();
    const hora = e.hora_inicio
        ? e.hora_inicio.slice(0, 5) + (e.hora_fin ? "–" + e.hora_fin.slice(0, 5) : "")
        : "";

    let cuando = "";
    if (conFecha) {
        if (!e.fecha) cuando = "Sin fecha";
        else if (atrasado) cuando = "Era para " + conArticulo(diaCercano(e.fecha));
        else cuando = mayuscula(diaCercano(e.fecha));
    }

    // Si el lugar es la obra misma ("Oficinas Rossi" en la obra Oficinas
    // Rossi) se dice una sola vez.
    const obra = conObra ? nombreObra(e.obra_id) : "";
    const resto = [hora, e.lugar, obra === e.lugar ? "" : obra].filter(Boolean).join(" · ");
    const sub = [
        cuando ? `<span class="cuando">${esc(cuando)}</span>` : "",
        esc(resto),
    ].filter(Boolean).join(" · ");

    return `
        <div class="fila ${e.tipo} ${e.estado} ${atrasado ? "atrasado" : ""}">
            ${e.estado === "cancelado" ? `<span class="tilde-hueco"></span>` : `
            <button class="tilde" data-hecho="${e.id}" data-estado="${e.estado}" aria-pressed="${hecho}"
                    aria-label="${hecho ? "Volver a pendiente" : "Dar por hecho"}: ${esc(e.titulo)}">${ico("tilde")}</button>`}
            <button class="fila-cuerpo" data-editar="agenda" data-id="${e.id}">
                <span class="fila-titulo">${esc(e.titulo)}</span>
                ${sub ? `<span class="fila-sub">${sub}</span>` : ""}
            </button>
            ${e.tipo === "reunion" ? `<span class="fila-marca" title="Reunión">${ico("personas")}</span>` : ""}
        </div>`;
}

// Un cobro o un gasto. El signo y el color dicen para qué lado va la plata;
// antes lo decían dos etiquetas por renglón.
function filaPago(p, conObra = true) {
    const pagado = p.estado === "pagado";
    const cobro = p.tipo === "cobro";
    const vencido = !pagado && p.vence && p.vence < hoyISO();

    let cuando;
    if (pagado) cuando = (cobro ? "Cobrado" : "Pagado") + (p.fecha_pago ? " el " + fechaCorta(p.fecha_pago) : "");
    else if (vencido) cuando = "Venció " + conArticulo(diaCercano(p.vence));
    else cuando = p.vence ? "Vence " + conArticulo(diaCercano(p.vence)) : "Sin vencimiento";

    // Primero el cuándo, que es lo que se busca al mirar la lista; la obra y
    // el medio de pago van después.
    const sub = [
        `<span class="cuando">${esc(cuando)}</span>`,
        esc(conObra ? nombreObra(p.obra_id) : ""),
        esc(p.metodo),
    ].filter(Boolean).join(" · ");

    const accion = pagado ? "Volver a pendiente" : (cobro ? "Marcar como cobrado" : "Marcar como pagado");

    return `
        <div class="fila pago ${p.tipo} ${p.estado} ${vencido ? "atrasado" : ""}">
            <button class="tilde" data-pagar="${p.id}" data-estado="${p.estado}" aria-pressed="${pagado}"
                    aria-label="${accion}: ${esc(p.concepto)}">${ico("tilde")}</button>
            <button class="fila-cuerpo" data-editar="pago" data-id="${p.id}">
                <span class="fila-titulo">${esc(p.concepto)}</span>
                <span class="fila-sub">${sub}</span>
            </button>
            <span class="monto ${p.tipo}">${cobro ? "+" : "−"} ${plata(p.monto, p.moneda)}</span>
        </div>`;
}

const lista = (filas) => `<div class="lista">${filas.join("")}</div>`;

// Los totales se acumulan por moneda. Sumar pesos con dólares daría un número
// que no significa nada, así que cada tarjeta muestra una línea por moneda y
// sólo si tiene algo.
function sumar(pagos) {
    const t = { ARS: 0, USD: 0 };
    for (const p of pagos) t[p.moneda === "USD" ? "USD" : "ARS"] += Number(p.monto) || 0;
    return t;
}

function lineasPlata(valores) {
    const lineas = ["ARS", "USD"].filter((m) => valores[m] > 0).map((m) => plata(valores[m], m));
    return lineas.length ? lineas : [plata(0, "ARS")];
}

function tarjetaTotal(etiqueta, valores, { clase = "", pie = "", ir = "" } = {}) {
    // El color es para cuando hay plata: un "$ 0" en rojo asusta sin motivo.
    if (!valores.ARS && !valores.USD) clase = "";
    const adentro = `
        <span class="total-etiqueta">${etiqueta}</span>
        ${lineasPlata(valores).map((l) => `<span class="total-valor">${l}</span>`).join("")}
        ${pie ? `<span class="total-pie">${pie}</span>` : ""}`;
    return ir
        ? `<button class="total ${clase}" ${ir}>${adentro}</button>`
        : `<div class="total ${clase}">${adentro}</div>`;
}

function resumenPagos(pagos) {
    const hoy = hoyISO();
    const mes = hoy.slice(0, 7);
    const pendientes = pagos.filter((p) => p.estado === "pendiente");
    const cobrar = pendientes.filter((p) => p.tipo === "cobro");
    const pagar = pendientes.filter((p) => p.tipo === "gasto");
    return {
        cobrar,
        pagar,
        cobrarVencido: cobrar.filter((p) => p.vence && p.vence < hoy),
        pagarVencido: pagar.filter((p) => p.vence && p.vence < hoy),
        cobradoMes: pagos.filter((p) => p.estado === "pagado" && p.tipo === "cobro" && (p.fecha_pago || "").startsWith(mes)),
    };
}

function progresoPedido(p) {
    const items = p.pedido_items || [];
    const llegaron = items.filter((i) => i.recibido).length;
    return { items, llegaron, total: items.length, pct: items.length ? Math.round((llegaron / items.length) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Hoy
// ---------------------------------------------------------------------------

async function pintarHoy() {
    const hoy = hoyISO();
    const [delDia, pend, viene, pagosRes, pedidosRes] = await Promise.all([
        db.from("agenda").select("*").eq("fecha", hoy).order("hora_inicio", { nullsFirst: false }),
        db.from("agenda").select("*").eq("estado", "pendiente")
            .or(`fecha.is.null,fecha.lt.${hoy}`).order("fecha", { nullsFirst: false }),
        db.from("agenda").select("*").eq("estado", "pendiente").gt("fecha", hoy)
            .order("fecha").order("hora_inicio", { nullsFirst: false }).limit(4),
        db.from("pagos").select("*").eq("estado", "pendiente"),
        db.from("pedidos").select("*, pedido_items(*)").eq("estado", "pedido").order("entrega_estimada", { nullsFirst: false }),
    ]);

    for (const r of [delDia, pend, viene, pagosRes, pedidosRes]) {
        if (r.error) return fallo(r.error, "cargar el inicio");
    }

    const eventos = delDia.data.filter((e) => e.estado !== "cancelado");
    const faltan = eventos.filter((e) => e.estado === "pendiente").length;
    const atrasadas = pend.data.filter((e) => e.fecha).length;
    const sinFecha = pend.data.length - atrasadas;

    let titular;
    if (eventos.length === 0) titular = "Hoy no tenés nada agendado";
    else if (faltan === 0) titular = "Listo por hoy";
    else titular = `Hoy tenés ${faltan} ${faltan === 1 ? "cosa" : "cosas"}`;

    const r = resumenPagos(pagosRes.data);
    const semana = aISO(sumarDias(aFecha(hoy), 7));
    const pagarPronto = r.pagar.filter((p) => p.vence && p.vence >= hoy && p.vence <= semana).length;

    const pieCobrar = r.cobrarVencido.length
        ? `<span class="rojo">${r.cobrarVencido.length} ${r.cobrarVencido.length === 1 ? "vencido" : "vencidos"}</span>`
        : (r.cobrar.length ? "al día" : "nada pendiente");
    const piePagar = r.pagarVencido.length
        ? `<span class="rojo">${r.pagarVencido.length} ${r.pagarVencido.length === 1 ? "vencido" : "vencidos"}</span>`
        : (pagarPronto ? `${pagarPronto} ${pagarPronto === 1 ? "vence" : "vencen"} esta semana` : (r.pagar.length ? "sin apuro" : "nada pendiente"));

    const pendientes = pend.data.slice(0, 5);
    const obrasActivas = estado.obras.filter((o) => o.estado === "activa");

    $("#vista-hoy").innerHTML = `
        <div class="hoy-hero">
            <p class="hoy-fecha">${esc(fechaLarga(hoy))}</p>
            <h1 class="hoy-titular">${titular}</h1>
            ${atrasadas ? `
            <button class="hoy-alerta" data-bajar="pendientes-hoy">${ico("alerta")} ${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"}</button>` : ""}
        </div>

        <section class="bloque">
            <div class="bloque-cabecera">
                <h2>Hoy</h2>
                <button class="btn btn-suave" data-nuevo-dia="${hoy}">+ Agregar</button>
            </div>
            ${eventos.length
                ? lista(eventos.map((e) => filaAgenda(e)))
                : `<p class="vacio">Día libre. Si surge algo, decíselo al asistente o tocá "+ Agregar".</p>`}
        </section>

        ${pendientes.length ? `
        <section class="bloque" id="pendientes-hoy">
            <div class="bloque-cabecera">
                <h2>Pendientes</h2>
                <span class="bloque-nota">${[atrasadas ? `${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"}` : "", sinFecha ? `${sinFecha} sin fecha` : ""].filter(Boolean).join(" · ")}</span>
            </div>
            ${lista(pendientes.map((e) => filaAgenda(e, { conFecha: true })))}
            ${pend.data.length > pendientes.length ? `<button class="ver-mas" data-ir="agenda">Ver los ${pend.data.length} en Agenda</button>` : ""}
        </section>` : ""}

        <section class="bloque">
            <div class="totales dos">
                ${tarjetaTotal("Te deben", sumar(r.cobrar), { clase: "verde", pie: pieCobrar, ir: `data-ir="pagos" data-filtro="pendiente"` })}
                ${tarjetaTotal("Tenés que pagar", sumar(r.pagar), { pie: piePagar, ir: `data-ir="pagos" data-filtro="pendiente"` })}
            </div>
        </section>

        ${pedidosRes.data.length ? `
        <section class="bloque">
            <div class="bloque-cabecera"><h2>Por llegar</h2></div>
            <div class="lista">
                ${pedidosRes.data.map((p) => {
                    const g = progresoPedido(p);
                    return `
                    <button class="fila fila-entera" data-ir="pedidos" data-pedido="${p.id}">
                        <span class="fila-icono">${ico("camion")}</span>
                        <span class="fila-cuerpo">
                            <span class="fila-titulo">${esc(p.proveedor || "Sin proveedor")}</span>
                            <span class="fila-sub">${g.total ? `Llegaron ${g.llegaron} de ${g.total}` : "Sin materiales cargados"}${p.entrega_estimada ? " · entrega " + esc(diaCercano(p.entrega_estimada)) : ""}</span>
                        </span>
                        <span class="progreso" aria-hidden="true"><span style="width:${g.pct}%"></span></span>
                    </button>`;
                }).join("")}
            </div>
        </section>` : ""}

        ${viene.data.length ? `
        <section class="bloque">
            <div class="bloque-cabecera">
                <h2>Lo que viene</h2>
                <button class="btn btn-suave" data-ir="agenda">Ver agenda</button>
            </div>
            ${lista(viene.data.map((e) => filaAgenda(e, { conFecha: true })))}
        </section>` : ""}

        ${obrasActivas.length ? `
        <section class="bloque">
            <div class="bloque-cabecera"><h2>Obras</h2></div>
            <div class="chips-obras">
                ${obrasActivas.map((o) => `<button class="chip" data-ir="obras" data-obra="${o.id}">${esc(o.nombre)}</button>`).join("")}
                <button class="chip chip-linea" data-ir="obras">Todas</button>
            </div>
        </section>` : ""}`;
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

$("#semana-ant").addEventListener("click", () => { estado.lunes = sumarDias(estado.lunes, -7); pintarAgenda(); });
$("#semana-sig").addEventListener("click", () => { estado.lunes = sumarDias(estado.lunes, 7); pintarAgenda(); });
$("#semana-hoy").addEventListener("click", () => { estado.lunes = lunesDe(new Date()); pintarAgenda(); });

async function pintarAgenda() {
    const lunes = estado.lunes;
    const domingo = sumarDias(lunes, 6);
    const hoy = hoyISO();

    $("#semana-titulo").textContent = lunes.getMonth() === domingo.getMonth()
        ? `${lunes.getDate()} al ${domingo.getDate()} de ${MESES[lunes.getMonth()]}`
        : `${lunes.getDate()} ${MESES[lunes.getMonth()].slice(0, 3)} al ${domingo.getDate()} ${MESES[domingo.getMonth()].slice(0, 3)}`;

    // Dos consultas en paralelo: la semana que se está mirando y la bandeja de
    // pendientes, que no depende de la semana.
    const [semana, pendientes] = await Promise.all([
        db.from("agenda").select("*")
            .gte("fecha", aISO(lunes)).lte("fecha", aISO(domingo))
            // Las que tienen hora van primero y en orden; las tareas sueltas
            // del día quedan al final, que es como se lee una jornada.
            .order("hora_inicio", { nullsFirst: false }),
        db.from("agenda").select("*")
            .eq("estado", "pendiente")
            .or(`fecha.is.null,fecha.lt.${hoy}`)
            .order("fecha", { nullsFirst: false }),
    ]);

    if (semana.error) return fallo(semana.error, "cargar la semana");
    if (pendientes.error) return fallo(pendientes.error, "cargar los pendientes");

    $("#semana").innerHTML = DIAS.map((nombre, i) => {
        const fecha = sumarDias(lunes, i);
        const iso = aISO(fecha);
        const delDia = semana.data.filter((e) => e.fecha === iso);

        return `
            <div class="dia ${i >= 5 ? "finde" : ""} ${iso === hoy ? "hoy" : ""} ${delDia.length === 0 ? "dia-vacio" : ""}">
                <div class="dia-cabecera">
                    <span class="dia-nombre">${nombre.slice(0, 3)}</span>
                    <span class="dia-numero">${fecha.getDate()}</span>
                    ${iso === hoy ? `<span class="dia-hoy">hoy</span>` : ""}
                    <button class="dia-mas" data-nuevo-dia="${iso}" aria-label="Agregar en ${nombre} ${fecha.getDate()}">${ico("mas")}</button>
                </div>
                ${/* El arrow es necesario: map pasa el índice como segundo
                      argumento, y la fila lo tomaría por sus opciones. */
                  delDia.map((e) => filaAgenda(e)).join("")}
            </div>`;
    }).join("");

    $("#pendientes").innerHTML = pendientes.data.length === 0
        ? `<p class="vacio">Nada pendiente.</p>`
        : lista(pendientes.data.map((e) => filaAgenda(e, { conFecha: true })));
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

function fijarFiltroPagos(filtro) {
    estado.filtroPagos = filtro;
    $$("#filtros-pagos .chip").forEach((c) => c.classList.toggle("chip-activo", c.dataset.filtro === filtro));
}

$("#filtros-pagos").addEventListener("click", (ev) => {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    fijarFiltroPagos(chip.dataset.filtro);
    pintarPagos();
});

function ordenarPagos(data) {
    // Ordenar por vencimiento a secas dejaba arriba lo más viejo, que
    // justamente es lo que ya está cobrado, y empujaba lo vencido al fondo de
    // la lista. Lo que hay que reclamar va primero: pendientes ordenados por
    // vencimiento (lo más urgente arriba, lo que no vence al final) y después
    // lo saldado, de lo más reciente a lo más viejo.
    data.sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === "pendiente" ? -1 : 1;
        if (a.estado === "pendiente") {
            if (!a.vence) return 1;
            if (!b.vence) return -1;
            return a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0;
        }
        return (b.fecha_pago || "") < (a.fecha_pago || "") ? -1 : 1;
    });
    return data;
}

function htmlTotalesPagos(pagos) {
    const r = resumenPagos(pagos);
    return (
        tarjetaTotal("Te deben", sumar(r.cobrar)) +
        tarjetaTotal("Vencido", sumar(r.cobrarVencido), { clase: "rojo" }) +
        tarjetaTotal("Cobraste este mes", sumar(r.cobradoMes), { clase: "verde" }) +
        tarjetaTotal("Tenés que pagar", sumar(r.pagar))
    );
}

async function pintarPagos() {
    const { data, error } = await db.from("pagos").select("*").order("creado", { ascending: false });
    if (error) return fallo(error, "cargar los pagos");

    ordenarPagos(data);
    $("#totales-pagos").innerHTML = htmlTotalesPagos(data);

    const hoy = hoyISO();
    const visibles = data.filter((p) => {
        switch (estado.filtroPagos) {
            case "pendiente": return p.estado === "pendiente";
            case "pagado": return p.estado === "pagado";
            case "vencido": return p.estado === "pendiente" && p.vence && p.vence < hoy;
            default: return true;
        }
    });

    $("#lista-pagos").innerHTML = visibles.length === 0
        ? `<p class="vacio">${data.length === 0 ? `Todavía no hay cobros ni gastos. Cargá el primero con "+ Nuevo".` : "No hay nada en este filtro."}</p>`
        : lista(visibles.map((p) => filaPago(p)));
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

$("#buscar-pedidos").addEventListener("input", (ev) => {
    estado.busquedaPedidos = ev.target.value;
    pintarPedidos();
});

const ESTADOS_PEDIDO = { borrador: "Borrador", pedido: "En camino", recibido: "Recibido", cancelado: "Cancelado" };

function fichaPedido(p, conObra = true) {
    const g = progresoPedido(p);
    const items = g.items.slice().sort((a, b) => a.orden - b.orden);
    const abierto = estado.pedidosAbiertos.has(p.id);

    const totales = { ARS: 0, USD: 0 };
    for (const i of items) {
        totales[i.moneda === "USD" ? "USD" : "ARS"] += (Number(i.precio_unitario) || 0) * Number(i.cantidad);
    }
    const montos = ["ARS", "USD"].filter((m) => totales[m] > 0).map((m) => plata(totales[m], m)).join(" + ");

    const detalle = [
        conObra ? nombreObra(p.obra_id) : "",
        p.fecha_pedido ? "pedido " + conArticulo(diaCercano(p.fecha_pedido)) : "",
        p.entrega_estimada ? "entrega " + conArticulo(diaCercano(p.entrega_estimada)) : "",
    ].filter(Boolean).join(" · ");

    return `
        <div class="pedido ${p.estado} ${abierto ? "abierto" : ""}">
            <button class="pedido-cabecera" data-desplegar="${p.id}" aria-expanded="${abierto}">
                <span class="pedido-datos">
                    <span class="fila-titulo">${esc(p.proveedor || "Sin proveedor")}</span>
                    ${detalle ? `<span class="fila-sub">${esc(mayuscula(detalle))}</span>` : ""}
                </span>
                ${montos ? `<span class="monto">${montos}</span>` : ""}
                <span class="pedido-avance">
                    <span class="etiqueta ${p.estado}">${ESTADOS_PEDIDO[p.estado] || esc(p.estado)}</span>
                    <span class="progreso" aria-hidden="true"><span style="width:${g.pct}%"></span></span>
                    <span class="pedido-cuenta">${g.total ? `${g.llegaron} de ${g.total}` : "Sin materiales"}</span>
                    <span class="pedido-flecha">${ico("abajo")}</span>
                </span>
            </button>

            ${abierto ? `
            <div class="pedido-items">
                ${items.map((i) => {
                    const moneda = i.moneda === "USD" ? "USD" : "ARS";
                    return `
                    <label class="item ${i.recibido ? "listo" : ""}">
                        <input type="checkbox" data-item="${i.id}" ${i.recibido ? "checked" : ""}>
                        <span class="item-caja">${ico("tilde")}</span>
                        <span class="item-nombre">${esc(i.material)}</span>
                        <span class="item-detalle">${Number(i.cantidad)} ${esc(i.unidad)}${
                            i.precio_unitario ? " · " + plata(i.precio_unitario * i.cantidad, moneda) : ""
                        }</span>
                        <button class="item-quitar" data-borrar-item="${i.id}" data-material="${esc(i.material)}"
                                aria-label="Quitar ${esc(i.material)}">${ico("cerrar")}</button>
                    </label>`;
                }).join("")}

                <form class="item-alta" data-alta-item="${p.id}">
                    <input name="material" placeholder="Agregar material" required aria-label="Material">
                    <input name="cantidad" class="chico" type="number" step="0.01" min="0.01" value="1" aria-label="Cantidad">
                    <input name="unidad" class="chico" placeholder="u" value="u" aria-label="Unidad">
                    <input name="precio" class="chico" type="number" step="0.01" min="0" placeholder="Precio c/u" aria-label="Precio unitario">
                    <select name="moneda" class="chico" aria-label="Moneda">
                        <option value="ARS">$</option>
                        <option value="USD">US$</option>
                    </select>
                    <button class="btn btn-fantasma" type="submit">Agregar</button>
                </form>

                <button class="btn btn-suave" data-editar="pedido" data-id="${p.id}">Editar pedido</button>
            </div>` : ""}
        </div>`;
}

async function pintarPedidos() {
    // Una sola consulta trae el pedido y sus materiales: pedirlos por separado
    // haría una consulta por pedido.
    const { data, error } = await db.from("pedidos")
        .select("*, pedido_items(*)")
        .order("creado", { ascending: false });

    if (error) return fallo(error, "cargar los pedidos");

    const cont = $("#lista-pedidos");
    if (data.length === 0) {
        cont.innerHTML = `<p class="vacio">Todavía no hay pedidos. Cargá uno con "+ Nuevo" o mandale al asistente la foto de un remito.</p>`;
        return;
    }

    const q = estado.busquedaPedidos.trim().toLowerCase();
    const filtrados = !q ? data : data.filter((p) => {
        const texto = [
            p.proveedor,
            nombreObra(p.obra_id),
            p.notas,
            ...(p.pedido_items || []).map((i) => i.material),
        ].filter(Boolean).join(" ").toLowerCase();
        return texto.includes(q);
    });

    cont.innerHTML = filtrados.length === 0
        ? `<p class="vacio">No hay pedidos que coincidan con "${esc(estado.busquedaPedidos.trim())}".</p>`
        : filtrados.map((p) => fichaPedido(p)).join("");
}

// ---------------------------------------------------------------------------
// Obras
// ---------------------------------------------------------------------------

const ESTADOS_OBRA = { activa: "Activa", pausada: "Pausada", terminada: "Terminada" };

async function pintarObras() {
    await cargarObras();
    if (estado.obraActiva) {
        if (estado.obras.some((o) => o.id === estado.obraActiva)) return pintarDetalleObra(estado.obraActiva);
        estado.obraActiva = null;
    }

    $("#obra-volver").hidden = true;
    $("#obras-titulo").textContent = "Obras";
    $("#obra-acciones").innerHTML = `<button class="btn btn-primario" data-nuevo="obra">+ Nueva</button>`;
    $("#detalle-obra").hidden = true;

    const cont = $("#lista-obras");
    cont.hidden = false;

    if (estado.obras.length === 0) {
        cont.innerHTML = `<p class="vacio">No hay obras cargadas. Son opcionales: sirven para ver junto todo lo de un mismo proyecto.</p>`;
        return;
    }

    cont.innerHTML = `<div class="lista">${estado.obras.map((o) => `
        <button class="fila fila-entera" data-ir="obras" data-obra="${o.id}">
            <span class="fila-icono">${ico("obra")}</span>
            <span class="fila-cuerpo">
                <span class="fila-titulo">${esc(o.nombre)}</span>
                <span class="fila-sub">${esc(o.cliente || "Sin cliente")}</span>
            </span>
            <span class="etiqueta ${o.estado}">${ESTADOS_OBRA[o.estado] || esc(o.estado)}</span>
            <span class="fila-flecha">${ico("derecha")}</span>
        </button>`).join("")}</div>`;
}

async function pintarDetalleObra(obraId) {
    const obra = estado.obras.find((o) => o.id === obraId);
    if (!obra) return;

    $("#obra-volver").hidden = false;
    $("#obras-titulo").textContent = obra.nombre;
    $("#obra-acciones").innerHTML = `
        <span class="etiqueta ${obra.estado}">${ESTADOS_OBRA[obra.estado] || esc(obra.estado)}</span>
        <button class="btn btn-fantasma" data-editar="obra" data-id="${obra.id}">Editar</button>`;
    $("#lista-obras").hidden = true;

    const [agendaRes, pagosRes, pedidosRes] = await Promise.all([
        db.from("agenda").select("*").eq("obra_id", obraId).order("fecha", { nullsFirst: true }).order("hora_inicio", { nullsFirst: false }),
        db.from("pagos").select("*").eq("obra_id", obraId).order("creado", { ascending: false }),
        db.from("pedidos").select("*, pedido_items(*)").eq("obra_id", obraId).order("creado", { ascending: false }),
    ]);

    if (agendaRes.error) return fallo(agendaRes.error, "cargar la agenda de la obra");
    if (pagosRes.error) return fallo(pagosRes.error, "cargar los pagos de la obra");
    if (pedidosRes.error) return fallo(pedidosRes.error, "cargar los pedidos de la obra");

    const pagos = ordenarPagos(pagosRes.data);
    const agenda = agendaRes.data;
    const pedidos = pedidosRes.data;
    const sub = [obra.cliente, obra.notas].filter(Boolean).join(" · ");

    const bloque = (titulo, clave, etiqueta, contenido, vacio) => `
        <section class="bloque">
            <div class="bloque-cabecera">
                <h2>${titulo}</h2>
                <button class="btn btn-suave" data-nuevo="${clave}" data-obra="${obra.id}">+ ${etiqueta}</button>
            </div>
            ${contenido || `<p class="vacio">${vacio}</p>`}
        </section>`;

    const cont = $("#detalle-obra");
    cont.hidden = false;
    cont.innerHTML = `
        ${sub ? `<p class="obra-sub">${esc(sub)}</p>` : ""}
        <div class="totales">${htmlTotalesPagos(pagos)}</div>
        ${bloque("Agenda", "agenda", "Agregar",
            agenda.length ? lista(agenda.map((e) => filaAgenda(e, { conFecha: true, conObra: false }))) : "",
            "No hay nada agendado en esta obra.")}
        ${bloque("Pagos", "pago", "Agregar",
            pagos.length ? lista(pagos.map((p) => filaPago(p, false))) : "",
            "No hay cobros ni gastos en esta obra.")}
        ${bloque("Pedidos", "pedido", "Agregar",
            pedidos.map((p) => fichaPedido(p, false)).join(""),
            "No hay pedidos en esta obra.")}`;
}

function refrescar() {
    ultimoPintado = Date.now();
    VISTAS[estado.vista]();
}

// ---------------------------------------------------------------------------
// Acciones delegadas
// ---------------------------------------------------------------------------

// Un solo listener en el contenido en vez de uno por fila: las listas se
// redibujan enteras a cada rato y así no hay que volver a enganchar nada.
$(".contenido").addEventListener("click", async (ev) => {
    const editar = ev.target.closest("[data-editar]");
    if (editar) return abrirModal(editar.dataset.editar, editar.dataset.id);

    // Es un botón y no un enlace con #ancla: el hash de la dirección lo usa
    // la navegación entre pantallas.
    const bajar = ev.target.closest("[data-bajar]");
    if (bajar) return document.getElementById(bajar.dataset.bajar)?.scrollIntoView({ behavior: "smooth", block: "start" });

    const nuevo = ev.target.closest("[data-nuevo]");
    if (nuevo) {
        const inicial = nuevo.dataset.obra ? { obra_id: nuevo.dataset.obra } : {};
        return abrirModal(nuevo.dataset.nuevo, null, inicial);
    }

    const nuevoDia = ev.target.closest("[data-nuevo-dia]");
    if (nuevoDia) return abrirModal("agenda", null, { fecha: nuevoDia.dataset.nuevoDia });

    const desplegar = ev.target.closest("[data-desplegar]");
    if (desplegar) {
        const id = desplegar.dataset.desplegar;
        estado.pedidosAbiertos.has(id)
            ? estado.pedidosAbiertos.delete(id)
            : estado.pedidosAbiertos.add(id);
        return refrescar();
    }

    const pagar = ev.target.closest("[data-pagar]");
    if (pagar) {
        // Un toque registra el cobro o el pago con la fecha de hoy; otro
        // toque lo deshace, por si se marcó el renglón equivocado.
        const yaEstaba = pagar.dataset.estado === "pagado";
        const { error } = await db.from("pagos")
            .update(yaEstaba ? { estado: "pendiente", fecha_pago: null } : { estado: "pagado", fecha_pago: hoyISO() })
            .eq("id", pagar.dataset.pagar);
        if (error) return fallo(error, "marcar el pago");
        aviso(yaEstaba ? "Volvió a pendiente." : "Registrado con fecha de hoy.");
        return refrescar();
    }

    const borrarItem = ev.target.closest("[data-borrar-item]");
    if (borrarItem) {
        // preventDefault porque el botón vive dentro de un <label>: sin esto
        // el click llegaría también al checkbox y marcaría el material justo
        // antes de borrarlo.
        ev.preventDefault();
        // Con el dedo, la cruz queda a un centímetro del casillero de
        // "recibido", y un toque de más borraba un renglón del pedido sin
        // avisar ni dejar forma de recuperarlo.
        if (!confirm(`¿Quitar "${borrarItem.dataset.material}" del pedido?`)) return;
        const { error } = await db.from("pedido_items").delete().eq("id", borrarItem.dataset.borrarItem);
        if (error) return fallo(error, "quitar el material");
        return refrescar();
    }

    const hecho = ev.target.closest("[data-hecho]");
    if (hecho) {
        // Dar por terminada una tarea es lo que más se hace en el día. Que
        // exija abrir el formulario, cambiar un desplegable y guardar es mucho
        // trámite, sobre todo con una mano sola.
        const { error } = await db.from("agenda")
            .update({ estado: hecho.dataset.estado === "hecho" ? "pendiente" : "hecho" })
            .eq("id", hecho.dataset.hecho);
        if (error) return fallo(error, "cambiar el estado");
        return refrescar();
    }
});

$(".contenido").addEventListener("change", async (ev) => {
    const check = ev.target.closest("[data-item]");
    if (!check) return;
    const { error } = await db.from("pedido_items")
        .update({ recibido: check.checked })
        .eq("id", check.dataset.item);
    if (error) return fallo(error, "actualizar el material");
    refrescar();
});

$(".contenido").addEventListener("submit", async (ev) => {
    const form = ev.target.closest("[data-alta-item]");
    if (!form) return;
    ev.preventDefault();

    const datos = new FormData(form);
    const precio = datos.get("precio");

    const { error } = await db.from("pedido_items").insert({
        pedido_id: form.dataset.altaItem,
        material: datos.get("material").trim(),
        cantidad: Number(datos.get("cantidad")) || 1,
        unidad: (datos.get("unidad") || "u").trim() || "u",
        precio_unitario: precio === "" ? null : Number(precio),
        moneda: datos.get("moneda") || "ARS",
        orden: Date.now() % 100000,
    });

    if (error) return fallo(error, "agregar el material");
    refrescar();
});

// ---------------------------------------------------------------------------
// Modal de alta y edición
// ---------------------------------------------------------------------------

// Un formulario declarado como datos en vez de cuatro bloques de HTML casi
// iguales. `par: true` significa que ese campo comparte renglón con el
// siguiente. `extra: true` lo manda adentro de "Más detalles": al cargar algo
// nuevo se ven tres o cuatro campos, no diez.
const FORMULARIOS = {
    agenda: {
        tabla: "agenda",
        titulo: { nuevo: "Nueva tarea o reunión", editar: "Editar" },
        campos: [
            { n: "titulo", e: "Qué", t: "text", req: true },
            { n: "fecha", e: "Día (vacío = pendiente)", t: "date", par: true },
            { n: "hora_inicio", e: "Hora", t: "time" },
            { n: "tipo", e: "Tipo", t: "select", ops: [["trabajo", "Tarea"], ["reunion", "Reunión"]] },
            { n: "hora_fin", e: "Hasta", t: "time", par: true, extra: true },
            { n: "estado", e: "Estado", t: "select", extra: true, ops: [["pendiente", "Pendiente"], ["hecho", "Hecho"], ["cancelado", "Cancelado"]] },
            { n: "lugar", e: "Lugar", t: "text", extra: true },
            { n: "obra_id", e: "Obra", t: "obra", extra: true },
            { n: "notas", e: "Notas", t: "textarea", extra: true },
        ],
    },
    pago: {
        tabla: "pagos",
        titulo: { nuevo: "Nuevo cobro o gasto", editar: "Editar" },
        campos: [
            { n: "tipo", e: "Tipo", t: "select", ops: [["cobro", "Me deben"], ["gasto", "Tengo que pagar"]] },
            { n: "concepto", e: "Concepto", t: "text", req: true },
            { n: "monto", e: "Monto", t: "number", req: true, par: true },
            { n: "moneda", e: "Moneda", t: "select", ops: [["ARS", "Pesos"], ["USD", "Dólares"]] },
            { n: "vence", e: "Vence", t: "date" },
            { n: "estado", e: "Estado", t: "select", par: true, extra: true, ops: [["pendiente", "Pendiente"], ["pagado", "Pagado o cobrado"]] },
            { n: "fecha_pago", e: "Fecha de pago", t: "date", extra: true },
            { n: "obra_id", e: "Obra", t: "obra", extra: true },
            { n: "metodo", e: "Medio", t: "text", extra: true },
            { n: "notas", e: "Notas", t: "textarea", extra: true },
        ],
    },
    pedido: {
        tabla: "pedidos",
        titulo: { nuevo: "Nuevo pedido", editar: "Editar pedido" },
        campos: [
            { n: "proveedor", e: "Proveedor", t: "text", req: true },
            { n: "estado", e: "Estado", t: "select", ops: [["borrador", "Borrador"], ["pedido", "En camino"], ["recibido", "Recibido"], ["cancelado", "Cancelado"]] },
            { n: "obra_id", e: "Obra", t: "obra", extra: true },
            { n: "fecha_pedido", e: "Fecha del pedido", t: "date", par: true, extra: true },
            { n: "entrega_estimada", e: "Entrega estimada", t: "date", extra: true },
            { n: "notas", e: "Notas", t: "textarea", extra: true },
        ],
    },
    obra: {
        tabla: "obras",
        titulo: { nuevo: "Nueva obra", editar: "Editar obra" },
        campos: [
            { n: "nombre", e: "Nombre", t: "text", req: true },
            { n: "cliente", e: "Cliente", t: "text" },
            { n: "estado", e: "Estado", t: "select", ops: [["activa", "Activa"], ["pausada", "Pausada"], ["terminada", "Terminada"]] },
            { n: "notas", e: "Notas", t: "textarea" },
        ],
    },
};

let modalActual = null;

// `opciones` existe para el asistente: cuando la persona toca "Corregir" en
// una propuesta, el formulario se abre con lo que leyó la IA.
//   - guardar(datos): reemplaza el insert de siempre (el pedido leído de un
//     remito se guarda junto con sus materiales).
//   - alGuardar(): avisa que quedó guardado.
async function abrirModal(clave, id = null, valoresIniciales = {}, opciones = {}) {
    const def = FORMULARIOS[clave];
    if (!def) return;

    let fila = { ...valoresIniciales };

    if (id) {
        const { data, error } = await db.from(def.tabla).select("*").eq("id", id).single();
        if (error) return fallo(error, "abrir el registro");
        fila = data;
    }

    modalActual = { clave, def, id, opciones };

    $("#modal-titulo").textContent = def.titulo[id ? "editar" : "nuevo"];
    $("#modal-form").innerHTML = armarCampos(def.campos, fila, Boolean(id));
    $("#modal-borrar").hidden = !id;
    $("#modal-error").hidden = true;
    $("#modal-fondo").hidden = false;

    // El foco va al primer campo para poder escribir sin tocar el mouse. Al
    // editar no: en el teléfono abriría el teclado encima de lo que se quiere
    // mirar.
    if (!id) $("#modal-form input, #modal-form select, #modal-form textarea")?.focus();
}

function armarCampos(campos, fila, editando) {
    const armar = (grupo) => {
        let html = "";
        for (let i = 0; i < grupo.length; i++) {
            const c = grupo[i];
            if (c.par && grupo[i + 1]) {
                html += `<div class="fila-campos">${campoHTML(c, fila)}${campoHTML(grupo[i + 1], fila)}</div>`;
                i++;
            } else {
                html += campoHTML(c, fila);
            }
        }
        return html;
    };

    const extras = campos.filter((c) => c.extra);
    if (extras.length === 0) return armar(campos);

    // "Más detalles" arranca abierto si ya hay algo cargado ahí adentro: no
    // tiene que esconder un dato que existe.
    const conDatos = extras.some((c) => {
        const v = fila[c.n];
        return v !== null && v !== undefined && v !== "" && !(c.n === "estado" && (v === "pendiente" || v === "borrador"));
    });

    return armar(campos.filter((c) => !c.extra)) + `
        <details class="mas-detalles" ${editando || conDatos ? "open" : ""}>
            <summary>Más detalles</summary>
            ${armar(extras)}
        </details>`;
}

function campoHTML(c, fila) {
    const valor = fila[c.n] ?? "";
    const id = "campo-" + c.n;
    const req = c.req ? "required" : "";
    let control;

    if (c.t === "obra") {
        const ops = estado.obras.map((o) =>
            `<option value="${o.id}" ${o.id === valor ? "selected" : ""}>${esc(o.nombre)}</option>`).join("");
        control = `<select id="${id}" name="${c.n}"><option value="">Sin obra</option>${ops}</select>`;
    } else if (c.t === "select") {
        const ops = c.ops.map(([v, e]) =>
            `<option value="${v}" ${v === valor ? "selected" : ""}>${e}</option>`).join("");
        control = `<select id="${id}" name="${c.n}">${ops}</select>`;
    } else if (c.t === "textarea") {
        control = `<textarea id="${id}" name="${c.n}">${esc(valor)}</textarea>`;
    } else if (c.t === "number") {
        control = `<input id="${id}" name="${c.n}" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(valor)}" ${req}>`;
    } else {
        // Las horas vienen de Postgres como "14:30:00" y el input type=time
        // no acepta los segundos: los recorta.
        const v = c.t === "time" && valor ? String(valor).slice(0, 5) : valor;
        control = `<input id="${id}" name="${c.n}" type="${c.t}" value="${esc(v)}" ${req}>`;
    }

    return `<div class="campo"><label for="${id}">${c.e}</label>${control}</div>`;
}

function cerrarModal() {
    $("#modal-fondo").hidden = true;
    modalActual = null;
}

$("#modal-cerrar").addEventListener("click", cerrarModal);
$("#modal-cancelar").addEventListener("click", cerrarModal);

$("#modal-fondo").addEventListener("click", (ev) => {
    if (ev.target === $("#modal-fondo")) cerrarModal();
});

document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (modalActual) cerrarModal();
    else cerrarAsistente();
});

// Enter dentro de un campo dispara el submit del formulario, y sin esto el
// navegador recargaría la página perdiendo lo cargado. Lo redirigimos al
// mismo camino que el botón Guardar.
$("#modal-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    guardarModal();
});

$("#modal-guardar").addEventListener("click", guardarModal);

async function guardarModal() {
    if (!modalActual) return;

    const form = $("#modal-form");
    const err = $("#modal-error");
    const { def, id, clave, opciones } = modalActual;

    // Un campo obligatorio escondido dentro de "Más detalles" cerrado no
    // puede mostrar su aviso de validación; se abre antes de validar.
    const detalles = form.querySelector(".mas-detalles");
    if (!form.checkValidity() && detalles) detalles.open = true;
    if (!form.reportValidity()) return;

    const datos = {};

    for (const c of def.campos) {
        const el = form.elements[c.n];
        if (!el) continue;
        const bruto = typeof el.value === "string" ? el.value.trim() : el.value;

        // El `required` del navegador da por lleno un campo con espacios, pero
        // al recortarlos queda vacío y la base lo rechaza. Se avisa acá, en
        // castellano y señalando el campo, en vez de dejar que vuelva un error
        // de Postgres que el cliente no puede interpretar.
        if (c.req && bruto === "") {
            err.textContent = `Falta completar ${NOMBRES[c.n] || c.e.toLowerCase()}.`;
            err.hidden = false;
            el.value = "";
            el.focus();
            return;
        }

        // Un campo vacío va como NULL, no como cadena vacía: Postgres rechaza
        // "" en columnas date, time y uuid, y un texto vacío guardado como ""
        // obligaría a chequear dos casos en todas las vistas.
        datos[c.n] = bruto === "" ? null : (c.t === "number" ? Number(bruto) : bruto);
    }

    if (clave === "agenda" && datos.hora_inicio && datos.hora_fin && datos.hora_fin <= datos.hora_inicio) {
        if (detalles) detalles.open = true;
        err.textContent = "La hora de fin tiene que ser posterior a la de inicio.";
        err.hidden = false;
        form.elements.hora_fin.focus();
        return;
    }

    if (clave === "pago" && datos.estado === "pagado" && !datos.fecha_pago) {
        datos.fecha_pago = hoyISO();
    }

    const boton = $("#modal-guardar");
    boton.disabled = true;

    let error;
    if (opciones.guardar) ({ error } = await opciones.guardar(datos));
    else if (id) ({ error } = await db.from(def.tabla).update(datos).eq("id", id));
    else ({ error } = await db.from(def.tabla).insert(datos));

    boton.disabled = false;

    if (error) {
        console.error("guardar", error);
        err.textContent = mensajeDeError(error);
        err.hidden = false;
        return;
    }

    cerrarModal();
    aviso("Guardado.");
    if (opciones.alGuardar) opciones.alGuardar();
    if (clave === "obra") await cargarObras();
    refrescar();
}

$("#modal-borrar").addEventListener("click", async () => {
    if (!modalActual || !modalActual.id) return;
    if (!confirm("¿Borrar este registro? No se puede deshacer.")) return;

    const { def, clave, id } = modalActual;
    const { error } = await db.from(def.tabla).delete().eq("id", id);
    if (error) return fallo(error, "borrar el registro");

    cerrarModal();
    aviso("Borrado.");
    if (clave === "obra") {
        estado.obraActiva = null;
        await cargarObras();
    }
    refrescar();
});
