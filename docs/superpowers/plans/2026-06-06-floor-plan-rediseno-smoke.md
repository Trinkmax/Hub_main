# Smoke manual — Rediseño del floor plan (editor v2 + vista en vivo)

> Happy path del rediseño (spec §10 / plan Phase 7). Ejecutar con la app
> levantada (`npm run dev`), registrar resultado + screenshots/video en el PR.
> Sin E2E automatizado en MVP.

## Pre-requisitos

- [ ] Migraciones `20260605000100`, `20260605000200` y `20260606000100` aplicadas
      (vía Supabase MCP, proyecto `ogplsevtrclzxvyejlns`).
- [ ] `npm run typecheck && npm run lint && npm run test:ci` en verde.
- [ ] App corriendo: `npm run dev` → http://localhost:3000
- [ ] Logueado como **owner** (tenant HUB o cualquier tenant con áreas y mesas).
- [ ] Para los pasos de staff: segunda sesión en otra pestaña logueada como
      **waiter** del mismo tenant.

---

## A. Navegación — tab "Local"

- [ ] **A1. Tab "Local" en el sidebar del dueño.**
  - *Pasos:* entrar al dashboard del dueño.
  - *Esperado:* existe un ítem/grupo "Local" en el sidebar con tres sub-ítems:
    "Plano", "Captura QRs", "Auto-aceptación".

- [ ] **A2. La sección "Local" ya NO aparece en Configuración.**
  - *Pasos:* ir a `/{slug}/configuracion`.
  - *Esperado:* no hay card ni sección "Local" en la página de configuración.
    La settings-nav no lista "Plano", "Captura QRs" ni "Auto-aceptación".

- [ ] **A3. Las rutas `/local/*` responden correctamente.**
  - *Pasos:* navegar a `/{slug}/local/mesas`, `/{slug}/local/captura`,
    `/{slug}/local/auto-aceptacion`.
  - *Esperado:* cada página carga sin 404 ni error.

- [ ] **A4. Las rutas viejas `/configuracion/mesas` y `/configuracion/captura` redirigen.**
  - *Pasos:* ingresar las URLs viejas directamente.
  - *Esperado:* redireccionan a las nuevas rutas `/local/*` (o devuelven 404
    limpios sin página rota; depende de si se agregaron redirects explícitos).

---

## B. Editor (modo Editar) — lienzo y paleta

- [ ] **B1. Lienzo pan — arrastrar el fondo.**
  - *Pasos:* en el editor con el modo "Editar" activo, hacer click-hold en el
    fondo vacío del canvas y arrastrar.
  - *Esperado:* el stage se desplaza (pan). Arrastrar sobre una mesa **no** panea
    (la mesa se mueve en su lugar; `panning.excluded=['floor-element']` funciona).

- [ ] **B2. Zoom — scroll y botones.**
  - *Pasos:* hacer scroll sobre el canvas. Luego usar los botones `+` y `−`.
    Luego usar el botón "fit" (centrar).
  - *Esperado:* el zoom cambia suavemente. El botón fit vuelve a encuadrar el área.
    El nivel de zoom se muestra o es perceptible visualmente.

- [ ] **B3. Drag-from-palette — colocar mesa.**
  - *Pasos:* en la paleta de elementos, hacer click-hold sobre el chip "Mesa" y
    arrastrarlo hasta un punto vacío del canvas. Soltar.
  - *Esperado:* se crea una nueva mesa **en el punto donde se soltó** (no en el
    centro del área). Se abre automáticamente el inspector de la nueva mesa para
    editar nombre/capacidad. No aparece ningún diálogo "al centro" (`create-table-dialog`
    fue retirado).

- [ ] **B4. Drag-from-palette — colocar decoración.**
  - *Pasos:* arrastrar chips "Pared", "Columna", "Isla" y "Barra" al canvas.
  - *Esperado:* cada elemento aparece en el punto de drop con sus defaults
    (`wall` 200×16, `pillar` 40×40 circle, `island` 120×80, `bar` 240×40).

- [ ] **B5. Fallback de clic en la paleta (touch/sin drag).**
  - *Pasos:* hacer un clic corto (sin arrastrar) en cualquier chip de la paleta.
  - *Esperado:* el elemento se agrega en el centro del área visible (compat táctil).

---

## C. Drag de elementos con zoom correcto (bug class v1)

- [ ] **C1. Arrastrar mesa a scale=1 — sin drift.**
  - *Pasos:* con zoom al 100%, arrastrar una mesa.
  - *Esperado:* la mesa sigue el cursor; al soltar hace snap a la grilla de 20 px.
    No hay brecha entre la posición visual y la persistida.

