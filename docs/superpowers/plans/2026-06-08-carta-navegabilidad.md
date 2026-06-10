# Navegabilidad de la carta del comensal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el comensal pueda volver desde el detalle de un producto en modo oscuro, y que el "atrás" del teléfono cierre el sheet abierto en vez de salir de la carta.

**Architecture:** Enfoque A (ver spec `docs/superpowers/specs/2026-06-08-carta-navegabilidad-design.md`). Lógica del History API aislada en una función pura `armBackGuard` (node-testeable) envuelta por un hook React `useDismissOnBack`. Al `Sheet` compartido se le agregan props/exports opt-in (`showClose`, `SheetGrabber`) sin romper usos existentes. El detalle de producto suma un botón ⟵ con scrim sobre la foto; los 3 sheets de la carta suman barrita + cierre con "atrás".

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript estricto, Tailwind v4 + shadcn (Radix Dialog), Vitest (`environment: node`), Biome.

**Branch:** `fix/carta-navegabilidad` (ya creada desde `origin/main`).

---

## Pre-requisito: Context7 (CLAUDE.md §13)

Antes de tocar código, consultá Context7 y confirmá:
- `shadcn/ui sheet` + `@radix-ui/react-dialog` (controlled open / `onOpenChange`): que renderizar condicionalmente `<SheetPrimitive.Close>` (vía `showClose`) no rompe nada, y que el `Sheet` ya se usa controlado en la carta.
- Comportamiento de `history.pushState` / `popstate` y su convivencia con el focus-trap / scroll-lock de Radix Dialog (no debería interferir: `popstate` solo dispara nuestro `onClose`, que baja el estado y Radix cierra normalmente).

Si Context7 contradice algún supuesto del plan, avisá antes de aplicar cambios.

---

## File Structure

- `lib/m-session/back-guard.ts` — **crear**. Función pura `armBackGuard(win, onClose)` + tipo `BackGuardWindow`. Única responsabilidad: la coreografía con el History API.
- `tests/lib/back-guard.test.ts` — **crear**. Unit de `armBackGuard` con una `window` falsa.
- `app/m/[qrToken]/_components/use-dismiss-on-back.ts` — **crear**. Hook React que envuelve `armBackGuard` (glue de ciclo de vida).
- `components/ui/sheet.tsx` — **modificar**. `showClose?` en `SheetContent`, X con mejor área de toque, export de `SheetGrabber`.
- `app/m/[qrToken]/_components/item-detail-sheet.tsx` — **modificar**. `showClose={false}`, botón ⟵ con scrim, `SheetGrabber tone="light"`, hook.
- `app/m/[qrToken]/_components/cart-sheet.tsx` — **modificar**. `SheetGrabber`, hook.
- `app/m/[qrToken]/_components/capture-sheet.tsx` — **modificar**. `SheetGrabber tone="light"`, hook.

---

## Task 1: `armBackGuard` — lógica pura del History API (TDD)

**Files:**
- Create: `lib/m-session/back-guard.ts`
- Test: `tests/lib/back-guard.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/lib/back-guard.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { armBackGuard, type BackGuardWindow } from '@/lib/m-session/back-guard'

/** Window falsa: history en memoria + registro de listeners de popstate. */
function makeFakeWindow() {
  const listeners: Record<string, Array<() => void>> = {}
  const stack: Array<unknown> = [null] // entrada inicial de la página
  return {
    history: {
      get state() {
        return stack[stack.length - 1] ?? null
      },
      pushState(state: unknown) {
        stack.push(state)
      },
      back() {
        if (stack.length > 1) stack.pop()
        for (const cb of listeners.popstate ?? []) cb()
      },
    },
    addEventListener(type: string, cb: () => void) {
      ;(listeners[type] ??= []).push(cb)
    },
    removeEventListener(type: string, cb: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb)
    },
    /** helper de test: simula el botón "atrás" del navegador */
    pressBack() {
      this.history.back()
    },
  }
}

describe('armBackGuard', () => {
  it('empuja una entrada al historial al armarse', () => {
    const win = makeFakeWindow()
    const push = vi.spyOn(win.history, 'pushState')
    armBackGuard(win as unknown as BackGuardWindow, () => {})
    expect(push).toHaveBeenCalledWith({ __mSheet: true }, '')
  })

  it('llama onClose cuando el usuario toca "atrás" (popstate)', () => {
    const win = makeFakeWindow()
    const onClose = vi.fn()
    armBackGuard(win as unknown as BackGuardWindow, onClose)
    win.pressBack()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('en cierre programático limpia la entrada con history.back()', () => {
    const win = makeFakeWindow()
    const back = vi.spyOn(win.history, 'back')
    const dispose = armBackGuard(win as unknown as BackGuardWindow, () => {})
    dispose()
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('no llama history.back() si el usuario ya tocó "atrás"', () => {
    const win = makeFakeWindow()
    const onClose = vi.fn()
    const dispose = armBackGuard(win as unknown as BackGuardWindow, onClose)
    win.pressBack() // consume la entrada dummy
    const back = vi.spyOn(win.history, 'back')
    dispose()
    expect(back).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/lib/back-guard.test.ts`
