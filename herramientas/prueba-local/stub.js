// Doble de supabase-js para probar el panel sin contraseña y sin tocar la base.
//
// Imita lo que usa control.js: consultas encadenables, altas, cambios y bajas,
// las dos funciones de la base y la llamada al asistente. Los datos viven en
// memoria y se pierden al recargar. Las fechas se arman alrededor de hoy para
// que la pantalla "Hoy" siempre tenga algo.
//
// También imita los NOT NULL y los CHECK de las migraciones, con el mismo
// texto de error que devuelve Postgres: así se ve cómo el panel muestra un
// error real.

const ISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ISO(d); };

let sec = 0;
const nuevoId = () => `id-${++sec}`;
const ahora = () => new Date().toISOString();

const O = { mendoza: "obra-mendoza", bahia: "obra-bahia", rossi: "obra-rossi", guemes: "obra-guemes" };

const tablas = {
    miembros: [{ user_id: "u-prueba", email: "prueba@local", nombre: "Prueba" }],
    obras: [
        { id: O.mendoza, nombre: "Casa Mendoza", cliente: "Familia Mendoza", estado: "activa", notas: "Vivienda en dos plantas" },
        { id: O.bahia, nombre: "Local Bahia Shoes", cliente: "Bahia Shoes", estado: "activa", notas: null },
        { id: O.rossi, nombre: "Oficinas Rossi", cliente: "Rossi Hnos", estado: "activa", notas: null },
        { id: O.guemes, nombre: "Reforma Güemes 1450", cliente: null, estado: "pausada", notas: null },
    ],
    agenda: [
        ["reunion", "Reunión con Mendoza", O.mendoza, 0, "09:30", "10:30", "Estudio", "pendiente"],
        ["reunion", "Visita a obra Güemes", O.guemes, 0, "11:00", null, "Güemes 1450", "pendiente"],
        ["trabajo", "Pasar presupuesto de aberturas", O.mendoza, 0, null, null, null, "pendiente"],
        ["trabajo", "Llamar al gasista", null, 0, null, null, null, "hecho"],
        ["trabajo", "Entregar planos municipales", O.bahia, -3, null, null, null, "pendiente"],
        ["trabajo", "Reclamar factura del electricista", O.rossi, -1, null, null, null, "pendiente"],
        ["trabajo", "Elegir revestimiento del baño", O.mendoza, null, null, null, null, "pendiente"],
        ["trabajo", "Renovar matrícula", null, null, null, null, null, "pendiente"],
        ["reunion", "Reunión con Rossi", O.rossi, 1, "10:00", "11:00", "Oficinas Rossi", "pendiente"],
        ["trabajo", "Medir local Bahia", O.bahia, 2, "15:00", null, null, "pendiente"],
        ["reunion", "Almuerzo con el contador", null, 4, "13:00", null, null, "pendiente"],
        ["trabajo", "Cómputo de materiales", O.mendoza, 5, null, null, null, "pendiente"],
    ].map(([tipo, titulo, obra_id, n, hora_inicio, hora_fin, lugar, estado]) => ({
        id: nuevoId(), tipo, titulo, obra_id, fecha: n === null ? null : dia(n),
        hora_inicio: hora_inicio && hora_inicio + ":00", hora_fin: hora_fin && hora_fin + ":00",
        lugar, estado, notas: null, creado: ahora(),
    })),
    pagos: [
        ["cobro", "Anticipo proyecto", O.mendoza, 1800000, "ARS", "pendiente", 6, null, null],
        ["cobro", "Honorarios dirección de obra", O.bahia, 650000, "ARS", "pendiente", -4, null, null],
        ["cobro", "Proyecto ejecutivo", O.rossi, 2500, "USD", "pendiente", 15, null, null],
        ["gasto", "Factura corralón", O.mendoza, 380000, "ARS", "pendiente", 3, null, null],
        ["gasto", "Honorarios calculista", O.rossi, 220000, "ARS", "pendiente", null, null, null],
        ["cobro", "Seña anteproyecto", O.rossi, 900000, "ARS", "pagado", null, -5, "Transferencia"],
        ["gasto", "Ploteo de planos", null, 45000, "ARS", "pagado", null, -2, "Efectivo"],
    ].map(([tipo, concepto, obra_id, monto, moneda, estado, vence, pago, metodo]) => ({
        id: nuevoId(), tipo, concepto, obra_id, monto, moneda, estado,
        vence: vence === null ? null : dia(vence), fecha_pago: pago === null ? null : dia(pago),
        metodo, notas: null, creado: ahora(),
    })),
    pedidos: [
        { id: "ped-1", obra_id: O.mendoza, proveedor: "Corralón San Martín", estado: "pedido", fecha_pedido: dia(-2), entrega_estimada: dia(1), notas: null, creado: ahora() },
        { id: "ped-2", obra_id: O.bahia, proveedor: "Aberturas del Oeste", estado: "borrador", fecha_pedido: null, entrega_estimada: null, notas: "Falta confirmar medidas", creado: ahora() },
        { id: "ped-3", obra_id: O.rossi, proveedor: "Electricidad Chivilcoy", estado: "recibido", fecha_pedido: dia(-10), entrega_estimada: dia(-6), notas: null, creado: ahora() },
    ],
    pedido_items: [
        ["ped-1", "Cemento Loma Negra x 50 kg", 20, "bolsa", 9500, "ARS", true],
        ["ped-1", "Arena fina", 3, "m3", 28000, "ARS", true],
        ["ped-1", "Hierro aletado 8 mm", 40, "barra", 7200, "ARS", true],
        ["ped-1", "Ladrillo hueco 12x18x33", 500, "u", 520, "ARS", false],
        ["ped-1", "Cal hidratada", 10, "bolsa", null, "ARS", false],
        ["ped-2", "Ventana aluminio 150x110", 4, "u", 310, "USD", false],
        ["ped-2", "Puerta balcón 200x205", 1, "u", 620, "USD", false],
        ["ped-3", "Cable 2,5 mm x 100 m", 3, "rollo", 62000, "ARS", true],
        ["ped-3", "Térmica 2x16", 6, "u", 9800, "ARS", true],
    ].map(([pedido_id, material, cantidad, unidad, precio_unitario, moneda, recibido], i) => ({
        id: nuevoId(), pedido_id, material, cantidad, unidad, precio_unitario, moneda, recibido, orden: i,
    })),
    ia_ajustes: [{ id: true, activa: true, cupo_mensual: 100, cupo_texto: 1000 }],
    ia_usos: Array.from({ length: 12 }, () => ({ tipo: "foto" })),
};