- [ ] **C2. Arrastrar mesa a scale=2 — sin drift doble (BUG v1 corregido).**
  - *Pasos:* hacer zoom in hasta ~200% (botón `+` tres veces o scroll). Arrastrar
    una mesa 40 px en pantalla hacia la derecha.
  - *Esperado:* la mesa se mueve ~20 px lógicos (40 / scale 2), con snap al grid.
    **No** se desplaza 40 px lógicos (ese era el bug de v1). La posición coincide
    con el cursor visual durante y después del drag.

- [ ] **C3. Arrastrar mesa a scale=0.5 (zoom out) — delta amplificado correcto.**
  - *Pasos:* hacer zoom out (~50%). Arrastrar una mesa 10 px en pantalla.
  - *Esperado:* la mesa se mueve ~20 px lógicos (10 / 0.5), con snap. Correcto.

- [ ] **C4. Mesa no sale del área al arrastrar hasta el borde.**
  - *Pasos:* arrastrar una mesa hasta el borde del canvas y más allá.
  - *Esperado:* la mesa se clampea al borde del área lógica; no se "escapa" del
    stage.

---

## D. Resize con zoom

- [ ] **D1. Redimensionar a scale=1.**
  - *Pasos:* seleccionar una mesa; arrastrar un handle de resize.
  - *Esperado:* el tamaño cambia en proporción 1:1; mínimo de 24 px; persiste al
    soltar. Arrastrar el handle **no** mueve la mesa (no "pelean").

- [ ] **D2. Redimensionar a scale=2 — delta dividido por scale.**
  - *Pasos:* hacer zoom 200%; redimensionar la misma mesa.
  - *Esperado:* el cambio de tamaño es proporcional al movimiento visual (delta / 2).

---

## E. Gestión mesa-QR (reusado de v1, sin regresiones)

- [ ] **E1. Dividir mesa.**
- [ ] **E2. Combinar mesas (sin sesión).**
- [ ] **E3. Combinar con sesión abierta → bloqueado** (`table_has_open_session`).
- [ ] **E4. Desactivar → sale del canvas; reactivar → vuelve a bandeja.**
- [ ] **E5. Colocar desde la bandeja de no ubicadas.**
- [ ] **E6. Quitar del plano (mesa sigue activa, reaparece en bandeja).**
- [ ] **E7. Imprimir QR y regenerar token.**

*Para cada paso: resultado esperado = mismo que en el smoke de v1
(`2026-06-05-floor-plan-smoke.md` secciones B/C/D).*

---

## F. Toggle Editar / En vivo

- [ ] **F1. Cambiar al modo "En vivo".**
  - *Pasos:* click en el toggle "En vivo" del header del editor.
  - *Esperado:* el canvas cambia a modo read-only. Desaparecen la paleta y los
    handles de resize. Las mesas muestran `LiveTableCard` con colores por estado
    (verde tenue = libre, ámbar = ocupada, azul = pagada). El pan/zoom sigue
    funcionando (sin `excluded`).

- [ ] **F2. Mesas libres vs ocupadas en vivo.**
  - *Pasos:* con al menos una sesión abierta en una mesa y otra mesa libre, activar
    "En vivo".
  - *Esperado:* la mesa con sesión muestra color ámbar + gasto (`ARSFormat`) +
    comensales (👥 N) + tiempo transcurrido. La mesa libre muestra color verde tenue
    y sin datos de sesión.

- [ ] **F3. Volver al modo "Editar".**
  - *Pasos:* click en el toggle "Editar".
  - *Esperado:* el editor vuelve con la paleta, handles y estado previo.

---

## G. Live updates en tiempo real

> Estos pasos requieren la migración `20260606000100_realtime_salon_publication.sql`
> aplicada. Usar dos pestañas abiertas simultáneamente.

- [ ] **G1. Abrir sesión en otra pestaña → reflejo en el live floor.**
  - *Pasos:* en la pestaña del **dueño** activar "En vivo". En otra pestaña
    (logueado como cashier o waiter), abrir una sesión en una mesa (escanear QR o
    `/{slug}/salon/mesas`).
  - *Esperado:* dentro de ~2 s la mesa en el live floor del dueño cambia a color
    ámbar y muestra el gasto y comensales. Sin necesidad de recargar.