Expected: FAIL — no resuelve `@/lib/m-session/back-guard` ("Failed to resolve import" / "armBackGuard is not a function").

- [ ] **Step 3: Implementar `armBackGuard`**

Crear `lib/m-session/back-guard.ts`:

```ts
/**
 * Engancha un overlay/sheet al History API para que el botón/gesto "atrás"
 * del navegador lo cierre (llamando `onClose`) en vez de salir de la página.
 *
 * Al armarse empuja una entrada "dummy". Devuelve un disposer:
 * - si la entrada dummy sigue presente (cierre programático: botón ⟵ / scrim),
 *   hace `history.back()` para limpiarla;
 * - si el usuario ya tocó "atrás" (el `popstate` consumió la entrada), no hace nada.
 *
 * `win` se inyecta para poder testear en entorno node con un fake.
 */
export type BackGuardWindow = Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>

export function armBackGuard(win: BackGuardWindow, onClose: () => void): () => void {
  win.history.pushState({ __mSheet: true }, '')
  const onPop = () => onClose()
  win.addEventListener('popstate', onPop)
  return () => {
    win.removeEventListener('popstate', onPop)
    const state = win.history.state as { __mSheet?: boolean } | null
    if (state?.__mSheet) {
      win.history.back()
    }
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/lib/back-guard.test.ts`
Expected: PASS — 4 tests verdes.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/m-session/back-guard.ts tests/lib/back-guard.test.ts
git commit -m "feat(m-session): armBackGuard — cerrar sheet con el botón atrás del navegador"
```

---

## Task 2: Hook `useDismissOnBack`

**Files:**
- Create: `app/m/[qrToken]/_components/use-dismiss-on-back.ts`

Glue trivial de React sobre `armBackGuard` (Task 1). No lleva unit test (no hay infra DOM/renderer y el stack está cerrado); se valida en el smoke final.

- [ ] **Step 1: Crear el hook**

Crear `app/m/[qrToken]/_components/use-dismiss-on-back.ts`:

```ts
'use client'

import { useEffect, useRef } from 'react'
import { armBackGuard } from '@/lib/m-session/back-guard'

/**
 * Cierra un sheet/overlay cuando el usuario toca "atrás" en el teléfono,
 * en vez de salir de la carta. Activo solo mientras `open` sea true.
 */
export function useDismissOnBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    return armBackGuard(window, () => onCloseRef.current())
  }, [open])
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores (`window` real satisface `BackGuardWindow`).

- [ ] **Step 3: Commit**

```bash
git add "app/m/[qrToken]/_components/use-dismiss-on-back.ts"
git commit -m "feat(carta): hook useDismissOnBack para cerrar sheets con atrás del teléfono"
```

---

## Task 3: `Sheet` compartido — `showClose` + X más tocable + `SheetGrabber`

**Files:**
- Modify: `components/ui/sheet.tsx`

Cambios **aditivos y retrocompatibles**: `showClose` default `true`, `SheetGrabber` es opt-in.

- [ ] **Step 1: Agregar prop `showClose` y mejorar la X en `SheetContent`**

En `components/ui/sheet.tsx`, reemplazar la firma y el cierre por defecto de `SheetContent`.

Reemplazar:

```tsx
function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
```

por:

```tsx
function SheetContent({
  className,
  children,
  side = 'right',
  showClose = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showClose?: boolean
}) {
```

Y reemplazar el bloque del botón de cierre:

```tsx
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
```

por:

