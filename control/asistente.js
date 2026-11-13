// Asistente del panel: texto, audio o foto.
//
// Tres reglas que ordenan todo este archivo:
//
// 1. La clave de la IA no está acá ni en ningún archivo del sitio. Los pedidos
//    van a una función del servidor (supabase/functions/asistente) que la
//    tiene como secreto, y que antes de usarla comprueba la sesión.
//
// 2. La IA propone y la persona confirma. La función devuelve una propuesta;
//    acá se muestra como tarjeta y recién al tocar "Guardar" o "Agendar" se
//    escribe en la base, con la sesión del usuario y bajo las mismas políticas
//    RLS que cualquier otro alta del panel.
//
// 3. Las cuentas las hace el código. El total de un pedido se suma acá a
//    partir de los renglones; nunca se le pide el resultado al modelo.

import { ico } from "./iconos.js";

const $ = (sel) => document.querySelector(sel);

// Dependencias que le pasa control.js al iniciar (la conexión a la base, los
// formateadores, el modal). Se inyectan en vez de importarse para no armar un
// ciclo entre los dos módulos.
let d = null;

// La conversación vive sólo en memoria: al recargar la página empieza de cero.
// Lo que importa (lo guardado) está en la base.
const charla = [];
let uso = null;
let ocupado = false;
let grabacion = null;
let enganchado = false;

const MAX_AUDIO_SEG = 60;
const LADO_MAX_FOTO = 1600;

const SUGERENCIAS = [
    "Reunión con el cliente mañana a las 10",
    "Anotá que me deben 500 mil del anticipo",
    "Cómo marco algo como cobrado",
];

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

export async function iniciarAsistente(dependencias) {
    d = dependencias;

    // La base decide si el asistente existe para este panel: es un opcional
    // que se contrata aparte. Si está apagado, si la consulta falla o si la
    // migración no corrió, la barra no aparece y el panel funciona igual.
    const { data, error } = await d.db.rpc("ia_estado");
    const est = Array.isArray(data) ? data[0] : data;
    if (error || !est || !est.activa) return;

    uso = { cargas: est.cargas, cupo: est.cupo_mensual };
    $("#asis-barra").hidden = false;
    document.body.classList.add("con-asistente");
    pintarUso();
    pintar();

    if (enganchado) return;
    enganchado = true;

    $("#asis-abrir").addEventListener("click", () => abrir(true));
    $("#asis-barra-foto").addEventListener("click", () => { abrir(); $("#asis-archivo").click(); });
    $("#asis-barra-mic").addEventListener("click", () => { abrir(); empezarGrabacion(); });
    $("#asis-cerrar").addEventListener("click", cerrarAsistente);
    $("#asis-fondo").addEventListener("click", (ev) => { if (ev.target === $("#asis-fondo")) cerrarAsistente(); });

    $("#asis-foto").addEventListener("click", () => $("#asis-archivo").click());
    $("#asis-mic").addEventListener("click", empezarGrabacion);
    $("#asis-grab-cancelar").addEventListener("click", () => terminarGrabacion(false));
    $("#asis-grab-enviar").addEventListener("click", () => terminarGrabacion(true));

    // Como en cualquier mensajero: con el campo vacío el botón es el
    // micrófono, y al escribir pasa a ser el de enviar.
    $("#asis-texto").addEventListener("input", alternarBotones);

    $("#asis-form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const texto = $("#asis-texto").value.trim();
        if (!texto || ocupado) return;
        $("#asis-texto").value = "";
        alternarBotones();
        enviar({ texto });
    });

    $("#asis-archivo").addEventListener("change", async (ev) => {
        const archivo = ev.target.files[0];
        // Se vacía para que elegir dos veces la misma foto vuelva a disparar
        // el evento.
        ev.target.value = "";
        if (!archivo || ocupado) return;
        try {
            const foto = await prepararFoto(archivo);
            enviar({ imagen: { mime: "image/jpeg", data: foto.data }, vista: { foto: foto.url } });
        } catch (e) {
            console.error("foto", e);
            decir("No pude abrir esa imagen. Probá con otra foto.", true);
        }
    });

    $("#asis-charla").addEventListener("click", alTocarCharla);
}

function alternarBotones() {
    const hayTexto = $("#asis-texto").value.trim() !== "";
    $("#asis-enviar").hidden = !hayTexto;
    $("#asis-mic").hidden = hayTexto;
}

