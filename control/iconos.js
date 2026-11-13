// Íconos del panel, dibujados a mano como SVG de trazo.
//
// Van en línea y no como fuente de íconos ni como archivos sueltos: el panel no
// tiene paso de compilación, y así no hay un pedido de red más ni un cuadradito
// vacío mientras carga. Heredan el color del texto que los rodea.

const TRAZOS = {
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    calendario: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    plata: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 12h.01M17.5 12h.01"/>',
    paquete: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    enviar: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
    tilde: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
    derecha: '<path d="M9 6l6 6-6 6"/>',
    izquierda: '<path d="M15 6l-6 6 6 6"/>',
    abajo: '<path d="M6 9l6 6 6-6"/>',
    alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2h.01"/>',
    chispa: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    personas: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5.2a3 3 0 0 1 0 5.6M21 20a6 6 0 0 0-4-5.6"/>',
    camion: '<path d="M2.5 6h11v10h-11zM13.5 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    obra: '<path d="M3 21h18M5 21V8l7-4 7 4v13M9.5 21v-6h5v6"/>',
};

export function ico(nombre) {
    return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TRAZOS[nombre] || ""}</svg>`;
}

// Los íconos que están escritos en el HTML van como <span data-ico="nombre">:
// se completan una vez, al arrancar.
export function completarIconos(raiz = document) {
    raiz.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
}
