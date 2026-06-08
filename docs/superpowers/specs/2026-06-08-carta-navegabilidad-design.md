# Spec — Navegabilidad de la carta del comensal (volver del producto + atrás del teléfono)

> Fecha: 2026-06-08 · Estado: aprobado para plan
> Workspace afectado: público `/m/[qrToken]` (comensal). Toca además el componente UI compartido `components/ui/sheet.tsx` (cambio aditivo, ver §6.1).
> Alcance acordado: "mejorar **un poco** la navegabilidad" — arreglar el bug del botón volver del producto en modo oscuro + hacer coherente la navegación con sheets.

---

## 1. Problema y objetivo

Cuando el comensal entra a un **producto** desde la carta (toca un ítem → se abre `ItemDetailSheet`, un bottom sheet con la foto del plato arriba), en **modo oscuro no encuentra cómo volver**. El sheet no renderiza un botón propio: usa la X de cierre por defecto del `Sheet` de shadcn — un ícono de 16px, sin fondo, `opacity-70`, que toma `currentColor`. Esa X va apoyada **sobre la foto del plato**: en modo oscuro el ícono resuelve blanco y, sobre fotos claras de comida, desaparece. (La X del sheet de captura sí se ve porque está sobre un fondo sólido oscuro; el drill-in de categorías ya tiene un botón ⟵ propio que funciona bien.)

**Objetivos:**

1. **Botón "volver" siempre visible en el detalle de producto**, en claro y oscuro, sobre cualquier foto.
2. **Navegación coherente con sheets**: el botón/gesto "atrás" del teléfono cierra el sheet abierto en vez de salir de toda la carta.
3. **Cierre consistente** en los tres sheets de la carta (producto, carrito, captura): mismo lenguaje visual y mismo comportamiento.

**No-objetivos (YAGNI):** swipe-to-dismiss real (requeriría `vaul`); rediseño del flujo de la carta; cambiar el drill-in de categorías; tocar tabs (Carta / Mis órdenes).

---

## 2. Estado actual (anclas de código)

- **Orquestador:** `app/m/[qrToken]/_components/mesa-screen.tsx` — mantiene `showRegister` (CaptureSheet), `showCart` (CartSheet), `showOrderConfirm` (OrderConfirmation). Los sheets se renderizan condicionalmente (montan al abrir / desmontan al cerrar).
- **Carta:** `menu-hub.tsx` — estado `selectedId` (drill-in de categoría, **no es sheet**, tiene su propio ⟵) y `opening` (ítem) → `ItemDetailSheet`.
- **Producto:** `item-detail-sheet.tsx` — `Sheet`/`SheetContent side="bottom"` con `p-0`; hero `relative aspect-[4/3]` arriba; **sin botón de cierre propio** (depende de la X por defecto).
- **Carrito:** `cart-sheet.tsx` — `Sheet open onOpenChange`; fondo sólido con header; usa la X por defecto.
- **Captura:** `capture-sheet.tsx` — idem; fondo sólido con `SheetHeader`/`SheetTitle`; usa la X por defecto.
- **Sheet compartido:** `components/ui/sheet.tsx` — `SheetContent` hardcodea al final `<SheetPrimitive.Close>` con `<XIcon className="size-4" />`, `absolute top-4 right-4`, `opacity-70`, sin fondo. Usado en toda la app (manager incluido).
- **Tema:** `/m` no fuerza tema; hereda el `ThemeProvider` del root layout (sistema/usuario). Las capturas reportadas están en oscuro.
- **Observación clave:** los sheets son **mutuamente excluyentes** — Radix Dialog es modal y bloquea el fondo, así que nunca hay dos abiertos a la vez. ⇒ el enganche al historial no necesita una pila.

---

## 3. Decisiones validadas (brainstorming)

| Tema | Decisión |
|---|---|
| Affordance de volver en el producto | **⟵ circular arriba-izquierda con scrim** (fondo negro semitransparente + ícono blanco) + **barrita** (drag handle) arriba-centro. Lee como "volver", igual patrón que el drill-in de categorías. |
| Visibilidad | El ⟵ del producto es **theme-independent** (scrim oscuro fijo): se ve en claro/oscuro y sobre cualquier foto. |
| Atrás del teléfono | Cierra el **sheet abierto** (no sale de la carta) en los **3 sheets**: producto, carrito, captura. |
| Cierre consistente | Los 3 sheets comparten lenguaje visual (barrita) y comportamiento (atrás cierra). |
| Enfoque de implementación | **A**: acotado a la carta + escotillas mínimas y aditivas en el `Sheet` compartido. |
| Barrita | **Señal visual** (no arrastra de verdad: Radix Dialog no trae swipe). Cierre real = ⟵ / tocar afuera / atrás del teléfono. |
| Swipe-to-dismiss real | Fuera de alcance (necesitaría `vaul`). Posible mejora futura. |
| Drill-in de categorías | Fuera de alcance; ya tiene ⟵. Posible extensión: que "atrás" en una categoría vuelva al hub (anotada, no incluida). |