function abrir(conTeclado = false) {
    $("#asis-fondo").hidden = false;
    document.body.classList.add("asis-abierto");
    pintar();
    if (conTeclado) $("#asis-texto").focus();
}

export function cerrarAsistente() {
    if (grabacion) terminarGrabacion(false);
    $("#asis-fondo").hidden = true;
    document.body.classList.remove("asis-abierto");
}

function pintarUso() {
    if (!uso) return;
    const el = $("#asis-uso");
    const quedan = Math.max(0, uso.cupo - uso.cargas);
    // El presupuesto dice que se avisa antes de llegar al límite: desde el
    // 80 % el contador pasa a decir cuántas quedan, en color de alerta.
    const cerca = uso.cupo > 0 && uso.cargas >= uso.cupo * 0.8;
    el.textContent = cerca
        ? (quedan === 0 ? "Sin cargas este mes" : `Quedan ${quedan} ${quedan === 1 ? "carga" : "cargas"}`)
        : `${uso.cargas} de ${uso.cupo} este mes`;
    el.classList.toggle("alerta", cerca);
    el.title = "Cargas del mes: audios y fotos. Escribir no consume.";
}

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

function decir(texto, error = false) {
    charla.push({ rol: "asistente", texto, error });
    pintar();
}

// Lo que viaja a la función como contexto: sólo texto, y sólo los últimos
// turnos. Sirve para correcciones del tipo "no, mejor a las 11".
function armarHistorial() {
    return charla
        .filter((m) => !m.pendiente && !m.error)
        .slice(-8)
        .map((m) => {
            if (m.rol === "usuario") {
                return { rol: "usuario", texto: m.texto || (m.foto ? "[mandó una foto]" : "[mandó un audio]") };
            }
            let texto = m.textoModelo || m.texto || "";
            if (m.propuesta) {
                texto += `\nPROPUESTA (${m.destino}): ${JSON.stringify(m.propuesta[m.destino])}`;
                texto += m.guardado ? "\n(La persona ya la guardó.)" : "\n(Todavía sin guardar.)";
            }
            return { rol: "asistente", texto };
        });
}

async function enviar({ texto = "", imagen = null, audio = null, vista = {} }) {
    if (ocupado) return;
    ocupado = true;

    const origen = imagen ? "foto" : audio ? "audio" : "texto";
    const historial = armarHistorial();
    const mio = { rol: "usuario", texto, ...vista };
    const espera = {
        rol: "asistente",
        pendiente: origen === "foto" ? "Leyendo la foto" : origen === "audio" ? "Escuchando" : "Pensando",
    };
    charla.push(mio, espera);
    pintar();

    let data = null;
    let mensajeError = "";

    try {
        const r = await d.db.functions.invoke("asistente", { body: { texto, imagen, audio, historial } });
        data = r.data;
        if (r.error) {
            // Cuando la función contesta con un error, el motivo viene en el
            // cuerpo de la respuesta y ya está escrito para mostrarse.
            const cuerpo = r.error.context && typeof r.error.context.json === "function"
                ? await r.error.context.json().catch(() => null)
                : null;
            mensajeError = cuerpo?.error || "No pude conectarme con el asistente. Fijate la señal y probá de nuevo.";
            if (cuerpo?.uso) { uso = cuerpo.uso; pintarUso(); }
            data = null;
        }
    } catch (e) {
        console.error("asistente", e);
        mensajeError = "No pude conectarme con el asistente. Fijate la señal y probá de nuevo.";
    }

    ocupado = false;
    espera.pendiente = null;

    if (!data || !data.ok || !data.propuesta) {
        Object.assign(espera, { texto: mensajeError || "Algo salió mal. Probá de nuevo.", error: true });
        return pintar();
    }

    const p = data.propuesta;
    if (p.transcripcion) mio.texto = p.transcripcion;
    if (data.uso) { uso = data.uso; pintarUso(); }

    if (p.tipo === "respuesta") {
        espera.texto = p.respuesta;
    } else {
        Object.assign(espera, {
            // La frase que se muestra arriba de una propuesta es fija. La que
            // escribe el modelo se guarda sólo como contexto: algún modelo de
            // respaldo dice "ya lo agendé", y eso acá sería mentira.
            texto: origen === "foto" ? "Leí el comprobante. Lo cargaría así:" : "Entendí esto:",
            textoModelo: p.respuesta,
            propuesta: p,
            destino: p.tipo,
        });
    }
    pintar();
}