- [ ] **G2. Cambio de estado de ticket cocina → punto de cocina.**
  - *Pasos:* con una sesión abierta, en la KDS aceptar un ticket (estado
    `'accepted'` o `'preparing'`).
  - *Esperado:* aparece el punto de cocina ámbar en la tarjeta de la mesa en el live
    floor dentro de ~2 s.

- [ ] **G3. Ticket cocina listo → punto verde.**
  - *Pasos:* marcar el ticket como `'ready'` en la KDS.
  - *Esperado:* el punto de cocina cambia de ámbar a verde.

- [ ] **G4. Safety-net de 30 s (sin Realtime).**
  - *Pasos:* desconectar el WebSocket en DevTools (Network → Offline por 35 s).
    Hacer un cambio de sesión desde otra pestaña. Volver a Online.
  - *Esperado:* dentro de 30 s (el safety-net) el live floor se actualiza aunque
    el WebSocket haya fallado.

---

## H. Staff en `/salon/mesas` — live floor compartido

- [ ] **H1. Staff ve el mismo plano en vivo.**
  - *Pasos:* en la pestaña del **waiter**, navegar a `/{slug}/salon/mesas`.
  - *Esperado:* se renderiza la tab "Plano" con `LiveFloor` (plano visual).
    Las mesas están coloreadas por estado igual que en el live floor del dueño.

- [ ] **H2. Tap en mesa con sesión abierta (staff).**
  - *Pasos:* en la vista del staff, tocar una mesa ámbar (con sesión).
  - *Esperado:* navega a `/{slug}/salon/mesas/[sessionId]` (la pantalla de detalle de
    la sesión).

- [ ] **H3. Updates en tiempo real también llegan al staff.**
  - *Pasos:* con el live floor del staff abierto, cobrar una sesión desde otra pestaña.
  - *Esperado:* la mesa cambia a azul (estado `'paid'`) en la vista del staff dentro
    de ~2 s.

- [ ] **H4. Mesa sin sesión visible en la tab "Lista" (staff).**
  - *Pasos:* ir a la tab "Lista" en `/salon/mesas`.
  - *Esperado:* la grilla de cards muestra todas las mesas activas incluyendo las
    no ubicadas en el plano.

---

## I. Dark mode

- [ ] **I1. Dark mode en el editor.**
  - *Pasos:* activar dark mode desde el toggle del dueño. Volver al editor.
  - *Esperado:* el canvas, la grilla, las mesas, la decoración y el panel lateral
    tienen contraste AA en dark. Nada ilegible (especialmente decor sin color
    explícito → token neutral, no desaparece).

- [ ] **I2. Dark mode en el live floor.**
  - *Pasos:* activar dark mode; cambiar a "En vivo".
  - *Esperado:* los colores de estado (verde/ámbar/azul) siguen siendo perceptibles
    en dark; el texto de gasto/comensales/tiempo es legible.

---

## J. Accesibilidad — lista canónica

- [ ] **J1. Tab "Lista" siempre accesible.**
  - *Pasos:* en el editor (modo Editar), hacer Tab hasta llegar a la tab "Lista" y
    activarla.
  - *Esperado:* `TablesListFallback` se renderiza con todas las mesas y sus acciones
    (imprimir QR, activar/desactivar Switch, eliminar). No depende del canvas ni de
    pointer events.

- [ ] **J2. Elementos focusables en el canvas.**
  - *Pasos:* con el canvas en modo Editar, usar Tab para iterar por los elementos.
  - *Esperado:* cada `floor-element` es alcanzable por teclado; Enter abre el
    inspector.

- [ ] **J3. `aria-label` en elementos.**
  - *Pasos:* inspeccionar el DOM de un `floor-element` en DevTools.
  - *Esperado:* tiene `aria-label` con el tipo y la etiqueta (p. ej. `"Mesa 3"`,
    `"Pared"`). Sin tab-stops mudos.

- [ ] **J4. Fallback de error degrada a lista accesible.**
  - *Pasos:* forzar un error en el editor (p. ej. desde DevTools `throw new Error()`
    en la consola del componente raíz del canvas).
  - *Esperado:* el `FloorPlanErrorBoundary` atrapa el error y muestra el banner
    `role="alert"` + `TablesListFallback` sin perder la gestión de mesas.

---

## Resultado

- [ ] Todos los pasos A–J en **verde**.
- [ ] Pasos de bug-class v1 (C2, C3) muestran que el drift **no** ocurre.
- [ ] Screenshots/video adjuntos en el PR: canvas con mesas+decor en live,
      tarjeta completa (gasto/comensales/tiempo/cocina), toggle Editar/En vivo,
      staff `/salon/mesas` con LiveFloor, dark mode.