---

## 4. Diseño

### 4.1 `components/ui/sheet.tsx` (cambios aditivos, retrocompatibles)

- **`SheetContent` gana `showClose?: boolean` (default `true`).** Si es `false`, no renderiza la `<SheetPrimitive.Close>` por defecto. Ningún uso actual cambia (default `true`).
- **Mejor área de toque de la X por defecto:** pasa de un ícono de 16px suelto a un botón circular ~32px (`size-8`) centrado, mismo color/semántica, hover sutil, foco accesible. Mejora todos los sheets de la app (cambio visual menor, ≥44px-ish de target). `sr-only` "Close" → "Cerrar".
- **Nuevo componente exportado `SheetGrabber`** (presentacional): barrita `absolute` arriba-centro, `aria-hidden`, con prop `tone?: 'default' | 'light'`.
  - `default`: `bg-foreground/25` (para fondos sólidos: carrito, captura).
  - `light`: `bg-white/70` (para cuando va sobre una foto: producto).

> Por qué `SheetGrabber` como componente y no un prop `grabber` de `SheetContent`: sobre la foto del producto necesita color claro y sobre fondo sólido color neutro. Un componente con `tone` deja el color correcto según contexto y mantiene el cambio en `SheetContent` reducido a `showClose`.

### 4.2 Lógica pura `armBackGuard` + hook `useDismissOnBack`

Para que la parte difícil (la danza con el History API) sea **testeable en `environment: node`** sin sumar deps de DOM (el stack está cerrado, §2 de CLAUDE.md), se separa en dos:

**(a) `armBackGuard(win, onClose)` — pura, node-testeable.** Archivo nuevo `lib/m-session/back-guard.ts`. Recibe un objeto `win` inyectable (`Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>`) ⇒ en test se le pasa un fake.

```ts
export function armBackGuard(
  win: Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>,
  onClose: () => void,
): () => void {
  win.history.pushState({ __mSheet: true }, '')
  const onPop = () => onClose()
  win.addEventListener('popstate', onPop)
  return () => {
    win.removeEventListener('popstate', onPop)
    // Cierre programático (botón ⟵ / scrim): sacamos la entrada dummy.
    if ((win.history.state as { __mSheet?: boolean } | null)?.__mSheet) {
      win.history.back()
    }
  }
}
```

**(b) `useDismissOnBack(open, onClose)` — wrapper fino de React.** Archivo nuevo `app/m/[qrToken]/_components/use-dismiss-on-back.ts`. No-op en SSR (`typeof window === 'undefined'`); usa `onClose` vía ref para no re-suscribir.

```ts
export function useDismissOnBack(open: boolean, onClose: () => void): void {
  const ref = useRef(onClose)
  useEffect(() => { ref.current = onClose })
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    return armBackGuard(window, () => ref.current())
  }, [open])
}
```

**Contrato:** mientras `open` sea `true`, el botón/gesto "atrás" del teléfono cierra el overlay (llama `onClose`) en vez de navegar fuera de la carta.

**Flujos:**
- Cierre por **atrás del teléfono**: `popstate` ya consumió la entrada dummy ⇒ en el cleanup `state.__mSheet` es falso ⇒ no hay doble `back()`.
- Cierre **programático** (⟵ / scrim): `open→false` ⇒ cleanup ⇒ dummy presente ⇒ `back()` la limpia (el listener se removió antes, no hay `onClose` extra).

**Edge cases:**
- Sheets uno-a-la-vez ⇒ a lo sumo una entrada dummy ⇒ sin pila.
- `router.refresh()`/navegación con un sheet abierto (cierre de sesión): la entrada dummy es inocua; el cleanup la limpia.

### 4.3 `ItemDetailSheet` (producto)