function pintar() {
    const cont = $("#asis-charla");
    if (!cont) return;

    if (charla.length === 0) {
        cont.innerHTML = `
            <div class="asis-vacio">
                <p class="asis-vacio-titulo">Decime qué anotar, o mandame la foto de una factura o un remito.</p>
                <p class="asis-vacio-sub">Te muestro lo que entendí y vos decidís si se guarda.</p>
                ${SUGERENCIAS.map((s) => `<button class="asis-sugerencia" data-asis-sugerir="${d.esc(s)}">${d.esc(s)}</button>`).join("")}
            </div>`;
        return;
    }

    cont.innerHTML = charla.map((m, i) => {
        if (m.rol === "usuario") {
            if (m.foto) return `<div class="burbuja mia foto"><img src="${m.foto}" alt="Foto enviada"></div>`;
            const audio = m.audioSeg ? `<span class="burbuja-audio">${ico("mic")} ${minSeg(m.audioSeg)}</span>` : "";
            return `<div class="burbuja mia">${audio}${m.texto ? `<span>${d.esc(m.texto)}</span>` : ""}</div>`;
        }
        if (m.pendiente) {
            return `<div class="burbuja suya pensando">${d.esc(m.pendiente)}<span class="puntos"><i></i><i></i><i></i></span></div>`;
        }
        return `
            <div class="burbuja suya ${m.error ? "error" : ""}">${d.esc(m.texto)}</div>
            ${m.propuesta ? tarjeta(m, i) : ""}`;
    }).join("");

    cont.scrollTop = cont.scrollHeight;
}

const minSeg = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Tarjetas de propuesta
// ---------------------------------------------------------------------------

const DESTINOS = {
    agenda: { vista: "agenda", nombre: "Agenda", guardar: "Agendar" },
    pago: { vista: "pagos", nombre: "Pagos", guardar: "Guardar" },
    pedido: { vista: "pedidos", nombre: "Pedidos", guardar: "Guardar" },
};

function totalPedido(items) {
    const t = { ARS: 0, USD: 0 };
    for (const i of items) t[i.moneda === "USD" ? "USD" : "ARS"] += (Number(i.precio_unitario) || 0) * Number(i.cantidad);
    return ["ARS", "USD"].filter((m) => t[m] > 0).map((m) => d.plata(t[m], m)).join(" + ");
}

// Qué le falta a una propuesta para poder guardarse de un toque. Si falta
// algo, el botón principal pasa a ser "Completar" y abre el formulario.
function faltante(m) {
    const p = m.propuesta;
    if (m.destino === "pago" && p.pago.monto === null) return "Falta el monto";
    if (m.destino === "pedido" && p.pedido.items.length === 0) return "No tiene materiales";
    return "";
}

