// Servidor de prueba del panel /control. No se despliega: `herramientas/` está
// en .vercelignore.
//
//   node --experimental-strip-types herramientas/prueba-local/servidor.mjs
//
// Dos modos:
//
//   STUB=1 (por defecto)  El panel corre contra un doble de Supabase en
//       memoria (stub.js), con datos de ejemplo y sin pedir contraseña. El
//       asistente sí es de verdad: /__prueba/asistente usa el mismo núcleo que
//       la función desplegada, con la clave que haya en GEMINI_API_KEY o en
//       geminiapikey.nosubir.txt (archivo ignorado por git).
//
//   STUB=0  Sirve los archivos tal cual, contra la base real. Hace falta
//       iniciar sesión, y lo que se cargue queda cargado de verdad.
//
// En los dos modos responde /control y /control/ sin redirigir, igual que
// Vercel. El servidor de python redirige, y eso ya escondió una vez un error
// de rutas que dejó la página en blanco en producción.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aca = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aca, "..", "..");
const puerto = Number(process.env.PORT || process.env.PUERTO || 8777);
const stub = process.env.STUB !== "0";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const TIPOS = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function clave() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
    const archivo = join(raiz, "geminiapikey.nosubir.txt");
    return existsSync(archivo) ? readFileSync(archivo, "utf8").trim() : "";
}

async function asistente(req, res) {
    const responder = (status, cuerpo) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cuerpo));
    };
    try {
        const partes = [];
        for await (const p of req) partes.push(p);
        const cuerpo = JSON.parse(Buffer.concat(partes).toString("utf8"));
        const k = clave();
        if (!k) return responder(500, { ok: false, error: "Falta la clave: GEMINI_API_KEY o geminiapikey.nosubir.txt." });

        const { consultarGemini } = await import(pathToFileURL(join(raiz, "supabase/functions/asistente/nucleo.ts")).href);
        const r = await consultarGemini(k, cuerpo, cuerpo.obras || []);
        if (r.fallas.length) console.warn("[asistente] respondió", r.modelo, "tras", r.fallas.join(" | "));
        else console.log("[asistente]", r.modelo, "->", r.propuesta.tipo);
        responder(200, { ok: true, propuesta: r.propuesta });
    } catch (e) {
        console.error("[asistente]", e.message);
        responder(502, { ok: false, error: "El asistente está ocupado en este momento. Probá de nuevo en un minuto." });
    }
}

createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let ruta = decodeURIComponent(url.pathname);

    if (stub && ruta === "/__prueba/asistente" && req.method === "POST") return asistente(req, res);
    if (stub && ruta === "/__prueba/stub.js") ruta = "/herramientas/prueba-local/stub.js";

    // Sin redirección: /control y /control/ devuelven el mismo HTML.
    if (ruta === "/control" || ruta === "/control/") ruta = "/control/index.html";
    else if (ruta.endsWith("/")) ruta += "index.html";

    // Nada que pueda ser un secreto sale por acá, aunque esté en la carpeta:
    // mientras se prueba, la clave de la IA vive al lado del sitio. Tampoco
    // archivos ocultos (.git, .env).
    if (/(^|\/)\.|nosubir|apikey/i.test(ruta)) { res.writeHead(404); return res.end(); }

    const archivo = normalize(join(raiz, ruta));
    if (!archivo.startsWith(raiz)) { res.writeHead(403); return res.end(); }

    try {
        let datos = await readFile(archivo);
        if (stub && ruta === "/control/index.html") {
            // El doble entra por un import map: el código del panel no cambia
            // ni una línea para probarse.
            const mapa = `<script type="importmap">{"imports":{"${SUPABASE_JS}":"/__prueba/stub.js"}}</script>\n`;
            datos = datos.toString("utf8").replace('<script type="module"', mapa + '<script type="module"');
        }
        res.writeHead(200, { "Content-Type": TIPOS[extname(archivo).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(datos);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No existe: " + ruta);
    }
// Sólo en 127.0.0.1: no queda escuchando para el resto de la red.
}).listen(puerto, "127.0.0.1", () => {
    console.log(`Panel en http://localhost:${puerto}/control  (${stub ? "datos de ejemplo en memoria" : "BASE REAL"})`);
});
