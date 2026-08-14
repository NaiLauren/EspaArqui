/* =====================================================================
   0. Hero animado: secuencia de frames dirigida por el scroll.

   Va fuera del DOMContentLoaded para que las imágenes empiecen a bajar
   cuanto antes. El detalle fino de la transición está documentado abajo,
   en TRANSICION.
   ===================================================================== */
const HERO_ANIM = {
    // Única perilla para cambiar de calidad. Las dos carpetas tienen los
    // mismos 127 frames a 1920x1080; 'web-lossless' es idéntica píxel a
    // píxel a los PNG y pesa 98 MB, 'web-q95' pesa 29 MB.
    dir: 'Videoscroll/web-q95',
    ext: 'webp',
    frameCount: 127,

    // Porción de la pista de scroll dedicada a la transición hero -> video.
    heroPhase: 0.17,
    // Dentro de esa porción, cuándo empieza y termina el fundido.
    fadeStart: 0.40,
    fadeEnd: 0.96,

    // PARADAS — Qué frame se ve en cada punto de la pista. Antes esto era una
    // recta (scroll parejo, frames parejos) y por eso los textos pasaban de
    // largo. Ahora es una escalera: los tramos donde el número de frame casi
    // no cambia son las paradas, y caen justo sobre las tres fichas.
    //
    // Los frames 24, 60 y 97 son los que ya se veían en el centro de cada
    // ficha, así que el emparejamiento texto-imagen queda intacto.
    //
    //          scroll  frame
    frameStops: [
        [0.17,    1],   // termina la transición del hero
        [0.31,   22],   // ── parada 1: Plano 3D
        [0.43,   26],   //
        [0.53,   58],   // ── parada 2: Estructura
        [0.65,   62],   //
        [0.75,   95],   // ── parada 3: Render exterior
        [0.87,   99],   //
        [1.00,  127]    // final
    ],

    // TRANSICION — Correspondencia entre frame_0001 y la imagen del hero, en
    // coordenadas normalizadas: el punto (u,v) del frame cae en
    // (u0 + us*u, v0 + vs*v) de la imagen del hero. Se obtuvo maximizando la
    // correlación de bordes entre las dos imágenes. Las escalas X e Y no son
    // iguales porque el render 3D no usó exactamente la misma cámara.
    // Al derivarse del rectángulo del frame, sirve para cualquier proporción
    // de pantalla sin volver a medir nada.
    match: { u0: 0.115385, us: 0.813942, v0: 0.156250, vs: 0.507440 },

    // La imagen del hero es más oscura y cálida que el video; la acercamos a
    // su tono mientras se funde para que no se note el cambio de color.
    grade: { brightness: 1.13, saturate: 0.82 },

    // IMANES — Centros de las tres paradas. El scroll que termina cerca de
    // uno se acomoda solo en él. Usa 'proximity', no 'mandatory': sólo actúa
    // si soltaste cerca, así nunca atrapa a quien pasa de largo buscando el
    // contenido de abajo. Dejar la lista vacía desactiva el imán.
    snapAt: [0.37, 0.59, 0.81],

    // El encaje no puede ser perfecto (son cámaras distintas): desenfocar la
    // capa que se va disimula el fantasma del texto y se lee como un cambio
    // de foco. Píxeles a 1280 de ancho; 0 lo desactiva.
    blur: 5
};