function tarjeta(m, i) {
    const p = m.propuesta;
    const dato = (texto) => (texto ? `<p class="tarjeta-dato">${d.esc(texto)}</p>` : "");
    let cuerpo = "";

    if (m.destino === "agenda") {
        const a = p.agenda;
        const hora = a.hora_inicio ? a.hora_inicio + (a.hora_fin ? "–" + a.hora_fin : "") : "";
        cuerpo = `
            <p class="tarjeta-clase">${a.tipo === "reunion" ? "Reunión" : "Tarea"}</p>
            <p class="tarjeta-titulo">${d.esc(a.titulo)}</p>
            ${dato(a.fecha ? [d.fechaLarga(a.fecha), hora].filter(Boolean).join(" · ") : "Sin día: queda en Pendientes")}
            ${dato(a.lugar)}
            ${dato(a.obra_id ? "Obra: " + d.nombreObra(a.obra_id) : "")}
            ${dato(a.notas)}`;
    } else if (m.destino === "pago") {
        const g = p.pago;
        const cobro = g.tipo === "cobro";
        const clase = g.estado === "pagado" ? (cobro ? "Cobro ya cobrado" : "Gasto ya pagado") : (cobro ? "Te deben" : "Tenés que pagar");
        cuerpo = `
            <p class="tarjeta-clase">${clase}</p>
            <p class="tarjeta-monto ${g.monto === null ? "falta" : ""}">${g.monto === null ? "Falta el monto" : d.plata(g.monto, g.moneda)}</p>
            <p class="tarjeta-titulo">${d.esc(g.concepto)}</p>
            ${dato(g.vence ? "Vence el " + d.fechaLarga(g.vence).toLowerCase() : "")}
            ${dato(g.fecha_pago ? "Pagado el " + d.fechaLarga(g.fecha_pago).toLowerCase() : "")}
            ${dato(g.obra_id ? "Obra: " + d.nombreObra(g.obra_id) : "")}
            ${dato([g.metodo, g.notas].filter(Boolean).join(" · "))}`;
    } else {
        const q = p.pedido;
        const total = totalPedido(q.items);
        cuerpo = `
            <p class="tarjeta-clase">Pedido${q.estado === "borrador" ? " en borrador" : q.estado === "recibido" ? " ya recibido" : " en camino"}</p>
            <p class="tarjeta-titulo">${d.esc(q.proveedor || "Sin proveedor")}</p>
            <ul class="tarjeta-items">
                ${q.items.map((it, j) => `
                <li>
                    <span class="tarjeta-item-nombre">${d.esc(it.material)}</span>
                    <span class="tarjeta-item-detalle">${Number(it.cantidad)} ${d.esc(it.unidad)}${it.precio_unitario !== null ? " · " + d.plata(it.precio_unitario * it.cantidad, it.moneda) : ""}</span>
                    ${m.guardado ? "" : `<button class="tarjeta-quitar" data-asis-quitar="${i}:${j}" aria-label="Quitar ${d.esc(it.material)}">${ico("cerrar")}</button>`}
                </li>`).join("")}
            </ul>
            ${total ? `<p class="tarjeta-total">Total ${total}</p>` : ""}
            ${dato(q.obra_id ? "Obra: " + d.nombreObra(q.obra_id) : "")}
            ${dato(q.notas)}`;
    }

    // Una factura de corralón sirve para dos cosas: anotar el gasto o cargar
    // el pedido con sus materiales. La IA sugiere una; elige la persona.
    const selector = p.pago && p.pedido && !m.guardado ? `
        <div class="tarjeta-destino" role="group" aria-label="Dónde cargarlo">
            <button class="${m.destino === "pago" ? "activo" : ""}" data-asis-destino="${i}:pago">Como gasto</button>
            <button class="${m.destino === "pedido" ? "activo" : ""}" data-asis-destino="${i}:pedido">Como pedido</button>
        </div>` : "";

    const dest = DESTINOS[m.destino];
    const falta = faltante(m);
    let pie;

    if (m.guardado) {
        pie = `
            <p class="tarjeta-guardado">${ico("tilde")} Guardado en ${dest.nombre}</p>
            <button class="btn btn-fantasma" data-ir="${dest.vista}">Ver</button>`;
    } else {
        pie = `
            ${falta
                ? `<button class="btn btn-primario" data-asis-corregir="${i}">Completar</button>`
                : `<button class="btn btn-primario" data-asis-guardar="${i}" ${m.guardando ? "disabled" : ""}>${m.guardando ? "Guardando..." : dest.guardar}</button>
                   <button class="btn btn-fantasma" data-asis-corregir="${i}">Corregir</button>`}`;
    }

    return `
        <div class="tarjeta ${m.guardado ? "guardada" : ""}">
            ${selector}
            ${cuerpo}
            ${m.falla ? `<p class="tarjeta-falla">${d.esc(m.falla)}</p>` : ""}
            <div class="tarjeta-pie">${pie}</div>
        </div>`;
}

function alTocarCharla(ev) {
    const sugerir = ev.target.closest("[data-asis-sugerir]");
    if (sugerir) return enviar({ texto: sugerir.dataset.asisSugerir });

    const destino = ev.target.closest("[data-asis-destino]");
    if (destino) {
        const [i, cual] = destino.dataset.asisDestino.split(":");
        charla[i].destino = cual;
        charla[i].falla = "";
        return pintar();
    }

    const quitar = ev.target.closest("[data-asis-quitar]");
    if (quitar) {
        const [i, j] = quitar.dataset.asisQuitar.split(":").map(Number);
        charla[i].propuesta.pedido.items.splice(j, 1);
        return pintar();
    }

    const guardar = ev.target.closest("[data-asis-guardar]");
    if (guardar) return guardarPropuesta(Number(guardar.dataset.asisGuardar));

    const corregir = ev.target.closest("[data-asis-corregir]");
    if (corregir) return corregirPropuesta(Number(corregir.dataset.asisCorregir));
}

