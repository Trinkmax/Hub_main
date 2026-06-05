# Smoke manual — Editor visual de plano de mesas

> Happy path del floor plan editor (spec §10). Ejecutar con la app levantada y
> registrar resultado + screenshots en el PR. Sin E2E automatizado en MVP.

## Pre-requisitos

- [ ] Migraciones `20260605000100_floor_plan_editor.sql` y `20260605000200_floor_plan_rpcs.sql`
      aplicadas (vía Supabase MCP `apply_migration`, proyecto `ogplsevtrclzxvyejlns`) y
      `types/database.ts` regenerado (`npm run db:types`).
- [ ] `npm run typecheck && npm run lint && npm run test:ci` en verde.
- [ ] App corriendo: `npm run dev` → http://localhost:3000
- [ ] Logueado como **owner**. Para los pasos de zero-área usar un tenant nuevo (sin el
      seed de HUB). Ruta del editor: `/{slug}/configuracion/mesas`.

---

## A. Áreas

- [ ] **A1. Tenant zero-área → empty state.** Entrar al editor con un tenant **sin áreas**.
  - *Esperado:* empty-state con CTA **"Crear primera área"** (sin canvas, sin error).
- [ ] **A2. Crear primera área.** Click en "Crear primera área".
  - *Esperado:* se crea el área (default `Salón`, `number_start=1`); el editor monta el
    canvas vacío de esa área; ya no aparece el empty-state.
- [ ] **A3. Crear segunda área.** En `area-manager`, crear `Planta Alta` con `number_start=101`.
  - *Esperado:* aparece como segunda tab/área; cambiar de tab muestra su canvas propio.
- [ ] **A4. Renombrar área.** Renombrar `Salón` → `Planta Baja`.
  - *Esperado:* el nombre se actualiza; recargar persiste el cambio.
- [ ] **A5. Editar canvas del área.** Cambiar `width/height` y `number_start` de un área.
  - *Esperado:* el stage cambia de tamaño; el `number_start` afecta la autosugerencia de
    número de la próxima mesa creada en esa área.
- [ ] **A6. Reordenar áreas.** Reordenar las áreas.
  - *Esperado:* el orden de las tabs cambia; recargar persiste (posiciones densas `0..n-1`).
- [ ] **A7. Borrar la última área → bloqueo.** En un tenant con **una sola** área, intentar
      borrarla.
  - *Esperado:* bloqueado con mensaje "No podés borrar la única área. Creá otra antes."
    (`cannot_delete_last_area`).
- [ ] **A8. Borrar área con mesa activa ubicada → bloqueo.** Con una mesa activa colocada en
      el área, intentar borrar esa área.
  - *Esperado:* bloqueado con "El área tiene mesas activas. Movélas o desactivalas antes de
    borrar el área." (`area_has_active_tables`).
- [ ] **A9. Borrar área vacía → OK.** Borrar un área sin mesas activas (existiendo ≥1 área más).
  - *Esperado:* el área desaparece; su decoración cae por cascade.

---

## B. Mesas (crear, mover, redimensionar)

- [ ] **B1. Crear mesa (QR + autosugerencia editable).** Desde la paleta, "agregar mesa".
  - *Esperado:* aparece una mesa en el canvas con número autosugerido desde el
    `number_start` del área (editable antes de confirmar); se le genera un `qr_token` de
    16 chars. El número se puede editar y persiste.
- [ ] **B2. Arrastrar con snap (scale=1).** Arrastrar la mesa por el canvas.
  - *Esperado:* la posición **snapea a la grilla de 20px** al soltar; un click corto
    (<8px) **selecciona** y abre el inspector, no mueve.
- [ ] **B3. Redimensionar (scale=1).** Arrastrar un handle de resize.
  - *Esperado:* la mesa cambia de tamaño (mínimo 24px); arrastrar el handle **no** dispara
    el drag de mover (no "pelean"); al soltar persiste.
- [ ] **B4. Zoom in + arrastrar.** Hacer zoom (+) y volver a arrastrar la mesa.
  - *Esperado:* con `scale>1` el snap y el clamp siguen correctos en espacio lógico (la
    mesa no "colapsa" ni salta); el elemento queda dentro del área.
- [ ] **B5. Redimensionar con zoom.** Redimensionar con `scale>1`.
  - *Esperado:* el tamaño cambia en proporción correcta; persiste al soltar.
- [ ] **B6. Pan.** Desplazar el plano (pan transform-based).
  - *Esperado:* el stage se mueve sin scroll nativo; las mesas mantienen su posición lógica.
- [ ] **B7. Fit / reset de zoom.** Usar el botón de fit/reset.
  - *Esperado:* el zoom/pan vuelve a encuadrar el área.

---

## C. Decoración

- [ ] **C1. Agregar decoración.** Agregar `pared`, `columna`, `isla` y `barra` desde la paleta.
  - *Esperado:* cada una aparece con sus defaults (pared 200×16 rect, columna 40×40 circle,
    isla 120×80 rect, barra 240×40 rect); ninguna tiene QR ni sesión.