(function initHeroAnimation() {
    const canvas = document.getElementById('heroCanvas');
    const heroEl = document.getElementById('hero');
    const stage = heroEl && heroEl.querySelector('.hero-stage');
    const arrow = document.getElementById('heroScrollDown');
    if (!canvas || !heroEl || !stage) return;

    // Casos en los que no animamos y queda el fondo estático del CSS, sin
    // descargar un solo frame:
    //  - el visitante pidió menos movimiento en su sistema
    //  - tiene activado el ahorro de datos
    //  - el navegador no soporta overflow-x: clip, con lo cual el sticky del
    //    hero no funciona y la pista quedaría como un bloque negro larguísimo
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const stickyOk = window.CSS && CSS.supports && CSS.supports('overflow-x', 'clip');

    if (reduced || saveData || !stickyOk) {
        canvas.style.display = 'none';
        heroEl.style.height = '100vh';
        // Sin pista de scroll las fichas no tienen dónde turnarse: se
        // apagan. El mismo contenido está en las secciones de abajo.
        const copy = document.getElementById('heroCopy');
        if (copy) copy.style.display = 'none';
        return;
    }

    const context = canvas.getContext('2d');
    const C = HERO_ANIM;

    // --- carga ---------------------------------------------------------
    const hero = new Image();
    const frames = new Array(C.frameCount + 1);
    const ready = new Array(C.frameCount + 1).fill(false);
    let heroReady = false;

    hero.fetchPriority = 'high';
    hero.onload = () => { heroReady = true; requestRender(); };
    hero.src = `${C.dir}/hero.webp`;

    const framePath = i => `${C.dir}/frame_${String(i).padStart(4, '0')}.${C.ext}`;

    function loadFrame(i) {
        return new Promise(resolve => {
            const img = new Image();
            frames[i] = img;
            img.onload = () => { ready[i] = true; requestRender(); resolve(); };
            img.onerror = resolve;
            img.src = framePath(i);
        });
    }

    // Los primeros frames son los que participan del fundido: van sí o sí
    // antes que el resto, para que la transición nunca se quede sin imagen.
    const priority = [];
    for (let i = 1; i <= Math.min(8, C.frameCount); i++) priority.push(i);

    Promise.all(priority.map(loadFrame)).then(() => {
        let next = priority.length + 1;
        const pump = () => {
            if (next > C.frameCount) return;
            loadFrame(next++).then(pump);
        };
        for (let k = 0; k < 6; k++) pump();
    });

    // Si el frame pedido todavía no cargó, usamos el último disponible en
    // lugar de dejar un hueco negro.
    function nearestReady(index) {
        for (let i = index; i >= 1; i--) if (ready[i]) return frames[i];
        return null;
    }

    // --- dibujo --------------------------------------------------------
    const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = t => t * t * (3 - 2 * t);
    const supportsFilter = typeof context.filter === 'string';

    let cw = 0, ch = 0;

    // Marcas invisibles sobre las que engancha el scroll. Van posicionadas en
    // píxeles medidos y no en porcentajes, porque la pista real depende del
    // alto de la pantalla y en móvil el 100dvh cambia con la barra.
    const snaps = C.snapAt.map(() => {
        const el = document.createElement('div');
        el.className = 'hero-snap';
        el.setAttribute('aria-hidden', 'true');
        heroEl.appendChild(el);
        return el;
    });

    if (snaps.length) document.documentElement.classList.add('hero-snapping');

    function placeSnaps() {
        const track = heroEl.offsetHeight - stage.offsetHeight;
        snaps.forEach((el, i) => { el.style.top = Math.round(C.snapAt[i] * track) + 'px'; });
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(stage.clientWidth * dpr);
        const h = Math.round(stage.clientHeight * dpr);

        // Si el navegador todavía no calculó el tamaño, no guardamos la
        // medición: con cw y ch arrancando en cero, un cero medido daría
        // "no cambió nada" y el canvas se quedaría sin dimensionar para
        // siempre, con el hero en blanco.
        if (!w || !h) return;

        placeSnaps();
        if (w === cw && h === ch) return;
        cw = canvas.width = w;
        ch = canvas.height = h;
        requestRender();
    }

    // Rectángulo de destino que cubre el escenario conservando la proporción.
    function coverRect(img) {
        const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
    }

    // Rectángulo del hero que deja su contenido superpuesto al del frame 1.
    function heroMatchRect(frameRect) {
        const m = C.match;
        const w = frameRect.w / m.us;
        const h = frameRect.h / m.vs;
        return { x: frameRect.x - m.u0 * w, y: frameRect.y - m.v0 * h, w, h };
    }

    function paint(img, r, alpha, filter) {
        context.globalAlpha = alpha;
        if (supportsFilter) context.filter = filter || 'none';
        context.drawImage(img, r.x, r.y, r.w, r.h);
        if (supportsFilter) context.filter = 'none';
        context.globalAlpha = 1;
    }

    // Qué frame corresponde a un punto de la pista, según la tabla de
    // paradas. Entre dos anclajes interpola con suavizado en vez de en línea
    // recta: así el render frena al entrar en cada parada y arranca de nuevo
    // al salir, en lugar de cortar de golpe.
    //
    // Durante una parada el frame igual avanza de a poco (cuatro frames en
    // todo el tramo). Es a propósito: congelarlo del todo se lee como que la
    // página se colgó, y este resto de movimiento la mantiene viva.
    function frameAt(p) {
        const s = C.frameStops;
        if (p <= s[0][0]) return s[0][1];
        for (let i = 1; i < s.length; i++) {
            if (p <= s[i][0]) {
                const t = (p - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
                return lerp(s[i - 1][1], s[i][1], smoothstep(t));
            }
        }
        return s[s.length - 1][1];
    }

    // Arranca y termina suave, pero sin frenar del todo: el video también
    // empieza casi quieto, así que el relevo no se percibe.
    function easeCamera(u) {
        const c = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        return 0.9 * c + 0.1 * u;
    }

    let arrowHidden = false;

    // --- fichas sincronizadas -------------------------------------------
    const copyEl = document.getElementById('heroCopy');
    const scaleEl = document.getElementById('heroScale');
    // Cada movimiento define de dónde entra la ficha, hacia dónde se va, y en
    // qué dirección la barre el clip del título. Así ninguna repite el gesto
    // de la anterior.
    const MOTIONS = {
        left:  { from: [-58, 0], to: [0, -34], wipe: i => `inset(0 ${i}% 0 0)` },
        right: { from: [58, 0],  to: [0,  34], wipe: i => `inset(0 0 0 ${i}%)` },
        rise:  { from: [0, 44],  to: [0, -18], wipe: i => `inset(${i}% 0 0 0)` }
    };

    // Cuánto se atrasa cada parte respecto de la anterior al entrar. Es lo que
    // hace que la ficha se arme por pasos en vez de aparecer como un bloque.
    const STAGGER = 0.13;

    const beats = copyEl ? Array.from(copyEl.querySelectorAll('.hero-beat')).map(el => {
        const parts = Array.from(el.children);
        return {
            el, parts,
            title: el.querySelector('.beat-title'),
            rule: el.querySelector('.beat-index'),
            motion: MOTIONS[el.dataset.motion] || MOTIONS.left,
            in: parseFloat(el.dataset.in),
            out: parseFloat(el.dataset.out),
            span: 1 - STAGGER * (parts.length - 1)
        };
    }) : [];

    // Cuánto de la ficha ocupa la entrada y la salida. Corto: si el fundido
    // dura demasiado, el texto pasa medio transparente casi todo el tramo.
    const BEAT_EDGE = 0.062;

    function updateBeats(p) {
        for (const b of beats) {
            const enter = clamp((p - b.in) / BEAT_EDGE, 0, 1);
            const exit  = smoothstep(clamp((p - (b.out - BEAT_EDGE)) / BEAT_EDGE, 0, 1));
            const alpha = smoothstep(enter) * (1 - exit);

            // Nada que hacer si sigue apagada: evita tocar el DOM de gusto.
            if (alpha === 0 && b.alpha === 0) continue;
            if (alpha === b.alpha && exit === b.exit) continue;
            b.alpha = alpha; b.exit = exit;

            b.el.style.setProperty('--alpha', alpha.toFixed(3));

            const m = b.motion;
            b.parts.forEach((part, i) => {
                // Cada parte recorre su propia ventana dentro de la entrada.
                const e = smoothstep(clamp((enter - i * STAGGER) / b.span, 0, 1));
                const x = lerp(m.from[0], 0, e) + lerp(0, m.to[0], exit);
                const y = lerp(m.from[1], 0, e) + lerp(0, m.to[1], exit);
                part.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
                part.style.opacity = e.toFixed(3);
            });

            // El título además se descubre con un barrido en la dirección
            // del movimiento, como si se imprimiera.
            if (b.title) {
                const e = smoothstep(clamp((enter - STAGGER) / b.span, 0, 1));
                b.title.style.clipPath = m.wipe(((1 - e) * 100).toFixed(1));
            }

            // La regla del número se dibuja hacia el lado que entra la ficha.
            if (b.rule) {
                const e = smoothstep(clamp(enter / b.span, 0, 1));
                b.rule.style.setProperty('--rule', e.toFixed(3));
            }
        }

        if (scaleEl) {
            scaleEl.style.setProperty('--progress', p.toFixed(4));
            scaleEl.classList.toggle('on', p > 0.04 && p < 0.99);
        }
    }

    function render() {
        if (!cw || !ch) return;

        // Progreso sobre la pista de scroll del hero, no sobre el documento.
        const track = heroEl.offsetHeight - stage.offsetHeight;
        const p = track > 0
            ? clamp(-heroEl.getBoundingClientRect().top / track, 0, 1)
            : 0;

        context.clearRect(0, 0, cw, ch);

        if (p < C.heroPhase) {
            // Fase 1: la cámara entra al logo y funde hacia el frame 1.
            const u = p / C.heroPhase;
            const e = easeCamera(u);
            const fade = smoothstep(clamp((u - C.fadeStart) / (C.fadeEnd - C.fadeStart), 0, 1));

            if (heroReady) {
                const from = coverRect(hero);
                // Sin el frame cargado no hay a dónde encuadrar: el hero se
                // queda quieto en vez de moverse hacia un destino equivocado.
                const to = ready[1] ? heroMatchRect(coverRect(frames[1])) : from;
                const g = C.grade;
                // Máximo a mitad del fundido, que es donde las dos capas se
                // ven por igual y el fantasma molestaría más.
                const blur = C.blur * Math.sin(Math.PI * fade) * (cw / 1280);

                paint(hero, {
                    x: lerp(from.x, to.x, e),
                    y: lerp(from.y, to.y, e),
                    w: lerp(from.w, to.w, e),
                    h: lerp(from.h, to.h, e)
                }, 1,
                    `brightness(${lerp(1, g.brightness, fade).toFixed(3)}) ` +
                    `saturate(${lerp(1, g.saturate, fade).toFixed(3)})` +
                    (blur > 0.2 ? ` blur(${blur.toFixed(2)}px)` : ''));
            }

            if (fade > 0 && ready[1]) {
                paint(frames[1], coverRect(frames[1]), heroReady ? fade : 1);
            }
        } else {
            // Fase 2: secuencia de frames, con las paradas de frameStops.
            const index = clamp(Math.round(frameAt(p)), 1, C.frameCount);
            const img = nearestReady(index);
            if (img) paint(img, coverRect(img), 1);
        }

        updateBeats(p);

        if (arrow) {
            const hide = p > 0.02;
            if (hide !== arrowHidden) {
                arrowHidden = hide;
                arrow.classList.toggle('hidden', hide);
            }
        }
    }

    // --- loop ----------------------------------------------------------
    let pending = false;
    function requestRender() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; render(); });
    }

    window.addEventListener('scroll', requestRender, { passive: true });

    // ResizeObserver es el que resuelve el arranque: avisa en cuanto el
    // escenario tiene medidas reales, sin depender de que el script corra
    // después del cálculo de estilos. Los otros dos quedan de respaldo.
    if (window.ResizeObserver) {
        new ResizeObserver(() => { resize(); requestRender(); }).observe(stage);
    }
    window.addEventListener('resize', () => { resize(); requestRender(); });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => { resize(); requestRender(); });
    }
    resize();
})();