// Los campos que van a la base, sacados de la propuesta. Un pago marcado como
// pagado sin fecha toma la de hoy, igual que cuando se carga a mano.
function filaAgenda(a) {
    return {
        tipo: a.tipo, titulo: a.titulo, fecha: a.fecha, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
        lugar: a.lugar, obra_id: a.obra_id, notas: a.notas, estado: "pendiente",
    };
}

function filaPago(g) {
    return {
        tipo: g.tipo, concepto: g.concepto, monto: g.monto, moneda: g.moneda, estado: g.estado,
        vence: g.vence, fecha_pago: g.estado === "pagado" ? (g.fecha_pago || d.hoyISO()) : null,
        metodo: g.metodo, obra_id: g.obra_id, notas: g.notas,
    };
}

function filaPedido(q) {
    return {
        proveedor: q.proveedor, estado: q.estado, fecha_pedido: q.fecha_pedido,
        entrega_estimada: q.entrega_estimada, obra_id: q.obra_id, notas: q.notas,
    };
}

// El pedido y sus materiales entran juntos o no entran: lo resuelve una
// función de la base en una sola transacción.
const crearPedido = (pedido, items) =>
    d.db.rpc("crear_pedido_con_items", { p_pedido: pedido, p_items: items });

async function guardarPropuesta(i) {
    const m = charla[i];
    if (!m || m.guardado || m.guardando) return;
    m.guardando = true;
    m.falla = "";
    pintar();

    const p = m.propuesta;
    let error;
    if (m.destino === "agenda") ({ error } = await d.db.from("agenda").insert(filaAgenda(p.agenda)));
    else if (m.destino === "pago") ({ error } = await d.db.from("pagos").insert(filaPago(p.pago)));
    else ({ error } = await crearPedido(filaPedido(p.pedido), p.pedido.items));

    m.guardando = false;
    if (error) {
        console.error("guardar propuesta", error);
        m.falla = d.mensajeDeError(error);
    } else {
        m.guardado = true;
        d.refrescar();
    }
    pintar();
}

// "Corregir" abre el mismo formulario de siempre, ya completo con lo que leyó
// la IA. Lo que se guarda es lo que queda escrito ahí, no la propuesta.
function corregirPropuesta(i) {
    const m = charla[i];
    if (!m || m.guardado) return;
    const p = m.propuesta;
    const alGuardar = () => { m.guardado = true; m.falla = ""; pintar(); };

    if (m.destino === "agenda") return d.abrirModal("agenda", null, filaAgenda(p.agenda), { alGuardar });
    if (m.destino === "pago") return d.abrirModal("pago", null, filaPago(p.pago), { alGuardar });
    return d.abrirModal("pedido", null, filaPedido(p.pedido), {
        alGuardar,
        guardar: (datos) => crearPedido(datos, p.pedido.items),
    });
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

function aBase64(blob) {
    return new Promise((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(String(lector.result).split(",")[1]);
        lector.onerror = () => mal(lector.error);
        lector.readAsDataURL(blob);
    });
}

// La cámara de un teléfono saca fotos de 4 a 12 MB. Para leer una factura
// alcanza con 1600 px de lado: se achica acá, antes de subirla, y con eso el
// envío pesa unos cientos de KB aunque la señal sea mala.
async function prepararFoto(archivo) {
    const origen = URL.createObjectURL(archivo);
    try {
        const img = await new Promise((ok, mal) => {
            const el = new Image();
            el.onload = () => ok(el);
            el.onerror = () => mal(new Error("imagen ilegible"));
            el.src = origen;
        });

        const escala = Math.min(1, LADO_MAX_FOTO / Math.max(img.naturalWidth, img.naturalHeight));
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
        lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
        const ctx = lienzo.getContext("2d");
        // Fondo blanco: un PNG con transparencia pasado a JPG quedaría negro.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);

        const blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.82));
        if (!blob) throw new Error("no se pudo convertir");
        return { data: await aBase64(blob), url: URL.createObjectURL(blob) };
    } finally {
        URL.revokeObjectURL(origen);
    }
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