// Para mirar o tocar los datos desde la consola mientras se prueba.
window.__tablas = tablas;

// --- Restricciones de la base ---------------------------------------------

const OBLIGATORIOS = { obras: ["nombre"], agenda: ["titulo"], pagos: ["concepto", "monto"], pedido_items: ["material", "pedido_id"] };
const OPCIONES = {
    obras: { estado: ["activa", "pausada", "terminada"] },
    agenda: { tipo: ["reunion", "trabajo"], estado: ["pendiente", "hecho", "cancelado"] },
    pagos: { tipo: ["cobro", "gasto"], moneda: ["ARS", "USD"], estado: ["pendiente", "pagado"] },
    pedidos: { estado: ["borrador", "pedido", "recibido", "cancelado"] },
    pedido_items: { moneda: ["ARS", "USD"] },
};
const DEFECTOS = {
    obras: { estado: "activa" }, agenda: { tipo: "trabajo", estado: "pendiente" },
    pagos: { tipo: "cobro", moneda: "ARS", estado: "pendiente" }, pedidos: { estado: "borrador" },
    pedido_items: { cantidad: 1, unidad: "u", moneda: "ARS", recibido: false, orden: 0 },
};

function revisar(tabla, fila) {
    for (const c of OBLIGATORIOS[tabla] || []) {
        if (fila[c] === null || fila[c] === undefined) return `null value in column "${c}" of relation "${tabla}" violates not-null constraint`;
    }
    for (const [c, validas] of Object.entries(OPCIONES[tabla] || {})) {
        if (fila[c] !== undefined && fila[c] !== null && !validas.includes(fila[c])) {
            return `new row for relation "${tabla}" violates check constraint "${tabla}_${c}_check"`;
        }
    }
    if (tabla === "pagos" && !(Number(fila.monto) >= 0)) return `new row for relation "pagos" violates check constraint "pagos_monto_check"`;
    if (tabla === "pedido_items" && !(Number(fila.cantidad) > 0)) return `new row for relation "pedido_items" violates check constraint "pedido_items_cantidad_check"`;
    return null;
}

