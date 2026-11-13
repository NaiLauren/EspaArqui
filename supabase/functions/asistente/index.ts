// Función del asistente del panel /control.
//
// Es el único lugar donde vive la clave de Gemini: como secreto de la función
// (GEMINI_API_KEY), nunca en el navegador ni en el repositorio, que es público.
//
// Qué hace, en orden:
//   1. Comprueba la sesión contra el servicio de Auth.
//   2. Le pregunta a la base si quien llama es del estudio, si el asistente
//      está encendido y cuánto lleva usado. Todo eso lo decide la base (RLS y
//      la función ia_estado), no este archivo.
//   3. Llama a Gemini y valida lo que vuelve.
//   4. Anota el uso y devuelve una PROPUESTA.
//
// Nunca guarda un evento, un pago ni un pedido: eso lo hace el navegador cuando
// la persona toca "Guardar", con su propia sesión. Y no usa la clave de
// servicio: cada consulta a la base va con el token de quien llama.
//
// Se despliega con verify_jwt apagado porque la verificación se hace acá, en
// el paso 1: así las respuestas de error salen en castellano y el preflight de
// CORS no depende de la puerta de entrada.

import { consultarGemini } from "./nucleo.ts";
import type { Obra } from "./nucleo.ts";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIME_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
const MIME_AUDIO = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac"];

// En base64. El panel achica la foto y pasa el audio a WAV de 16 kHz antes de
// mandarlos, así que lo normal queda muy por debajo.
const MAX_IMAGEN = 6_000_000;
const MAX_AUDIO = 6_000_000;
const MAX_TEXTO = 2000;

function json(cuerpo: unknown, status = 200) {
    return new Response(JSON.stringify(cuerpo), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}

const fallo = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    json({ ok: false, error, ...extra }, status);

// deno-lint-ignore no-explicit-any
function adjunto(v: any, permitidos: string[], max: number) {
    if (!v || typeof v !== "object") return null;
    const mime = typeof v.mime === "string" ? v.mime.split(";")[0].trim().toLowerCase() : "";
    if (!permitidos.includes(mime)) return null;
    if (typeof v.data !== "string" || v.data.length === 0 || v.data.length > max) return null;
    if (!/^[A-Za-z0-9+/]+=*$/.test(v.data.slice(0, 200))) return null;
    return { mime, data: v.data };
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return fallo(405, "Método no permitido.");

    const base = Deno.env.get("SUPABASE_URL");
    const autorizacion = req.headers.get("Authorization") ?? "";
    // La clave pública del proyecto: la manda el panel en cada pedido. No es
    // un secreto; sólo identifica al proyecto ante la API.
    const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!base || !apikey || !/^Bearer\s+\S+/i.test(autorizacion)) {
        return fallo(401, "Tenés que iniciar sesión.");
    }

    const cabeceras = { apikey, Authorization: autorizacion, "Content-Type": "application/json" };

    // 1. ¿La sesión es real y está vigente?
    const sesion = await fetch(`${base}/auth/v1/user`, { headers: cabeceras });
    if (!sesion.ok) return fallo(401, "La sesión venció. Volvé a entrar.");

    // 2. ¿Es del estudio, está encendido y queda cupo? A quien no figura en
    //    `miembros`, RLS le devuelve cero filas.
    const estadoRes = await fetch(`${base}/rest/v1/rpc/ia_estado`, { method: "POST", headers: cabeceras, body: "{}" });
    if (!estadoRes.ok) {
        console.error("ia_estado", estadoRes.status, (await estadoRes.text()).slice(0, 300));
        return fallo(500, "No se pudo consultar el estado del asistente.");
    }
    const [estado] = await estadoRes.json();
    if (!estado) return fallo(403, "Ese usuario no está habilitado para el panel.");
    if (!estado.activa) return fallo(403, "El asistente no está activado en este panel.");

    // deno-lint-ignore no-explicit-any
    let cuerpo: any;
    try { cuerpo = await req.json(); } catch { return fallo(400, "El pedido llegó mal armado."); }

    const imagen = adjunto(cuerpo?.imagen, MIME_IMAGEN, MAX_IMAGEN);
    const audio = adjunto(cuerpo?.audio, MIME_AUDIO, MAX_AUDIO);
    const texto = typeof cuerpo?.texto === "string" ? cuerpo.texto.trim().slice(0, MAX_TEXTO) : "";

    if (cuerpo?.imagen && !imagen) return fallo(400, "Esa imagen no sirve: tiene que ser una foto JPG o PNG de hasta 4 MB.");
    if (cuerpo?.audio && !audio) return fallo(400, "Ese audio no sirve: probá con uno más corto.");
    if (!imagen && !audio && !texto) return fallo(400, "No llegó nada para leer.");

    const tipo = imagen ? "foto" : audio ? "audio" : "texto";

    // Las cargas (audios y fotos) son las que tienen cupo contratado. Lo
    // escrito tiene un tope aparte, alto, sólo como freno.
    if (tipo === "texto" ? estado.textos >= estado.cupo_texto : estado.cargas >= estado.cupo_mensual) {
        return fallo(429, tipo === "texto"
            ? "Se llegó al tope de consultas escritas de este mes."
            : `Ya se usaron las ${estado.cupo_mensual} cargas de este mes. Avisanos y lo ampliamos.`,
            { uso: { cargas: estado.cargas, cupo: estado.cupo_mensual } });
    }

    const clave = Deno.env.get("GEMINI_API_KEY");
    if (!clave) {
        console.error("Falta el secreto GEMINI_API_KEY en la función.");
        return fallo(500, "El asistente todavía no está configurado.");
    }

    // Las obras se leen acá, con la sesión del usuario, y no se aceptan del
    // navegador: así el modelo sólo puede proponer obras que existen.
    const obrasRes = await fetch(`${base}/rest/v1/obras?select=id,nombre,cliente,estado&order=nombre`, { headers: cabeceras });
    const obras: Obra[] = obrasRes.ok ? await obrasRes.json() : [];

    let resultado;
    try {
        resultado = await consultarGemini(
            clave,
            { texto, imagen, audio, historial: cuerpo?.historial },
            obras,
            // Opcional: con el secreto GEMINI_MODEL se cambia el modelo
            // principal desde el panel de Supabase, sin volver a desplegar.
            { modelo: Deno.env.get("GEMINI_MODEL") },
        );
    } catch (e) {
        console.error("gemini", e instanceof Error ? e.message : e);
        return fallo(502, "El asistente está ocupado en este momento. Probá de nuevo en un minuto.");
    }
    if (resultado.fallas.length) console.warn("respondió", resultado.modelo, "tras", resultado.fallas.join(" | "));

    // 4. Se anota el uso recién cuando hubo lectura: un intento fallido no le
    //    descuenta una carga al estudio. Si no se pudiera anotar, no se
    //    entrega la respuesta: sin contador no hay cupo que valga.
    const usoRes = await fetch(`${base}/rest/v1/ia_usos`, {
        method: "POST",
        headers: { ...cabeceras, Prefer: "return=minimal" },
        body: JSON.stringify({ tipo }),
    });
    if (!usoRes.ok) {
        console.error("ia_usos", usoRes.status, (await usoRes.text()).slice(0, 300));
        return fallo(500, "No se pudo registrar el uso. Probá de nuevo.");
    }

    return json({
        ok: true,
        propuesta: resultado.propuesta,
        uso: {
            cargas: estado.cargas + (tipo === "texto" ? 0 : 1),
            cupo: estado.cupo_mensual,
        },
    });
});
