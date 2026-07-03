document.addEventListener('DOMContentLoaded', () => {
    // 1. Efecto Scroll en Navbar
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

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