// --- Consultas --------------------------------------------------------------

const pausa = (v) => new Promise((ok) => setTimeout(() => ok(v), 60));

class Consulta {
    constructor(tabla) {
        this.tabla = tabla;
        this.op = "select";
        this.filtros = [];
        this.ordenes = [];
        this.tope = null;
        this.uno = false;
        this.columnas = "*";
    }

    select(columnas = "*") { if (this.op === "select") this.columnas = columnas; return this; }
    insert(v) { this.op = "insert"; this.valores = Array.isArray(v) ? v : [v]; return this; }
    update(v) { this.op = "update"; this.valores = v; return this; }
    delete() { this.op = "delete"; return this; }

    eq(c, v) { this.filtros.push((f) => f[c] === v); return this; }
    gte(c, v) { this.filtros.push((f) => f[c] !== null && f[c] >= v); return this; }
    lte(c, v) { this.filtros.push((f) => f[c] !== null && f[c] <= v); return this; }
    gt(c, v) { this.filtros.push((f) => f[c] !== null && f[c] > v); return this; }
    lt(c, v) { this.filtros.push((f) => f[c] !== null && f[c] < v); return this; }

    // Alcanza con lo que usa el panel: "col.is.null" y "col.lt.valor".
    or(expresion) {
        const partes = expresion.split(",").map((p) => {
            const [c, op, ...resto] = p.split(".");
            const v = resto.join(".");
            if (op === "is") return (f) => f[c] === null;
            if (op === "lt") return (f) => f[c] !== null && f[c] < v;
            if (op === "gt") return (f) => f[c] !== null && f[c] > v;
            return (f) => String(f[c]) === v;
        });
        this.filtros.push((f) => partes.some((p) => p(f)));
        return this;
    }

    order(c, { ascending = true, nullsFirst } = {}) {
        // Igual que Postgres: los null van al final en ascendente y al
        // principio en descendente, salvo que se diga otra cosa.
        this.ordenes.push({ c, ascending, nullsFirst: nullsFirst ?? !ascending });
        return this;
    }

    limit(n) { this.tope = n; return this; }
    single() { this.uno = true; return this; }

    then(ok, mal) { return pausa().then(() => this.ejecutar()).then(ok, mal); }

    ejecutar() {
        const filas = tablas[this.tabla];
        if (!filas) return { data: null, error: { message: `relation "${this.tabla}" does not exist` } };
        const coincide = (f) => this.filtros.every((x) => x(f));

        if (this.op === "insert") {
            const nuevas = this.valores.map((v) => ({ id: nuevoId(), creado: ahora(), ...DEFECTOS[this.tabla], ...v }));
            for (const n of nuevas) {
                const problema = revisar(this.tabla, n);
                if (problema) return { data: null, error: { message: problema } };
            }
            filas.push(...nuevas);
            return { data: null, error: null };
        }

        if (this.op === "update") {
            for (const f of filas.filter(coincide)) {
                const problema = revisar(this.tabla, { ...f, ...this.valores });
                if (problema) return { data: null, error: { message: problema } };
                Object.assign(f, this.valores);
            }
            return { data: null, error: null };
        }

        if (this.op === "delete") {
            const quedan = filas.filter((f) => !coincide(f));
            const idsBorrados = filas.filter(coincide).map((f) => f.id);
            filas.length = 0;
            filas.push(...quedan);
            // on delete cascade / set null, como en las migraciones.
            if (this.tabla === "pedidos") tablas.pedido_items = tablas.pedido_items.filter((i) => !idsBorrados.includes(i.pedido_id));
            if (this.tabla === "obras") {
                for (const t of ["agenda", "pagos", "pedidos"]) {
                    for (const f of tablas[t]) if (idsBorrados.includes(f.obra_id)) f.obra_id = null;
                }
            }
            return { data: null, error: null };
        }

        let data = filas.filter(coincide).map((f) => ({ ...f }));

        for (const { c, ascending, nullsFirst } of this.ordenes.slice().reverse()) {
            data.sort((a, b) => {
                if (a[c] === b[c]) return 0;
                if (a[c] === null || a[c] === undefined) return nullsFirst ? -1 : 1;
                if (b[c] === null || b[c] === undefined) return nullsFirst ? 1 : -1;
                return (a[c] < b[c] ? -1 : 1) * (ascending ? 1 : -1);
            });
        }

        if (this.tabla === "pedidos" && this.columnas.includes("pedido_items")) {
            for (const p of data) p.pedido_items = tablas.pedido_items.filter((i) => i.pedido_id === p.id).map((i) => ({ ...i }));
        }

        if (this.tope !== null) data = data.slice(0, this.tope);

        if (this.uno) {
            return data.length === 1
                ? { data: data[0], error: null }
                : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        }
        return { data, error: null };
    }
}