- `SheetContent` con `showClose={false}` (oculta la X por defecto).
- Dentro del hero (`relative aspect-[4/3]`), `z-10`:
  - `<SheetGrabber tone="light" />` arriba-centro.
  - **Botón ⟵** circular arriba-izquierda: `absolute left-3.5 top-3.5`, `size-9`, `rounded-full bg-black/55 text-white backdrop-blur-sm shadow`, hover `bg-black/70`, foco `ring-2 ring-white/70`, `aria-label="Volver"`, `onClick={onClose}`, `<ArrowLeft />`.
- `useDismissOnBack(item !== null, onClose)` (este sheet está siempre montado; `open` lo controla `item`).
- Resto del componente sin cambios.

### 4.4 `CartSheet` y `CaptureSheet`

- `<SheetGrabber />` (tono `default`, van sobre fondo sólido) al inicio del contenido.
- Conservan su X por defecto (ahora más tocable por §4.1).
- `useDismissOnBack(true, onClose)` (montan solo cuando están abiertos, así que `open` es efectivamente `true` mientras viven).

---

## 5. Resultado esperado

- Producto en modo oscuro sobre foto clara: ⟵ con scrim **siempre visible**; toca y vuelve a la carta. Bug resuelto.
- Atrás del teléfono en cualquiera de los 3 sheets: **cierra el sheet** y deja al comensal en la carta (no lo expulsa).
- Los 3 sheets comparten barrita + comportamiento de atrás. El producto suma el ⟵.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cambiar `sheet.tsx` afecta toda la app | Cambios **aditivos**: `showClose` default `true`, `SheetGrabber` es opt-in. La X más grande es un ajuste visual menor; se verifica con smoke que los sheets del manager (party size, alias, mover mesa, etc.) sigan bien. |
| History API + scroll-lock/foco de Radix | Consultar **Context7** (Radix `@radix-ui/react-dialog`, open controlado/`modal`) antes de codear; confirmar que `pushState`/`popstate` no interfieren con el manejo de foco. |
| `popstate` mal manejado (doble back / loop) | Patrón probado: remover listener antes del `back()` programático; guardia `__mSheet` en `history.state`. Cubierto por unit test de `armBackGuard`. |
| Stack de test cerrado (sin jsdom/`@testing-library/react`, `environment: node`) | No se suman deps. La lógica difícil vive en `armBackGuard` (pura, inyectable) y se testea en node con un `win` fake. El wrapper React `useDismissOnBack` (glue trivial) se valida por smoke manual. |

---

## 7. Testing y verificación (DoD)

- **Unit (Vitest, `environment: node`):** `tests/lib/back-guard.test.ts` — `armBackGuard` con un `win` fake (history que registra `pushState`/`state`/`back`, add/removeEventListener que captura el handler): verifica `pushState({__mSheet:true})` al armar, que el handler de `popstate` llama `onClose`, que el disposer hace `back()` solo si la entrada dummy sigue presente y no la hace si ya se consumió. El wrapper `useDismissOnBack` no se unit-testea (glue React trivial sin infra DOM) → smoke.
- **Context7:** Radix dialog + shadcn sheet antes de implementar (CLAUDE.md §13).
- **Smoke manual documentado en el PR:**
  1. Modo oscuro + ítem con foto clara → ⟵ visible; toca → vuelve a la carta.
  2. Atrás del teléfono con producto abierto → cierra producto, queda en carta.
  3. Idem con carrito y con captura.
  4. Regresión en modo claro (producto, carrito, captura).
  5. Sheets del manager (salón: editar comensales / alias / mover mesa) sin cambios de comportamiento.
- **Calidad:** `npm run typecheck` + Biome + `npm run test:ci` verdes.

---

## 8. Archivos a tocar

- `components/ui/sheet.tsx` — `showClose` en `SheetContent`, X más tocable, export `SheetGrabber`.
- `lib/m-session/back-guard.ts` — **nuevo** `armBackGuard` (lógica pura, node-testeable).
- `app/m/[qrToken]/_components/use-dismiss-on-back.ts` — **nuevo** hook wrapper.
- `app/m/[qrToken]/_components/item-detail-sheet.tsx` — `showClose={false}`, ⟵ con scrim, `SheetGrabber tone="light"`, hook.
- `app/m/[qrToken]/_components/cart-sheet.tsx` — `SheetGrabber`, hook.
- `app/m/[qrToken]/_components/capture-sheet.tsx` — `SheetGrabber`, hook.
- `tests/lib/back-guard.test.ts` — **nuevo** unit de `armBackGuard`.