```tsx
        {children}
        {showClose && (
          <SheetPrimitive.Close className="ring-offset-background focus-visible:ring-ring absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Cerrar</span>
          </SheetPrimitive.Close>
        )}
```

- [ ] **Step 2: Agregar el componente `SheetGrabber`**

En `components/ui/sheet.tsx`, agregar esta función junto a las demás (p. ej. después de `SheetContent`):

```tsx
function SheetGrabber({
  tone = 'default',
  className,
}: {
  tone?: 'default' | 'light'
  className?: string
}) {
  return (
    <div
      aria-hidden
      data-slot="sheet-grabber"
      className={cn(
        'absolute left-1/2 top-2 z-20 h-1.5 w-10 -translate-x-1/2 rounded-full',
        tone === 'light' ? 'bg-white/70' : 'bg-foreground/25',
        className,
      )}
    />
  )
}
```

- [ ] **Step 3: Exportar `SheetGrabber`**

En el bloque `export { ... }` al final del archivo, agregar `SheetGrabber` (orden alfabético, después de `SheetFooter`):

```tsx
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetGrabber,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npx @biomejs/biome check components/ui/sheet.tsx`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/ui/sheet.tsx
git commit -m "feat(ui): Sheet con prop showClose, X más tocable y SheetGrabber"
```

---

## Task 4: `ItemDetailSheet` — botón ⟵ con scrim + barrita + atrás del teléfono

**Files:**
- Modify: `app/m/[qrToken]/_components/item-detail-sheet.tsx`

Es el bug reportado. El botón ⟵ usa un scrim oscuro fijo (`bg-black/55`) → visible en claro/oscuro y sobre cualquier foto.

- [ ] **Step 1: Actualizar imports**

Reemplazar:

```tsx
import { ImageOff, Minus, Plus, Sparkles } from 'lucide-react'
```

por:

```tsx
import { ArrowLeft, ImageOff, Minus, Plus, Sparkles } from 'lucide-react'
```

Reemplazar:

```tsx
import { Sheet, SheetContent } from '@/components/ui/sheet'
```

por:

```tsx
import { Sheet, SheetContent, SheetGrabber } from '@/components/ui/sheet'
```

Y agregar (junto a los imports relativos `./...`):

```tsx
import { useDismissOnBack } from './use-dismiss-on-back'
```

- [ ] **Step 2: Llamar al hook**

Localizar:

```tsx
  const open = item !== null
  const total = item ? item.price_cents * qty : 0
```

y dejarlo así (agregar la línea del hook entre medio):

```tsx
  const open = item !== null
  useDismissOnBack(open, onClose)
  const total = item ? item.price_cents * qty : 0
```

- [ ] **Step 3: Ocultar la X por defecto**

Reemplazar:

```tsx
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
```

por:

```tsx
      <SheetContent
        side="bottom"
        showClose={false}
        className="max-h-[92dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