async function empezarGrabacion() {
    if (ocupado || grabacion) return;

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        return decir("Este navegador no deja grabar audio. Podés escribirlo.", true);
    }

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
        return decir("No tengo permiso para usar el micrófono. Habilitalo en el navegador y probá de nuevo, o escribilo.", true);
    }

    const rec = new MediaRecorder(stream);
    const partes = [];
    rec.ondataavailable = (ev) => { if (ev.data.size) partes.push(ev.data); };
    rec.onstop = () => alTerminarGrabacion(partes);

    grabacion = { rec, stream, inicio: Date.now(), enviar: false, reloj: null };
    grabacion.reloj = setInterval(() => {
        const seg = Math.floor((Date.now() - grabacion.inicio) / 1000);
        $("#asis-grab-tiempo").textContent = minSeg(seg);
        // Tope de un minuto: alcanza para dictar cualquier cosa y mantiene el
        // envío liviano.
        if (seg >= MAX_AUDIO_SEG) terminarGrabacion(true);
    }, 250);

    $("#asis-grab-tiempo").textContent = "0:00";
    $("#asis-form").hidden = true;
    $("#asis-grabando").hidden = false;
    rec.start();
}

function terminarGrabacion(enviarla) {
    if (!grabacion) return;
    grabacion.enviar = enviarla;
    clearInterval(grabacion.reloj);
    if (grabacion.rec.state !== "inactive") grabacion.rec.stop();
    // Apagar el micrófono: si no, el teléfono deja el indicador de grabación
    // prendido.
    grabacion.stream.getTracks().forEach((t) => t.stop());
}

async function alTerminarGrabacion(partes) {
    const g = grabacion;
    grabacion = null;
    $("#asis-grabando").hidden = true;
    $("#asis-form").hidden = false;
    if (!g || !g.enviar) return;

    const seg = Math.round((Date.now() - g.inicio) / 1000);
    const blob = new Blob(partes, { type: g.rec.mimeType || "audio/webm" });
    if (seg < 1 || blob.size === 0) return decir("El audio quedó muy corto. Mantené unos segundos y probá de nuevo.", true);

    let audio;
    try {
        audio = { mime: "audio/wav", data: await aBase64(await aWav(blob)) };
    } catch (e) {
        // Si el navegador no pudo decodificar su propia grabación, va tal
        // cual: la función acepta también webm y mp4.
        console.warn("audio sin convertir", e);
        audio = { mime: (blob.type || "audio/webm").split(";")[0], data: await aBase64(blob) };
    }
    enviar({ audio, vista: { audioSeg: seg } });
}

// Cada navegador graba en un formato distinto (webm en Android, mp4 en
// iPhone). Para no depender de cuál acepta el modelo, todo se pasa a WAV mono
// de 16 kHz, que es lo que pide el reconocimiento de voz y pesa 32 KB por
// segundo.
async function aWav(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
        const crudo = await blob.arrayBuffer();
        // Con callbacks además de la promesa: Safari viejo sólo tiene los
        // callbacks.
        const buf = await new Promise((ok, mal) => {
            const promesa = ctx.decodeAudioData(crudo, ok, mal);
            if (promesa && promesa.catch) promesa.catch(mal);
        });

        const destino = 16000;
        const paso = buf.sampleRate / destino;
        const largo = Math.floor(buf.length / paso);
        const canales = [];
        for (let c = 0; c < buf.numberOfChannels; c++) canales.push(buf.getChannelData(c));

        // Se promedian las muestras de cada tramo (y de todos los canales):
        // es un filtro simple, suficiente para voz.
        const pcm = new Int16Array(largo);
        for (let i = 0; i < largo; i++) {
            const desde = Math.floor(i * paso);
            const hasta = Math.max(desde + 1, Math.min(buf.length, Math.floor((i + 1) * paso)));
            let suma = 0;
            for (let j = desde; j < hasta; j++) for (const canal of canales) suma += canal[j];
            const v = suma / ((hasta - desde) * canales.length);
            pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
        }

        const cab = new DataView(new ArrayBuffer(44));
        const letras = (pos, t) => { for (let k = 0; k < t.length; k++) cab.setUint8(pos + k, t.charCodeAt(k)); };
        letras(0, "RIFF");
        cab.setUint32(4, 36 + pcm.byteLength, true);
        letras(8, "WAVEfmt ");
        cab.setUint32(16, 16, true);
        cab.setUint16(20, 1, true);            // PCM
        cab.setUint16(22, 1, true);            // mono
        cab.setUint32(24, destino, true);
        cab.setUint32(28, destino * 2, true);  // bytes por segundo
        cab.setUint16(32, 2, true);
        cab.setUint16(34, 16, true);
        letras(36, "data");
        cab.setUint32(40, pcm.byteLength, true);

        return new Blob([cab, pcm], { type: "audio/wav" });
    } finally {
        if (ctx.close) ctx.close();
    }
}
