// Panel de control de Espacio Arquitectura.
//
// Sin paso de compilación, igual que la web pública: el navegador carga este
// módulo tal cual está en el repositorio. Con tres pantallas y un solo
// estudio usándolo, un bundler sería más mantenimiento del que ahorra.
//
// El navegador habla directo con Supabase; no hay servidor propio en el
// medio. Eso es seguro únicamente porque las políticas RLS de la base deciden
// qué puede ver cada usuario: este archivo no protege nada y no debe intentar
// hacerlo. Cualquier regla de acceso nueva va en SQL, no acá.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
    // lunes, que es como el estudio mira la semana.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
}

function sumarDias(fecha, dias) {
    const d = new Date(fecha);
    d.setDate(d.getDate() + dias);
    return d;
}

const HOY = aISO(new Date());

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaCorta(iso) {
    if (!iso) return "";
    const f = aFecha(iso);
    return `${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)}`;
}

function plata(monto, moneda) {
    const n = Number(monto) || 0;
    const simbolo = moneda === "USD" ? "US$" : "$";
    return simbolo + " " + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// Todo lo que viene de la base se escapa antes de entrar al HTML. Lo cargan
// sólo los del estudio, así que no es defensa contra un atacante: es que un
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
    vista: "agenda",
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
// usuario de vuelta a la semana actual mientras mira otra.
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
    irA(location.hash.replace("#", "") || "agenda");
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

const VISTAS = { agenda: pintarAgenda, pagos: pintarPagos, materiales: pintarPedidos, obras: pintarObras };

function irA(vista) {
    if (!VISTAS[vista]) vista = "agenda";
    // Cambiar de pantalla con un formulario abierto (por ejemplo con el botón
    // Atrás del navegador) dejaba el modal flotando sobre la vista nueva.
    if (modalActual) cerrarModal();
    estado.vista = vista;
    location.hash = vista;

    $$(".vista").forEach((v) => { v.hidden = true; });
    $(`#vista-${vista}`).hidden = false;
    $$(".nav-item").forEach((b) => b.classList.toggle("activo", b.dataset.vista === vista));

    VISTAS[vista]();
}

$("#nav").addEventListener("click", (ev) => {
    const boton = ev.target.closest(".nav-item");
    if (!boton) return;
    if (boton.dataset.vista === "obras") estado.obraActiva = null;
    irA(boton.dataset.vista);
});

window.addEventListener("hashchange", () => {
    const vista = location.hash.replace("#", "");
    if (vista && vista !== estado.vista) irA(vista);
});

function abrirObra(id) {
    estado.obraActiva = id;
    irA("obras");
}

$("#obra-volver").addEventListener("click", () => {
    estado.obraActiva = null;
    pintarObras();
});

// ---------------------------------------------------------------------------
// Obras (se usan como desplegable en el resto de las pantallas)
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

async function pintarObras() {
    await cargarObras();
    if (estado.obraActiva) {
        const existe = estado.obras.some((o) => o.id === estado.obraActiva);
        if (existe) return pintarDetalleObra(estado.obraActiva);
        estado.obraActiva = null;
    }

    $("#obra-volver").hidden = true;
    $("#obras-titulo").textContent = "Obras";
    $("#obra-acciones").innerHTML = `<button class="btn btn-primario" data-nuevo="obra">+ Nueva</button>`;
    $("#detalle-obra").hidden = true;

    const cont = $("#lista-obras");
    cont.hidden = false;

    if (estado.obras.length === 0) {
        cont.innerHTML = `<p class="vacio">Todavía no hay obras cargadas. La obra es lo que ata la agenda, los pagos y los materiales, así que conviene empezar por acá.</p>`;
        return;
    }

    const etiquetas = { activa: "ok", pausada: "alerta", terminada: "neutro" };

    cont.innerHTML = estado.obras.map((o) => `
        <div class="ficha">
            <div class="ficha-cuerpo">
                <div class="ficha-titulo">
                    <button class="ficha-link" data-ver-obra="${o.id}">${esc(o.nombre)}</button>
                </div>
                <div class="ficha-sub">${esc(o.cliente || "Sin cliente")}${o.notas ? " · " + esc(o.notas) : ""}</div>
            </div>
            <span class="etiqueta ${etiquetas[o.estado]}">${esc(o.estado)}</span>
            <div class="ficha-acciones">
                <button class="btn btn-fantasma" data-ver-obra="${o.id}">Ver obra</button>
                <button class="btn btn-fantasma" data-editar="obra" data-id="${o.id}">Editar</button>
            </div>
        </div>`).join("");
}

async function pintarDetalleObra(obraId) {
    const obra = estado.obras.find((o) => o.id === obraId);
    if (!obra) return;

    const etiquetasObra = { activa: "ok", pausada: "alerta", terminada: "neutro" };

    $("#obra-volver").hidden = false;
    $("#obras-titulo").textContent = obra.nombre;
    $("#obra-acciones").innerHTML = `
        <span class="etiqueta ${etiquetasObra[obra.estado]}">${esc(obra.estado)}</span>
        <button class="btn btn-fantasma" data-editar="obra" data-id="${obra.id}">Editar obra</button>`;
    $("#lista-obras").hidden = true;

    const [agendaRes, pagosRes, pedidosRes] = await Promise.all([
        db.from("agenda").select("*").eq("obra_id", obraId).order("fecha", { nullsFirst: true }).order("hora_inicio", { nullsFirst: false }),
        db.from("pagos").select("*").eq("obra_id", obraId).order("creado", { ascending: false }),
        db.from("pedidos").select("*, pedido_items(*)").eq("obra_id", obraId).order("creado", { ascending: false }),
    ]);

    if (agendaRes.error) return fallo(agendaRes.error, "cargar la agenda de la obra");
    if (pagosRes.error) return fallo(pagosRes.error, "cargar los pagos de la obra");
    if (pedidosRes.error) return fallo(pedidosRes.error, "cargar los pedidos de la obra");

    const pagos = pagosRes.data;
    ordenarPagos(pagos);

    const agenda = agendaRes.data;
    const pedidos = pedidosRes.data;

    const sub = [obra.cliente || "Sin cliente", obra.notas].filter(Boolean).join(" · ");
    const cont = $("#detalle-obra");
    cont.hidden = false;

    cont.innerHTML = `
        <div class="ficha obra-resumen">
            <div class="ficha-cuerpo">
                <div class="ficha-sub">${esc(sub)}</div>
            </div>
        </div>

        <div class="totales">${htmlTotalesPagos(pagos)}</div>

        <div class="obra-bloque">
            <div class="obra-bloque-cabecera">
                <h3>Agenda de la obra (${agenda.length})</h3>
                <button class="btn btn-primario" data-nuevo="agenda" data-obra="${obra.id}">+ Entrada</button>
            </div>
            ${agenda.length === 0
                ? `<p class="vacio">No hay entradas de agenda en esta obra.</p>`
                : agenda.map((e) => chipEvento(e, true, false)).join("")}
        </div>

        <div class="obra-bloque">
            <div class="obra-bloque-cabecera">
                <h3>Pagos de la obra (${pagos.length})</h3>
                <button class="btn btn-primario" data-nuevo="pago" data-obra="${obra.id}">+ Pago</button>
            </div>
            ${pagos.length === 0
                ? `<p class="vacio">No hay pagos cargados en esta obra.</p>`
                : pagos.map((p) => fichaPagoHTML(p, false)).join("")}
        </div>

        <div class="obra-bloque">
            <div class="obra-bloque-cabecera">
                <h3>Pedidos de materiales (${pedidos.length})</h3>
                <button class="btn btn-primario" data-nuevo="pedido" data-obra="${obra.id}">+ Pedido</button>
            </div>
            ${pedidos.length === 0
                ? `<p class="vacio">No hay pedidos de materiales en esta obra.</p>`
                : pedidos.map((p) => fichaPedidoHTML(p, false)).join("")}
        </div>`;
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

    $("#semana-titulo").textContent = lunes.getMonth() === domingo.getMonth()
        ? `${lunes.getDate()} al ${domingo.getDate()} de ${MESES[lunes.getMonth()]}`
        : `${lunes.getDate()} ${MESES[lunes.getMonth()].slice(0, 3)} al ${domingo.getDate()} ${MESES[domingo.getMonth()].slice(0, 3)}`;

    // Dos consultas en paralelo: la semana que se está mirando y la bandeja de
    // pendientes, que no depende de la semana.
    const [semana, pendientes] = await Promise.all([
        db.from("agenda").select("*")
            .gte("fecha", aISO(lunes)).lte("fecha", aISO(domingo))
            // Las que tienen hora van primero y en orden; los trabajos sueltos
            // del día quedan al final, que es como se lee una jornada.
            .order("hora_inicio", { nullsFirst: false }),
        db.from("agenda").select("*")
            .eq("estado", "pendiente")
            .or(`fecha.is.null,fecha.lt.${HOY}`)
            .order("fecha", { nullsFirst: true }),
    ]);

    if (semana.error) return fallo(semana.error, "cargar la semana");
    if (pendientes.error) return fallo(pendientes.error, "cargar los pendientes");

    $("#semana").innerHTML = DIAS.map((nombre, i) => {
        const fecha = sumarDias(lunes, i);
        const iso = aISO(fecha);
        const delDia = semana.data.filter((e) => e.fecha === iso);

        return `
            <div class="dia ${i >= 5 ? "finde" : ""} ${iso === HOY ? "hoy" : ""} ${delDia.length === 0 ? "dia-vacio" : ""}">
                <div class="dia-cabecera">
                    <span class="dia-nombre">${nombre.slice(0, 3)}</span>
                    <span class="dia-numero">${fecha.getDate()}</span>
                </div>
                ${/* El arrow es necesario: map pasa el índice como segundo
                      argumento, y pasárselo a chipEvento haría que del segundo
                      evento en adelante se dibujaran como fichas de pendiente. */
                  delDia.map((e) => chipEvento(e)).join("")}
                <button class="dia-hueco" data-nuevo-dia="${iso}" aria-label="Agregar en ${nombre} ${fecha.getDate()}"></button>
            </div>`;
    }).join("");

    const panel = $("#pendientes");
    panel.innerHTML = pendientes.data.length === 0
        ? `<p class="vacio">Nada pendiente.</p>`
        : pendientes.data.map((e) => chipEvento(e, true)).join("");
}

function chipEvento(e, enPanel = false, mostrarObra = true) {
    const atrasado = enPanel && e.estado === "pendiente" && e.fecha && e.fecha < HOY;
    const hora = e.hora_inicio ? e.hora_inicio.slice(0, 5) : "";
    let encabezado = hora;
    if (enPanel) {
        if (!e.fecha) {
            encabezado = "Sin fecha";
        } else if (atrasado) {
            encabezado = `Venció el ${fechaCorta(e.fecha)}`;
        } else {
            encabezado = fechaCorta(e.fecha) + (hora ? ` · ${hora}` : "");
        }
    }

    // Dos botones y no uno: el cuerpo abre la ficha y el tilde la da por
    // hecha. Un <button> no puede contener otro, así que el contenedor es un
    // div y el recuadro lo dibuja él.
    return `
        <div class="evento ${e.tipo} ${e.estado} ${atrasado ? "atrasado" : ""}">
            <button class="evento-cuerpo" data-editar="agenda" data-id="${e.id}">
                ${encabezado ? `<span class="evento-hora">${esc(encabezado)}</span>` : ""}
                <span class="evento-titulo">${esc(e.titulo)}</span>
                ${mostrarObra && e.obra_id ? `<span class="evento-obra">${esc(nombreObra(e.obra_id))}</span>` : ""}
            </button>
            ${e.estado !== "cancelado" ? `
            <button class="evento-tilde" data-hecho="${e.id}" data-estado="${e.estado}"
                    aria-label="${e.estado === "hecho" ? "Marcar como pendiente" : "Marcar como hecho"}"
                    aria-pressed="${e.estado === "hecho"}">✓</button>` : ""}
        </div>`;
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

$("#filtros-pagos").addEventListener("click", (ev) => {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    estado.filtroPagos = chip.dataset.filtro;
    $$("#filtros-pagos .chip").forEach((c) => c.classList.toggle("chip-activo", c === chip));
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
}

function fichaPagoHTML(p, mostrarObra = true) {
    const vencido = p.estado === "pendiente" && p.vence && p.vence < HOY;
    const etiqueta = p.estado === "pagado"
        ? `<span class="etiqueta ok">${p.tipo === "cobro" ? "cobrado" : "pagado"}</span>`
        : vencido
            ? `<span class="etiqueta mal">vencido</span>`
            : `<span class="etiqueta alerta">pendiente</span>`;

    const cuando = p.estado === "pagado"
        ? (p.fecha_pago ? "El " + fechaCorta(p.fecha_pago) : "Sin fecha de pago")
        : (p.vence ? "Vence el " + fechaCorta(p.vence) : "Sin vencimiento");

    const detalle = [
        mostrarObra ? nombreObra(p.obra_id) : "",
        cuando,
        p.metodo,
    ].filter(Boolean).join(" · ");

    return `
        <div class="ficha">
            <div class="ficha-cuerpo">
                <div class="ficha-titulo">${esc(p.concepto)}</div>
                <div class="ficha-sub">${esc(detalle)}</div>
            </div>
            <span class="etiqueta neutro">${p.tipo === "cobro" ? "a cobrar" : "a pagar"}</span>
            ${etiqueta}
            <span class="ficha-monto">${plata(p.monto, p.moneda)}</span>
            <div class="ficha-acciones">
                ${p.estado === "pendiente"
                    ? `<button class="btn btn-fantasma" data-marcar-pagado="${p.id}">Marcar pagado</button>`
                    : ""}
                <button class="btn btn-fantasma" data-editar="pago" data-id="${p.id}">Editar</button>
            </div>
        </div>`;
}

async function pintarPagos() {
    const { data, error } = await db.from("pagos").select("*")
        .order("creado", { ascending: false });

    if (error) return fallo(error, "cargar los pagos");

    ordenarPagos(data);
    $("#totales-pagos").innerHTML = htmlTotalesPagos(data);

    const visibles = data.filter((p) => {
        switch (estado.filtroPagos) {
            case "pendiente": return p.estado === "pendiente";
            case "pagado": return p.estado === "pagado";
            case "vencido": return p.estado === "pendiente" && p.vence && p.vence < HOY;
            default: return true;
        }
    });

    const cont = $("#lista-pagos");
    if (visibles.length === 0) {
        cont.innerHTML = `<p class="vacio">No hay pagos en este filtro.</p>`;
        return;
    }

    cont.innerHTML = visibles.map((p) => fichaPagoHTML(p, true)).join("");
}

function htmlTotalesPagos(pagos) {
    // Los totales se acumulan por moneda. Sumar pesos con dólares daría un
    // número que no significa nada, así que cada tarjeta muestra una línea
    // por moneda y sólo si tiene algo.
    const vacio = () => ({ ARS: 0, USD: 0 });
    const t = { cobrar: vacio(), vencido: vacio(), cobrado: vacio(), pagar: vacio() };
    const mesActual = HOY.slice(0, 7);

    for (const p of pagos) {
        const m = p.moneda === "USD" ? "USD" : "ARS";
        const monto = Number(p.monto) || 0;

        if (p.estado === "pendiente") {
            if (p.tipo === "cobro") {
                t.cobrar[m] += monto;
                if (p.vence && p.vence < HOY) t.vencido[m] += monto;
            } else {
                t.pagar[m] += monto;
            }
        } else if (p.tipo === "cobro" && p.fecha_pago && p.fecha_pago.startsWith(mesActual)) {
            t.cobrado[m] += monto;
        }
    }

    const tarjeta = (etiqueta, valores, clase = "") => {
        const lineas = ["ARS", "USD"]
            .filter((m) => valores[m] > 0)
            .map((m) => plata(valores[m], m));
        if (lineas.length === 0) lineas.push(plata(0, "ARS"));

        return `
            <div class="total ${clase}">
                <div class="total-etiqueta">${etiqueta}</div>
                ${lineas.map((l) => `<div class="total-valor">${l}</div>`).join("")}
            </div>`;
    };

    return (
        tarjeta("Por cobrar", t.cobrar) +
        tarjeta("Vencido", t.vencido, "rojo") +
        tarjeta("Cobrado este mes", t.cobrado, "verde") +
        tarjeta("Gastos pendientes", t.pagar)
    );
}

// ---------------------------------------------------------------------------
// Pedidos de materiales
// ---------------------------------------------------------------------------

$("#buscar-pedidos").addEventListener("input", (ev) => {
    estado.busquedaPedidos = ev.target.value;
    pintarPedidos();
});

function fichaPedidoHTML(p, mostrarObra = true) {
    const etiquetas = { borrador: "neutro", pedido: "alerta", recibido: "ok", cancelado: "neutro" };
    const items = (p.pedido_items || []).sort((a, b) => a.orden - b.orden);
    const abierto = estado.pedidosAbiertos.has(p.id);
    const recibidos = items.filter((i) => i.recibido).length;

    const totales = { ARS: 0, USD: 0 };
    for (const i of items) {
        const m = i.moneda === "USD" ? "USD" : "ARS";
        totales[m] += (Number(i.precio_unitario) || 0) * Number(i.cantidad);
    }
    const montosHTML = ["ARS", "USD"]
        .filter((m) => totales[m] > 0)
        .map((m) => `<span class="ficha-monto">${plata(totales[m], m)}</span>`)
        .join("");

    const detalle = [
        mostrarObra ? nombreObra(p.obra_id) : "",
        p.fecha_pedido ? "Pedido el " + fechaCorta(p.fecha_pedido) : "",
        p.entrega_estimada ? "Entrega " + fechaCorta(p.entrega_estimada) : "",
        items.length ? `${recibidos}/${items.length} recibidos` : "sin materiales",
    ].filter(Boolean).join(" · ");

    return `
        <div class="ficha pedido">
            <div class="pedido-cabecera">
                <div class="ficha-cuerpo">
                    <div class="ficha-titulo">${esc(p.proveedor || "Sin proveedor")}</div>
                    <div class="ficha-sub">${esc(detalle)}</div>
                </div>
                <span class="etiqueta ${etiquetas[p.estado]}">${esc(p.estado)}</span>
                ${montosHTML}
                <div class="ficha-acciones">
                    <button class="btn btn-fantasma" data-desplegar="${p.id}">${abierto ? "Ocultar" : "Materiales"}</button>
                    <button class="btn btn-fantasma" data-editar="pedido" data-id="${p.id}">Editar</button>
                </div>
            </div>

            ${abierto ? `
            <div class="pedido-items">
                ${items.map((i) => {
                    const monedaItem = i.moneda === "USD" ? "USD" : "ARS";
                    return `
                    <label class="item ${i.recibido ? "listo" : ""}">
                        <input type="checkbox" data-item="${i.id}" ${i.recibido ? "checked" : ""}>
                        <span class="item-nombre">${esc(i.material)}</span>
                        <span class="item-detalle">${Number(i.cantidad)} ${esc(i.unidad)}${
                            i.precio_unitario ? " · " + plata(i.precio_unitario * i.cantidad, monedaItem) : ""
                        }</span>
                        <button class="btn btn-icono" data-borrar-item="${i.id}"
                                data-material="${esc(i.material)}"
                                aria-label="Quitar ${esc(i.material)}">&times;</button>
                    </label>`;
                }).join("")}

                <form class="item-alta" data-alta-item="${p.id}">
                    <input name="material" placeholder="Material" required aria-label="Material">
                    <input name="cantidad" class="chico" type="number" step="0.01" min="0.01" value="1" aria-label="Cantidad">
                    <input name="unidad" class="chico" placeholder="u" value="u" aria-label="Unidad">
                    <input name="precio" class="chico" type="number" step="0.01" min="0" placeholder="Precio c/u" aria-label="Precio unitario">
                    <select name="moneda" class="chico" aria-label="Moneda">
                        <option value="ARS">ARS ($)</option>
                        <option value="USD">USD (US$)</option>
                    </select>
                    <button class="btn btn-fantasma" type="submit">Agregar</button>
                </form>
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
        cont.innerHTML = `<p class="vacio">No hay pedidos todavía.</p>`;
        return;
    }

    const q = estado.busquedaPedidos.trim().toLowerCase();
    const filtrados = !q ? data : data.filter((p) => {
        const textoPedido = [
            p.proveedor,
            nombreObra(p.obra_id),
            p.notas,
            ...(p.pedido_items || []).map((i) => i.material),
        ].filter(Boolean).join(" ").toLowerCase();
        return textoPedido.includes(q);
    });

    if (filtrados.length === 0) {
        cont.innerHTML = `<p class="vacio">No hay pedidos que coincidan con "${esc(estado.busquedaPedidos.trim())}".</p>`;
        return;
    }

    cont.innerHTML = filtrados.map((p) => fichaPedidoHTML(p, true)).join("");
}

function refrescarVistaActual() {
    VISTAS[estado.vista]();
}

// ---------------------------------------------------------------------------
// Acciones delegadas
// ---------------------------------------------------------------------------

// Un solo listener en el contenido en vez de uno por fila: las listas se
// redibujan enteras a cada rato y así no hay que volver a enganchar nada.
$(".contenido").addEventListener("click", async (ev) => {
    const verObra = ev.target.closest("[data-ver-obra]");
    if (verObra) return abrirObra(verObra.dataset.verObra);

    const editar = ev.target.closest("[data-editar]");
    if (editar) return abrirModal(editar.dataset.editar, editar.dataset.id);

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
        return refrescarVistaActual();
    }

    const pagar = ev.target.closest("[data-marcar-pagado]");
    if (pagar) {
        const { error } = await db.from("pagos")
            .update({ estado: "pagado", fecha_pago: HOY })
            .eq("id", pagar.dataset.marcarPagado);
        if (error) return fallo(error, "marcar el pago");
        aviso("Pago registrado.");
        return refrescarVistaActual();
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
        return refrescarVistaActual();
    }

    const marcarHecho = ev.target.closest("[data-hecho]");
    if (marcarHecho) {
        // Dar por terminado un trabajo es lo que más se hace en el día. Que
        // exija abrir el formulario, cambiar un desplegable y guardar es mucho
        // trámite, sobre todo en la obra y con una mano sola.
        const { error } = await db.from("agenda")
            .update({ estado: marcarHecho.dataset.estado === "hecho" ? "pendiente" : "hecho" })
            .eq("id", marcarHecho.dataset.hecho);
        if (error) return fallo(error, "cambiar el estado");
        return refrescarVistaActual();
    }
});

$(".contenido").addEventListener("change", async (ev) => {
    const check = ev.target.closest("[data-item]");
    if (!check) return;
    const { error } = await db.from("pedido_items")
        .update({ recibido: check.checked })
        .eq("id", check.dataset.item);
    if (error) return fallo(error, "actualizar el material");
    refrescarVistaActual();
});

$(".contenido").addEventListener("submit", async (ev) => {
    const form = ev.target.closest("[data-alta-item]");
    if (!form) return;
    ev.preventDefault();

    const datos = new FormData(form);
    const precio = datos.get("precio");
    const moneda = datos.get("moneda") || "ARS";

    const fila = {
        pedido_id: form.dataset.altaItem,
        material: datos.get("material").trim(),
        cantidad: Number(datos.get("cantidad")) || 1,
        unidad: (datos.get("unidad") || "u").trim() || "u",
        precio_unitario: precio === "" ? null : Number(precio),
        moneda,
        orden: Date.now() % 100000,
    };

    let { error } = await db.from("pedido_items").insert(fila);
    if (error && /moneda/i.test(error.message || "")) {
        if (moneda === "USD") {
            aviso("Para guardar materiales en dólares hay que correr la migración de moneda en Supabase.", true);
            return;
        }
        delete fila.moneda;
        ({ error } = await db.from("pedido_items").insert(fila));
    }

    if (error) return fallo(error, "agregar el material");
    refrescarVistaActual();
});

// ---------------------------------------------------------------------------
// Modal de alta y edición
// ---------------------------------------------------------------------------

// Un formulario declarado como datos en vez de cuatro bloques de HTML casi
// iguales. `par: true` significa que ese campo comparte renglón con el
// siguiente.
const FORMULARIOS = {
    agenda: {
        tabla: "agenda",
        titulo: { nuevo: "Nueva entrada", editar: "Editar entrada" },
        campos: [
            { n: "tipo", e: "Tipo", t: "select", ops: [["trabajo", "Trabajo"], ["reunion", "Reunión"]] },
            { n: "titulo", e: "Título", t: "text", req: true },
            { n: "obra_id", e: "Obra", t: "obra" },
            { n: "fecha", e: "Fecha (vacía = pendiente)", t: "date", par: true },
            { n: "estado", e: "Estado", t: "select", ops: [["pendiente", "Pendiente"], ["hecho", "Hecho"], ["cancelado", "Cancelado"]] },
            { n: "hora_inicio", e: "Desde", t: "time", par: true },
            { n: "hora_fin", e: "Hasta", t: "time" },
            { n: "lugar", e: "Lugar", t: "text" },
            { n: "notas", e: "Notas", t: "textarea" },
        ],
    },
    pago: {
        tabla: "pagos",
        titulo: { nuevo: "Nuevo pago", editar: "Editar pago" },
        campos: [
            { n: "tipo", e: "Tipo", t: "select", ops: [["cobro", "A cobrar"], ["gasto", "A pagar"]], par: true },
            { n: "estado", e: "Estado", t: "select", ops: [["pendiente", "Pendiente"], ["pagado", "Pagado"]] },
            { n: "concepto", e: "Concepto", t: "text", req: true },
            { n: "obra_id", e: "Obra", t: "obra" },
            { n: "monto", e: "Monto", t: "number", req: true, par: true },
            { n: "moneda", e: "Moneda", t: "select", ops: [["ARS", "Pesos"], ["USD", "Dólares"]] },
            { n: "vence", e: "Vence", t: "date", par: true },
            { n: "fecha_pago", e: "Fecha de pago", t: "date" },
            { n: "metodo", e: "Medio", t: "text" },
            { n: "notas", e: "Notas", t: "textarea" },
        ],
    },
    pedido: {
        tabla: "pedidos",
        titulo: { nuevo: "Nuevo pedido", editar: "Editar pedido" },
        campos: [
            { n: "proveedor", e: "Proveedor", t: "text", req: true },
            { n: "obra_id", e: "Obra", t: "obra" },
            { n: "estado", e: "Estado", t: "select", ops: [["borrador", "Borrador"], ["pedido", "Pedido"], ["recibido", "Recibido"], ["cancelado", "Cancelado"]] },
            { n: "fecha_pedido", e: "Fecha del pedido", t: "date", par: true },
            { n: "entrega_estimada", e: "Entrega estimada", t: "date" },
            { n: "notas", e: "Notas", t: "textarea" },
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

async function abrirModal(clave, id = null, valoresIniciales = {}) {
    const def = FORMULARIOS[clave];
    if (!def) return;

    let fila = { ...valoresIniciales };

    if (id) {
        const { data, error } = await db.from(def.tabla).select("*").eq("id", id).single();
        if (error) return fallo(error, "abrir el registro");
        fila = data;
    }

    modalActual = { clave, def, id };

    $("#modal-titulo").textContent = def.titulo[id ? "editar" : "nuevo"];
    $("#modal-form").innerHTML = armarCampos(def.campos, fila);
    $("#modal-borrar").hidden = !id;
    $("#modal-error").hidden = true;
    $("#modal-fondo").hidden = false;

    // El foco va al primer campo para poder escribir sin tocar el mouse.
    const primero = $("#modal-form input, #modal-form select, #modal-form textarea");
    if (primero) primero.focus();
}

function armarCampos(campos, fila) {
    let html = "";

    for (let i = 0; i < campos.length; i++) {
        const c = campos[i];
        if (c.par && campos[i + 1]) {
            html += `<div class="fila">${campoHTML(c, fila)}${campoHTML(campos[i + 1], fila)}</div>`;
            i++;
        } else {
            html += campoHTML(c, fila);
        }
    }
    return html;
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
        control = `<input id="${id}" name="${c.n}" type="number" step="0.01" min="0" value="${esc(valor)}" ${req}>`;
    } else {
        // Las horas vienen de Postgres como "14:30:00" y el input type=time
        // no acepta los segundos: los recorta.
        const v = c.t === "time" && valor ? String(valor).slice(0, 5) : valor;
        control = `<input id="${id}" name="${c.n}" type="${c.t}" value="${esc(v)}" ${req}>`;
    }

    return `<div><label for="${id}">${c.e}</label>${control}</div>`;
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
    if (ev.key === "Escape" && modalActual) cerrarModal();
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
    if (!form.reportValidity()) return;

    const { def, id, clave } = modalActual;
    const datos = {};
    const err = $("#modal-error");

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
        err.textContent = "La hora de fin tiene que ser posterior a la de inicio.";
        err.hidden = false;
        form.elements.hora_fin.focus();
        return;
    }

    if (clave === "pago" && datos.estado === "pagado" && !datos.fecha_pago) {
        datos.fecha_pago = HOY;
    }

    const boton = $("#modal-guardar");
    boton.disabled = true;

    const { error } = id
        ? await db.from(def.tabla).update(datos).eq("id", id)
        : await db.from(def.tabla).insert(datos);

    boton.disabled = false;

    if (error) {
        console.error("guardar", error);
        err.textContent = mensajeDeError(error);
        err.hidden = false;
        return;
    }

    cerrarModal();
    aviso("Guardado.");
    if (clave === "obra") await cargarObras();
    VISTAS[estado.vista]();
}

$("#modal-borrar").addEventListener("click", async () => {
    if (!modalActual || !modalActual.id) return;
    if (!confirm("¿Borrar este registro? No se puede deshacer.")) return;

    const { def, clave, id } = modalActual;
    const { error } = await db.from(def.tabla).delete().eq("id", id);
    if (error) return fallo(error, "borrar el registro");

    cerrarModal();
    aviso("Borrado.");
    if (clave === "obra") await cargarObras();
    VISTAS[estado.vista]();
});