```

- [ ] **Step 4: Agregar barrita + botón ⟵ sobre la foto**

Localizar la apertura del hero:

```tsx
              {/* HERO IMAGE con overlay */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                {item.image_url ? (
```

e insertar la barrita y el botón justo después de la apertura del `div` del hero (antes de `{item.image_url ? (`):

```tsx
              {/* HERO IMAGE con overlay */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                <SheetGrabber tone="light" />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Volver"
                  className="absolute left-3.5 top-3.5 z-20 flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <ArrowLeft className="size-5" />
                </button>
                {item.image_url ? (
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx @biomejs/biome check "app/m/[qrToken]/_components/item-detail-sheet.tsx"`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add "app/m/[qrToken]/_components/item-detail-sheet.tsx"
git commit -m "fix(carta): botón volver con scrim en el detalle de producto + atrás del teléfono"
```

---

## Task 5: `CartSheet` y `CaptureSheet` — barrita + atrás del teléfono

**Files:**
- Modify: `app/m/[qrToken]/_components/cart-sheet.tsx`
- Modify: `app/m/[qrToken]/_components/capture-sheet.tsx`

`CartSheet` va sobre `bg-background` (tono `default`); `CaptureSheet` va sobre el hero `bg-app-gradient` oscuro (tono `light`).

- [ ] **Step 1: `CartSheet` — imports**

En `app/m/[qrToken]/_components/cart-sheet.tsx`, reemplazar:

```tsx
import { Sheet, SheetContent } from '@/components/ui/sheet'
```

por:

```tsx
import { Sheet, SheetContent, SheetGrabber } from '@/components/ui/sheet'
```

Y agregar (junto a los imports relativos):

```tsx
import { useDismissOnBack } from './use-dismiss-on-back'
```

- [ ] **Step 2: `CartSheet` — llamar al hook**

Localizar:

```tsx
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
```

y agregar la línea del hook debajo:

```tsx
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDismissOnBack(true, onClose)
```

- [ ] **Step 3: `CartSheet` — agregar la barrita**

Localizar:

```tsx
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
        <div className="flex h-full flex-col">
```

e insertar `<SheetGrabber />` como primer hijo de `SheetContent`:

```tsx
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
        <SheetGrabber />
        <div className="flex h-full flex-col">
```

- [ ] **Step 4: `CaptureSheet` — imports**

En `app/m/[qrToken]/_components/capture-sheet.tsx`, reemplazar:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
```

por:

```tsx
import { Sheet, SheetContent, SheetGrabber, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useDismissOnBack } from './use-dismiss-on-back'
```

- [ ] **Step 5: `CaptureSheet` — hook + barrita**

Localizar el cuerpo del componente:

```tsx
}) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:max-w-md"
      >
        <SheetHeader className="sr-only">
```

y dejarlo así (hook antes del `return`, barrita como primer hijo de `SheetContent`):

```tsx
}) {
  useDismissOnBack(true, onClose)
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:max-w-md"
      >
        <SheetGrabber tone="light" />
        <SheetHeader className="sr-only">
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npx @biomejs/biome check "app/m/[qrToken]/_components/cart-sheet.tsx" "app/m/[qrToken]/_components/capture-sheet.tsx"`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add "app/m/[qrToken]/_components/cart-sheet.tsx" "app/m/[qrToken]/_components/capture-sheet.tsx"
git commit -m "feat(carta): barrita + atrás del teléfono en carrito y captura"
```

---

## Task 6: Verificación final + smoke manual

**Files:**
- Modify: `docs/carta-comensal-captura.md` (nota de navegación)

- [ ] **Step 1: Calidad completa**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: todo verde. (Es lo que corre husky pre-commit; debe pasar.)

- [ ] **Step 2: Smoke manual (documentar resultado en el PR)**

Levantar la carta (`/m/[qrToken]`) en el teléfono / DevTools mobile:
1. **Modo oscuro** + ítem con foto clara → abrir producto → el ⟵ con scrim se ve arriba-izquierda; tocarlo vuelve a la carta. **(bug original)**
2. Atrás del teléfono con **producto** abierto → cierra el producto, queda en la carta.
3. Idem con **carrito** abierto.
4. Idem con **captura** abierto.
5. Regresión en **modo claro**: producto, carrito y captura cierran bien (⟵ y X visibles).
6. Sheets del **manager/salón** (editar comensales / alias / mover mesa) sin cambios de comportamiento (la X más grande se ve bien).

- [ ] **Step 3: Nota en el doc de la carta**

Agregar al final de `docs/carta-comensal-captura.md`:

```markdown

## Navegación de sheets (2026-06-08)

Los sheets de la carta (detalle de producto, carrito, captura) se cierran con:
- botón ⟵ con scrim (producto) o X (carrito/captura),
- tocar fuera del sheet,
- el botón/gesto **"atrás"** del teléfono (vía hook `useDismissOnBack` → `lib/m-session/back-guard.ts`), que cierra el sheet abierto en vez de salir de la carta.

La barrita superior (`SheetGrabber`) es una señal visual; el swipe-to-dismiss real no está implementado (requeriría `vaul`).
```

- [ ] **Step 4: Commit**

```bash
git add docs/carta-comensal-captura.md
git commit -m "docs(carta): documentar navegación de sheets (volver + atrás del teléfono)"
```

---

## Notas de cierre

- **Branch ya creada:** `fix/carta-navegabilidad`. Al terminar, usar `superpowers:finishing-a-development-branch` para decidir merge/PR.
- **Sin migraciones, sin cambios de RLS, sin cambios de tipos** (`types/database.ts` no se toca).
- **`SheetGrabber` sin swipe real** es intencional (YAGNI; ver spec). Si más adelante se quiere swipe-to-dismiss, evaluar `vaul` para los 3 sheets de la carta.