- [ ] **C2. Editar decoración.** En `decor-inspector`, cambiar tamaño, etiqueta y color.
  - *Esperado:* cambios visibles y persistidos (color hex 6 dígitos); el shape **no** es
    editable.
- [ ] **C3. z-index decoración.** "Al frente / al fondo" sobre una decoración solapada con
      una mesa.
  - *Esperado:* el orden de apilado cambia coherentemente (render por `z_index`).
- [ ] **C4. Borrar decoración.** Borrar una decoración.
  - *Esperado:* desaparece del canvas.

---

## D. Gestión mesa-QR (dividir / combinar / activar)

- [ ] **D1. Dividir.** Con una mesa seleccionada, "dividir".
  - *Esperado:* se crea **otra** mesa-QR con su propio `qr_token`, mismo `shape`/capacidad,
    posicionada a `(source.x + width + grid, source.y)` clampeada al área; número
    autosugerido.
- [ ] **D2. Combinar (sin sesión).** Combinar dos mesas (confirmar el `AlertDialog`).
  - *Esperado:* la **absorbida** pasa a `active=false`, su elemento desaparece del canvas;
    la sobreviviente conserva su QR y su elemento. La absorbida no aparece en la bandeja
    (está inactiva).
- [ ] **D3. Combinar con sesión abierta → bloqueo.** Con una sesión **abierta** en la mesa
      a absorber, intentar combinar.
  - *Esperado:* bloqueado con "La mesa tiene una sesión abierta. Cerrá o cobrá la sesión
    antes de continuar." (`table_has_open_session`).
- [ ] **D4. Desactivar.** Desactivar una mesa (Switch en el inspector → RPC).
  - *Esperado:* la mesa sale del canvas (su elemento se borra). Queda inactiva.
- [ ] **D5. Desactivar con sesión abierta → bloqueo.** Intentar desactivar una mesa con
      sesión abierta.
  - *Esperado:* bloqueado con `table_has_open_session` (mismo mensaje que D3).
- [ ] **D6. Reactivar → vuelve a la bandeja.** Reactivar una mesa desactivada.
  - *Esperado:* `active=true`; la mesa aparece en la **bandeja de no ubicadas** (sin
    elemento en el canvas).
- [ ] **D7. Colocar "no ubicada".** Desde la bandeja, colocar/arrastrar la mesa al canvas.
  - *Esperado:* se crea su elemento en el área activa; sale de la bandeja.
- [ ] **D8. Quitar del plano.** "Quitar del plano" en una mesa colocada (sin sesión abierta).
  - *Esperado:* el elemento se borra pero la mesa **sigue activa** y reaparece en la
    bandeja. (Con sesión abierta, la UI deshabilita "quitar del plano" — best-effort UX.)
- [ ] **D9. Imprimir QR.** Usar `PrintQrButton` desde el inspector.
  - *Esperado:* abre `/print/qr/<token>` con el QR de la mesa.
- [ ] **D10. Regenerar token.** Regenerar el `qr_token`.
  - *Esperado:* el token cambia; el QR impreso refleja el nuevo.

---

## E. Accesibilidad / robustez

- [ ] **E1. Teclado.** Tab hasta un elemento → Enter.
  - *Esperado:* Enter/click **selecciona y abre el inspector**. El modo mover por teclado
    es aparte (pickup con barra espaciadora, flechas mueven una celda = `grid*scale` px,
    Esc cancela); Enter no choca entre "abrir inspector" y "levantar para arrastrar".
- [ ] **E2. Lectura por screen reader.** Verificar `aria-label` (kind + label) y
      `aria-roledescription` en elementos; anuncios de drag en **español**.
  - *Esperado:* elementos anunciados con su tipo/etiqueta; sin tab-stops mudos.
- [ ] **E3. Fallback de lista.** Abrir la tab/ruta secundaria de **lista accesible**.
  - *Esperado:* `tables-list-fallback` lista todas las mesas con las mismas acciones, sin
    canvas (camino accesible canónico).
- [ ] **E4. Dark mode.** Alternar dark mode.
  - *Esperado:* grilla, mesas y decoración (incl. decor sin color → token neutral) con
    contraste AA; nada ilegible.
- [ ] **E5. Fallo de persistencia → revert.** Simular un fallo del flush de geometría
      (p. ej. cortar la red en DevTools mientras se arrastra) y soltar.
  - *Esperado:* **toast de error** + el estado optimista de los ids afectados **se revierte**
    (o se marca dirty y reintenta); no queda una posición fantasma sin persistir.

---

## Resultado

- [ ] Todos los pasos A–E en **verde**; bloqueos (A7, A8, D3, D5) muestran el mensaje
      accionable correcto.
- [ ] Screenshots/video corto adjuntos en el PR (al menos: canvas con mesas+decor,
      bandeja de no ubicadas, un bloqueo con su toast, dark mode).