// --- Funciones de la base ---------------------------------------------------

const RPC = {
    ia_estado() {
        const a = tablas.ia_ajustes[0];
        return { data: [{
            activa: a.activa, cupo_mensual: a.cupo_mensual, cupo_texto: a.cupo_texto,
            cargas: tablas.ia_usos.filter((u) => u.tipo !== "texto").length,
            textos: tablas.ia_usos.filter((u) => u.tipo === "texto").length,
        }], error: null };
    },

    // Todo o nada, como la función real: si un renglón no pasa, no queda nada.
    crear_pedido_con_items({ p_pedido, p_items }) {
        const pedido = { id: nuevoId(), creado: ahora(), ...DEFECTOS.pedidos, ...p_pedido, proveedor: p_pedido.proveedor || null };
        let problema = revisar("pedidos", pedido);
        const items = (p_items || []).map((i, n) => ({
            id: nuevoId(), pedido_id: pedido.id, ...DEFECTOS.pedido_items, ...i,
            material: (i.material || "").trim() || null, orden: n + 1,
        }));
        for (const i of items) problema = problema || revisar("pedido_items", i);
        if (problema) return { data: null, error: { message: problema } };
        tablas.pedidos.push(pedido);
        tablas.pedido_items.push(...items);
        return { data: pedido.id, error: null };
    },
};

// --- Muestras del asistente -------------------------------------------------

// Respuestas fijas para cuando no está el servidor de prueba. Tienen la misma
// forma que devuelve la función real (son lecturas reales de Gemini sobre una
// factura y un audio de ejemplo), pero no leen lo que se les manda.
function muestra(tipo, texto) {
    const base = { respuesta: "", transcripcion: null, agenda: null, pago: null, pedido: null };

    if (tipo === "foto") {
        return {
            ...base, tipo: "pago",
            respuesta: "Leí una factura de Corralón San Martín por $ 822.000 para la obra Casa Mendoza.",
            pago: {
                tipo: "gasto", concepto: "Factura Corralón San Martín", monto: 822000, moneda: "ARS", estado: "pendiente",
                vence: dia(7), fecha_pago: null, metodo: "Cuenta corriente", obra_id: O.mendoza, notas: "Factura B N° 0003-00012457",
            },
            pedido: {
                proveedor: "Corralón San Martín S.R.L.", estado: "pedido", fecha_pedido: dia(-1), entrega_estimada: null,
                obra_id: O.mendoza, notas: "Factura N° 0003-00012457",
                items: [
                    { material: "Cemento Loma Negra x 50 kg (bolsa)", cantidad: 20, unidad: "bolsa", precio_unitario: 9500, moneda: "ARS" },
                    { material: "Arena fina x m3", cantidad: 3, unidad: "m3", precio_unitario: 28000, moneda: "ARS" },
                    { material: "Hierro aletado 8 mm x 12 m (barra)", cantidad: 40, unidad: "barra", precio_unitario: 7200, moneda: "ARS" },
                    { material: "Ladrillo hueco 12x18x33", cantidad: 500, unidad: "u", precio_unitario: 520, moneda: "ARS" },
                ],
            },
        };
    }

    if (tipo === "texto" && /c[oó]mo|\?/i.test(texto)) {
        return { ...base, tipo: "respuesta", respuesta: 'En "Pagos", tocá el círculo del movimiento: queda marcado como cobrado con la fecha de hoy.' };
    }

    if (tipo === "texto" && /deb|pag|cobr|mil|\$/i.test(texto)) {
        return {
            ...base, tipo: "pago", respuesta: "Entendí un cobro pendiente de $ 500.000.",
            pago: {
                tipo: "cobro", concepto: "Anticipo", monto: 500000, moneda: "ARS", estado: "pendiente",
                vence: null, fecha_pago: null, metodo: null, obra_id: null, notas: null,
            },
        };
    }

    return {
        ...base, tipo: "agenda",
        respuesta: "Entendí una reunión con Rossi mañana a las 10 en el estudio.",
        transcripcion: tipo === "audio" ? "Agendame una reunión con Rossi mañana a las diez en el estudio." : null,
        agenda: {
            tipo: "reunion", titulo: "Reunión con Rossi", fecha: dia(1), hora_inicio: "10:00", hora_fin: null,
            lugar: "Estudio", obra_id: O.rossi, notas: null,
        },
    };
}