document.addEventListener('DOMContentLoaded', () => {
    // 1. Efecto Scroll en Navbar
    const navbar = document.querySelector('.navbar');
    const heroSection = document.getElementById('hero');

    // Mientras el hero ocupa la pantalla la navegación va transparente sobre
    // el render; se vuelve sólida justo cuando el borde inferior del hero
    // pasa por debajo de la barra, ni antes ni después.
    const navTrigger = () => heroSection
        ? Math.max(50, heroSection.offsetHeight - navbar.offsetHeight)
        : 50;

    window.addEventListener('scroll', () => {
        if (window.scrollY > navTrigger()) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }, { passive: true });

    // 2. Menú Móvil (Hamburger)
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    const navItems = document.querySelectorAll('.nav-links a');

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    // 3. Animaciones al hacer scroll (Fade In)
    const fadeElements = document.querySelectorAll('.fade-in');

    const appearOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const appearOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, appearOptions);

    fadeElements.forEach(element => {
        appearOnScroll.observe(element);
    });

    // 4. Contador Animado de Cifras
    const statNumbers = document.querySelectorAll('.stat-number');

    const counterOptions = {
        threshold: 0.5
    };

    const counterObserver = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            const el = entry.target;
            const target = parseInt(el.getAttribute('data-target'));

            // Si el target es 0, simplemente mostrar 0
            if (target === 0) {
                el.textContent = 0;
                observer.unobserve(el);
                return;
            }

            const duration = 2000;
            const startTime = performance.now();

            function updateCounter(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - (1 - progress) * (1 - progress);
                const current = Math.floor(eased * target);

                el.textContent = current;

                if (progress < 1) {
                    requestAnimationFrame(updateCounter);
                } else {
                    el.textContent = target;
                }
            }

            requestAnimationFrame(updateCounter);
            observer.unobserve(el);
        });
    }, counterOptions);

    statNumbers.forEach(num => {
        counterObserver.observe(num);
    });

    // 5. Navegación Activa al Scroll
    const sections = document.querySelectorAll('section[id]');
    const navLinksAll = document.querySelectorAll('.nav-links a[data-section]');

    const sectionObserverOptions = {
        threshold: 0.3,
        rootMargin: "-80px 0px -50% 0px"
    };

    const sectionObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            const sectionId = entry.target.getAttribute('id');
            const correspondingLink = document.querySelector(`.nav-links a[data-section="${sectionId}"]`);

            if (correspondingLink) {
                if (entry.isIntersecting) {
                    // Quitar active de todos
                    navLinksAll.forEach(link => link.classList.remove('active'));
                    // Agregar active al actual
                    correspondingLink.classList.add('active');
                }
            }
        });
    }, sectionObserverOptions);

    sections.forEach(section => {
        sectionObserver.observe(section);
    });

    // 6. Formulario → WhatsApp
    const contactForm = document.getElementById('contactForm');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const nombre = document.getElementById('nombre').value.trim();
            const tipo = document.getElementById('tipo').value;
            const mensaje = document.getElementById('mensaje').value.trim();

            let waMessage = `Hola, soy *${nombre}*.\n`;
            waMessage += `Me interesa un proyecto de tipo: *${tipo}*.\n\n`;
            waMessage += mensaje;

            const encodedMessage = encodeURIComponent(waMessage);
            const waUrl = `https://wa.me/542346481451?text=${encodedMessage}`;

            window.open(waUrl, '_blank');
        });
    }

    // 7. Calculadora de Presupuesto
    const calcTipo = document.getElementById('calcTipo');
    const calcM2 = document.getElementById('calcM2');
    const calcM2Value = document.getElementById('calcM2Value');
    const calcOptions = document.querySelectorAll('.calc-option');
    const resultMin = document.getElementById('resultMin');
    const resultMax = document.getElementById('resultMax');
    let currentNivel = 'basico';

    // Precios base estimados por m2 (en USD para este ejemplo)
    const preciosBase = {
        residencial: { basico: 600, medio: 900, premium: 1400 },
        comercial: { basico: 500, medio: 800, premium: 1200 },
        reforma: { basico: 300, medio: 500, premium: 800 }
    };

    function updateCalculator() {
        if (!calcTipo || !calcM2) return;

        const tipo = calcTipo.value;
        const m2 = parseInt(calcM2.value);
        
        // Actualizar etiqueta del slider
        calcM2Value.textContent = m2;

        // Calcular precio base
        const precioM2 = preciosBase[tipo][currentNivel];
        let total = m2 * precioM2;

        // Rango del 15% arriba y abajo para dar flexibilidad
        let min = total * 0.85;
        let max = total * 1.15;

        // Formatear números (ej: 80.000)
        const formatNumber = (num) => {
            return Math.round(num).toLocaleString('es-AR');
        };

        resultMin.textContent = formatNumber(min);
        resultMax.textContent = formatNumber(max);
    }

    if (calcTipo && calcM2) {
        calcTipo.addEventListener('change', updateCalculator);
        calcM2.addEventListener('input', updateCalculator);

        calcOptions.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remover clase active de todos
                calcOptions.forEach(b => b.classList.remove('active'));
                // Agregar al clickeado
                e.target.classList.add('active');
                // Actualizar nivel actual y recalcular
                currentNivel = e.target.getAttribute('data-nivel');
                updateCalculator();
            });
        });

        // Inicializar
        updateCalculator();
    }

    // 8. FAQ Acordeón
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Cerrar todos
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
                otherItem.querySelector('.faq-answer').style.maxHeight = null;
            });

            // Si no estaba activo, abrirlo
            if (!isActive) {
                item.classList.add('active');
                answer.style.maxHeight = answer.scrollHeight + "px";
            }
        });
    });
});