// --- Cliente ----------------------------------------------------------------

export function createClient() {
    const sesion = { user: { id: "u-prueba", email: "prueba@local" } };
    let avisar = () => {};

    return {
        from: (tabla) => new Consulta(tabla),

        rpc: (nombre, args = {}) => pausa().then(() =>
            RPC[nombre] ? RPC[nombre](args) : { data: null, error: { message: `function ${nombre} does not exist` } }),

        functions: {
            // El asistente no se imita: va al servidor de prueba, que usa el
            // mismo núcleo que la función desplegada y llama a Gemini de
            // verdad. Lo que sí se imita es el cupo.
            async invoke(_nombre, { body }) {
                const tipo = body.imagen ? "foto" : body.audio ? "audio" : "texto";
                const estado = RPC.ia_estado().data[0];
                const respuesta = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

                if (tipo !== "texto" && estado.cargas >= estado.cupo_mensual) {
                    return { data: null, error: { context: respuesta(429, {
                        ok: false, error: `Ya se usaron las ${estado.cupo_mensual} cargas de este mes. Avisanos y lo ampliamos.`,
                        uso: { cargas: estado.cargas, cupo: estado.cupo_mensual },
                    }) } };
                }

                let r;
                try {
                    if (window.__SIN_SERVIDOR) throw new Error("sin servidor");
                    r = await fetch("/__prueba/asistente", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ...body, obras: tablas.obras }),
                    });
                } catch (e) {
                    if (!window.__SIN_SERVIDOR) return { data: null, error: { message: "Failed to fetch", context: e } };
                    r = { ok: false, status: 404 };
                }
                // Sin el servidor de prueba (por ejemplo con `python -m
                // http.server`) no hay a quién preguntarle: se contesta con
                // una muestra fija, que alcanza para probar las tarjetas.
                const sinServidor = [404, 405, 501].includes(r.status);
                if (!r.ok && !sinServidor) return { data: null, error: { context: r } };

                tablas.ia_usos.push({ tipo });
                const data = sinServidor ? { ok: true, propuesta: muestra(tipo, body.texto || "") } : await r.json();
                data.uso = { cargas: estado.cargas + (tipo === "texto" ? 0 : 1), cupo: estado.cupo_mensual };
                return { data, error: null };
            },
        },

        auth: {
            onAuthStateChange(cb) {
                avisar = cb;
                setTimeout(() => cb("SIGNED_IN", sesion), 0);
                return { data: { subscription: { unsubscribe() {} } } };
            },
            async signInWithPassword() { setTimeout(() => avisar("SIGNED_IN", sesion), 0); return { data: { session: sesion }, error: null }; },
            async signOut() { setTimeout(() => avisar("SIGNED_OUT", null), 0); return { error: null }; },
            async getSession() { return { data: { session: sesion }, error: null }; },
        },
    };
}
