# Rediseño Mensajería · Fase 0 (IA y navegación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar la superficie de mensajería en una sección `/mensajeria` con sub-nav lateral propio, mover las rutas dispersas ahí adentro (con redirects), unificar la taxonomía a "Mensajería", y darle hogar a las etiquetas de conversación — sin tocar la lógica de negocio.

**Architecture:** Route group `app/(manager)/[tenantSlug]/mensajeria/` con un `layout.tsx` que espeja el patrón de `configuracion/layout.tsx` (aside sticky con sub-nav + `flex-1` de contenido). Las páginas existentes (`bandeja`, `difusiones`, `flows`, `audiencias`, y las 3 de config de mensajería) se **mueven** (carpetas enteras) bajo `/mensajeria/*`; las rutas viejas quedan como **redirects 308** en `next.config.ts`. El sub-nav se filtra por rol con una función pura testeable. "Tags de carta" (item-tags, del menú) se muda a `/menu/tags`. El hub muerto `/marketing` se elimina.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), React 19, TypeScript estricto, Tailwind v4 + shadcn new-york, Vitest, Biome, lucide-react.

## Global Constraints

- **Multi-tenant LAW:** toda Server Action valida `requireTenantAccess(slug)` + `requireRole(role, [...])`. No tocar esos checks al mover archivos.
- **Copy en español rioplatense (es-AR).**
- **Server Components por defecto**; `'use client'` sólo si hay interactividad.
- **Sin `any`** (usar `unknown` + narrowing). Imports absolutos desde `@/`.
- **Naming:** archivos `kebab-case.tsx`, componentes `PascalCase`, server actions `camelCase`.
- **Redirects de rutas movidas: `permanent: true` (308).**
- **Calidad antes de cada commit:** `npm run typecheck && npm run lint` verdes (el pre-commit de husky corre `typecheck && lint && test:ci`).
- **Conventional Commits.**
- **Base:** rama `feat/mensajeria-rediseno` sobre `origin/main`. NO editar migraciones aplicadas.
- **Fuera de alcance:** rediseño visual/estados de cada pantalla, fixes operativos/seguridad de la auditoría, Instagram. El **Inbox full-width** se difiere al spec del Inbox (en Fase 0 el inbox renderiza dentro de la sección, constreñido).

---

### Task 1: Section shell (sub-nav + layout + índice)

Crea la sección y su navegación. El sub-nav apunta a `/mensajeria/*`; esos destinos entran en línea a medida que las tareas 2–4 mueven las páginas (mientras tanto redirigen o 404ean — aceptable dentro del plan).

**Files:**
- Create: `components/shell/messaging-nav.ts` (datos + función pura de visibilidad)
- Create: `app/(manager)/[tenantSlug]/mensajeria/_components/mensajeria-nav.tsx` (client, sub-nav)
- Create: `app/(manager)/[tenantSlug]/mensajeria/layout.tsx` (server, espeja configuracion/layout)
- Create: `app/(manager)/[tenantSlug]/mensajeria/page.tsx` (redirect → inbox)
- Modify: `components/shell/nav-icons.ts` (agregar `Tag`)
- Test: `tests/lib/messaging-nav.test.ts`

**Interfaces:**
- Produces: `MESSAGING_NAV: MessagingNavGroup[]`, `visibleMessagingNav(role: TenantRole): MessagingNavGroup[]`, tipos `MessagingNavItem { label: string; segment: string; icon: NavIconKey; roles?: TenantRole[] }` y `MessagingNavGroup { label?: string; items: MessagingNavItem[] }`. Consumidos por `MensajeriaNav` (Task 1) y disponibles para el sidebar (Task 5).

- [ ] **Step 1: Escribir el test que falla**

`tests/lib/messaging-nav.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { visibleMessagingNav } from '@/components/shell/messaging-nav'

describe('visibleMessagingNav', () => {
  it('owner ve todos los ítems (inbox + campañas + configuración)', () => {
    const labels = visibleMessagingNav('owner').flatMap((g) => g.items.map((i) => i.label))
    expect(labels).toEqual([
      'Inbox',
      'Difusiones',
      'Flows',
      'Audiencias',
      'Canales',
      'Plantillas',
      'Mensajes rápidos',
      'Etiquetas',
    ])
  })

  it('cashier ve sólo Inbox + Mensajes rápidos', () => {
    const labels = visibleMessagingNav('cashier').flatMap((g) => g.items.map((i) => i.label))
    expect(labels).toEqual(['Inbox', 'Mensajes rápidos'])
  })

  it('no devuelve grupos vacíos', () => {
    for (const group of visibleMessagingNav('cashier')) {
      expect(group.items.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/lib/messaging-nav.test.ts`
Expected: FAIL — "Cannot find module '@/components/shell/messaging-nav'".

- [ ] **Step 3: Implementar `messaging-nav.ts`**

`components/shell/messaging-nav.ts`:
```ts
import type { TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'

export type MessagingNavItem = {
  label: string
  /** Segmento bajo /mensajeria (ej. 'inbox', 'difusiones'). */
  segment: string
  icon: NavIconKey
  /** Si está, sólo estos roles lo ven. Si no, todos. */
  roles?: TenantRole[]
}

export type MessagingNavGroup = {
  /** Rótulo del grupo. Sin rótulo = grupo hero (Inbox). */
  label?: string
  items: MessagingNavItem[]
}

export const MESSAGING_NAV: MessagingNavGroup[] = [
  { items: [{ label: 'Inbox', segment: 'inbox', icon: 'Inbox' }] },
  {
    label: 'Campañas',
    items: [
      { label: 'Difusiones', segment: 'difusiones', icon: 'Megaphone', roles: ['owner'] },
      { label: 'Flows', segment: 'flows', icon: 'Workflow', roles: ['owner'] },
      { label: 'Audiencias', segment: 'audiencias', icon: 'UsersRound', roles: ['owner'] },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { label: 'Canales', segment: 'canales', icon: 'Settings2', roles: ['owner'] },
      { label: 'Plantillas', segment: 'plantillas', icon: 'MessageSquareText', roles: ['owner'] },
      {
        label: 'Mensajes rápidos',
        segment: 'mensajes-rapidos',
        icon: 'Zap',
        roles: ['owner', 'cashier'],
      },
      { label: 'Etiquetas', segment: 'etiquetas', icon: 'Tag', roles: ['owner', 'cashier'] },
    ],
  },
]

/** Filtra por rol y descarta grupos que quedan vacíos. */
export function visibleMessagingNav(role: TenantRole): MessagingNavGroup[] {
  return MESSAGING_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}
```

- [ ] **Step 4: Agregar el ícono `Tag` a `nav-icons.ts`**

En `components/shell/nav-icons.ts`: agregar `Tag` al import de `lucide-react` (orden alfabético, antes de `Tags`… no existe `Tags` acá; ponerlo antes de `Users`) y al objeto `NAV_ICONS`.
- Import: agregar `Tag,` en la lista (entre `Stamp,` `Star,` y `Users,` → alfabético: `Star, Tag, Users`).
- Objeto: agregar `Tag,` entre `Star,` y `Users,`.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/lib/messaging-nav.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Implementar el sub-nav client `mensajeria-nav.tsx`**

`app/(manager)/[tenantSlug]/mensajeria/_components/mensajeria-nav.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ICONS } from '@/components/shell/nav-icons'
import { type MessagingNavGroup, visibleMessagingNav } from '@/components/shell/messaging-nav'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'

export function MensajeriaNav({ tenantSlug, role }: { tenantSlug: string; role: TenantRole }) {
  const pathname = usePathname()
  const groups: MessagingNavGroup[] = visibleMessagingNav(role)

  return (
    <nav className="w-60 space-y-5">
      {groups.map((group, gi) => (
        <div key={group.label ?? `hero-${gi}`} className="space-y-1.5">
          {group.label ? (
            <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              {group.label}
            </div>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const href = `/${tenantSlug}/mensajeria/${item.segment}`
              const active = pathname === href || pathname.startsWith(`${href}/`)
              const Icon = NAV_ICONS[item.icon]
              return (
                <li key={item.segment}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                      active
                        ? 'bg-secondary font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 7: Implementar el layout de la sección**

`app/(manager)/[tenantSlug]/mensajeria/layout.tsx`:
```tsx
import type { ReactNode } from 'react'
import { requireTenantAccess } from '@/lib/tenant'
import { MensajeriaNav } from './_components/mensajeria-nav'

export default async function MensajeriaLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { role } = await requireTenantAccess(tenantSlug)

  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:flex lg:py-8">
      <aside className="hidden shrink-0 lg:block">
        <div className="sticky top-20">
          <MensajeriaNav tenantSlug={tenantSlug} role={role} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
```

- [ ] **Step 8: Implementar el índice de la sección (redirect a inbox)**

`app/(manager)/[tenantSlug]/mensajeria/page.tsx`:
```tsx
import { redirect } from 'next/navigation'

export default async function MensajeriaIndex({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/mensajeria/inbox`)
}
```

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores. (El sub-nav referencia rutas que aún no existen; eso no rompe el type-check.)

- [ ] **Step 10: Commit**

```bash
git add components/shell/messaging-nav.ts components/shell/nav-icons.ts \
  "app/(manager)/[tenantSlug]/mensajeria/" tests/lib/messaging-nav.test.ts
git commit -m "feat(mensajeria): shell de la sección (sub-nav + layout + índice)"
```

---

### Task 2: Mover el Inbox (bandeja → mensajeria/inbox)

**Files:**
- Move: `app/(manager)/[tenantSlug]/bandeja/` → `app/(manager)/[tenantSlug]/mensajeria/inbox/`
- Modify: `app/(manager)/[tenantSlug]/mensajeria/inbox/page.tsx` (eyebrow), `.../inbox/loading.tsx` (eyebrow)
- Modify: `lib/conversation-tags/actions.ts` (3× revalidatePath), `lib/meta/actions.ts` (3× revalidatePath)
- Modify: `components/messaging/contact-customer-sheet.tsx` (2× href)
- Modify: `next.config.ts` (redirect)

- [ ] **Step 1: Mover la carpeta**

```bash
git mv "app/(manager)/[tenantSlug]/bandeja" "app/(manager)/[tenantSlug]/mensajeria/inbox"
```

- [ ] **Step 2: Cambiar el eyebrow del inbox**

En `app/(manager)/[tenantSlug]/mensajeria/inbox/page.tsx` y `.../loading.tsx`: reemplazar `eyebrow="Hoy"` por `eyebrow="Mensajería"`.

- [ ] **Step 3: Actualizar `revalidatePath` de `/bandeja` → `/mensajeria/inbox`**

Reemplazar `` `/${slug}/bandeja` `` por `` `/${slug}/mensajeria/inbox` `` en:
- `lib/conversation-tags/actions.ts:93,131,249`
- `lib/meta/actions.ts:195,207,248`

- [ ] **Step 4: Actualizar el link del ContactButton**

En `components/messaging/contact-customer-sheet.tsx:118,163`: reemplazar `` href={`/${tenantSlug}/bandeja?c=${result.conversationId}`} `` por `` href={`/${tenantSlug}/mensajeria/inbox?c=${result.conversationId}`} ``.

- [ ] **Step 5: Agregar el redirect en `next.config.ts`**

Dentro del array que devuelve `async redirects()`, agregar:
```ts
      { source: '/:slug/bandeja', destination: '/:slug/mensajeria/inbox', permanent: true },
      { source: '/:slug/bandeja/:rest*', destination: '/:slug/mensajeria/inbox/:rest*', permanent: true },
```

- [ ] **Step 6: Verificar que no quedaron referencias sueltas a `/bandeja`**

Run: `grep -rn "/bandeja" app lib components --include=*.ts --include=*.tsx | grep -v "salon"`
Expected: sin resultados (las de `salon/bandeja` son el inbox huérfano del salón, fuera de scope acá).

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

- [ ] **Step 8: Smoke manual**

`npm run dev`. Visitar `/hub/bandeja` → debe redirigir a `/hub/mensajeria/inbox` y renderizar el inbox. El botón "Contactar" (en un cliente) abre el thread en la nueva ruta.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(mensajeria): mover Inbox a /mensajeria/inbox + redirect"
```

---

### Task 3: Mover el trío de campañas (difusiones, flows, audiencias)

**Files:**
- Move: `difusiones/` → `mensajeria/difusiones/`, `flows/` → `mensajeria/flows/`, `audiencias/` → `mensajeria/audiencias/`
- Modify eyebrows (10 archivos): las 3 páginas × sus subrutas
- Modify: `lib/audiences/actions.ts` (4×), `lib/stats/audience-from-list.ts` (1×), `lib/broadcasts/actions.ts` (4×), `lib/flows/actions.ts` (4×), `lib/flows/graph-actions.ts` (1×) — revalidatePath
- Modify: `next.config.ts` (3 pares de redirects)

- [ ] **Step 1: Mover las tres carpetas**

```bash
git mv "app/(manager)/[tenantSlug]/difusiones" "app/(manager)/[tenantSlug]/mensajeria/difusiones"
git mv "app/(manager)/[tenantSlug]/flows" "app/(manager)/[tenantSlug]/mensajeria/flows"
git mv "app/(manager)/[tenantSlug]/audiencias" "app/(manager)/[tenantSlug]/mensajeria/audiencias"
```

- [ ] **Step 2: Unificar eyebrows a "Mensajería"**

Reemplazar `eyebrow="Marketing"` por `eyebrow="Mensajería"` y `eyebrow="Marketing · Difusión"` por `eyebrow="Mensajería · Difusión"` en:
- `mensajeria/difusiones/{page,nueva/page,[id]/page}.tsx`
- `mensajeria/flows/{page,nuevo/page,[id]/page}.tsx` (el `[id]/page.tsx` tiene 2 ocurrencias)
- `mensajeria/audiencias/{page,nueva/page,[id]/page}.tsx`

Comando de ayuda para localizarlos:
`grep -rln 'eyebrow="Marketing' "app/(manager)/[tenantSlug]/mensajeria"`

- [ ] **Step 3: Actualizar revalidatePath**

Reemplazos exactos:
- `` `/${slug}/audiencias` `` → `` `/${slug}/mensajeria/audiencias` `` en `lib/audiences/actions.ts:85,120,189,204` y `lib/stats/audience-from-list.ts:48`
- `` `/${slug}/difusiones` `` → `` `/${slug}/mensajeria/difusiones` `` y `` `/${slug}/difusiones/${id}` `` → `` `/${slug}/mensajeria/difusiones/${id}` `` en `lib/broadcasts/actions.ts:121,142,163,202`
- `` `/${slug}/flows` `` → `` `/${slug}/mensajeria/flows` `` en `lib/flows/actions.ts:85,134,155,175` y `lib/flows/graph-actions.ts:118`

- [ ] **Step 4: Redirects en `next.config.ts`**

```ts
      { source: '/:slug/difusiones', destination: '/:slug/mensajeria/difusiones', permanent: true },
      { source: '/:slug/difusiones/:rest*', destination: '/:slug/mensajeria/difusiones/:rest*', permanent: true },
      { source: '/:slug/flows', destination: '/:slug/mensajeria/flows', permanent: true },
      { source: '/:slug/flows/:rest*', destination: '/:slug/mensajeria/flows/:rest*', permanent: true },
      { source: '/:slug/audiencias', destination: '/:slug/mensajeria/audiencias', permanent: true },
      { source: '/:slug/audiencias/:rest*', destination: '/:slug/mensajeria/audiencias/:rest*', permanent: true },
```

- [ ] **Step 5: Verificar referencias sueltas**

Run: `grep -rn "eyebrow=\"Marketing" app; grep -rn "/${slug}/\(difusiones\|flows\|audiencias\)\b" lib`
Expected: sin resultados salvo `/marketing` (se elimina en Task 7) y `next.config.ts` (los redirects).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

- [ ] **Step 7: Smoke manual**

`/hub/difusiones`, `/hub/flows`, `/hub/audiencias` redirigen a `/hub/mensajeria/...`, renderizan dentro de la sección (con el sub-nav a la izquierda), y el eyebrow dice "Mensajería".

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(mensajeria): mover difusiones/flows/audiencias a la sección + eyebrow unificado"
```

---

### Task 4: Mover la config de mensajería (canales, plantillas, mensajes-rápidos)

**Files:**
- Move: `configuracion/canales/` → `mensajeria/canales/`, `configuracion/templates/` → `mensajeria/plantillas/`, `configuracion/mensajes-rapidos/` → `mensajeria/mensajes-rapidos/`
- Modify: `configuracion/_components/settings-nav.tsx` (quitar grupo "Mensajería")
- Modify: `lib/meta/actions.ts` (canales + templates revalidatePath), `lib/meta/template-actions.ts` (2×), `lib/quick-messages/actions.ts` (3×)
- Modify: `next.config.ts` (3 redirects)

- [ ] **Step 1: Mover las carpetas**

```bash
git mv "app/(manager)/[tenantSlug]/configuracion/canales" "app/(manager)/[tenantSlug]/mensajeria/canales"
git mv "app/(manager)/[tenantSlug]/configuracion/templates" "app/(manager)/[tenantSlug]/mensajeria/plantillas"
git mv "app/(manager)/[tenantSlug]/configuracion/mensajes-rapidos" "app/(manager)/[tenantSlug]/mensajeria/mensajes-rapidos"
```

- [ ] **Step 2: Quitar el grupo "Mensajería" del settings-nav**

En `app/(manager)/[tenantSlug]/configuracion/_components/settings-nav.tsx`: borrar del array `GROUPS` el objeto `{ label: 'Mensajería', icon: MessageCircle, items: [...] }` completo (líneas 25–34). Quitar el import de `MessageCircle` si queda sin uso (dejar `Palette, UsersRound`).

- [ ] **Step 3: Actualizar revalidatePath**

- `` `/${slug}/configuracion/canales` `` → `` `/${slug}/mensajeria/canales` `` en `lib/meta/actions.ts:88`
- `` `/${slug}/configuracion/templates` `` → `` `/${slug}/mensajeria/plantillas` `` en `lib/meta/actions.ts:114`, `lib/meta/template-actions.ts:92,145`
- `` `/${slug}/configuracion/mensajes-rapidos` `` → `` `/${slug}/mensajeria/mensajes-rapidos` `` en `lib/quick-messages/actions.ts:83,135,169`

- [ ] **Step 4: Redirects en `next.config.ts`**

```ts
      { source: '/:slug/configuracion/canales', destination: '/:slug/mensajeria/canales', permanent: true },
      { source: '/:slug/configuracion/templates', destination: '/:slug/mensajeria/plantillas', permanent: true },
      { source: '/:slug/configuracion/mensajes-rapidos', destination: '/:slug/mensajeria/mensajes-rapidos', permanent: true },
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores (verificar que `MessageCircle` sin uso no dispare warning).

- [ ] **Step 6: Smoke manual**

`/hub/configuracion/canales` redirige a `/hub/mensajeria/canales`. El sub-nav de Configuración ya NO muestra el grupo "Mensajería". Las 3 páginas renderizan dentro de la sección Mensajería.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mensajeria): mover canales/plantillas/rápidos a la sección + limpiar settings-nav"
```

---

### Task 5: Colapsar el sidebar + actualizar el command palette

**Files:**
- Modify: `components/shell/nav-config.ts` (item "Mensajería": un solo ítem sin children)
- Modify: `components/command-palette/command-config.ts` (hrefs + keyword)

- [ ] **Step 1: Colapsar el ítem "Mensajería" en `nav-config.ts`**

Reemplazar el objeto del ítem "Mensajería" (líneas 68–102, el que tiene `children: [...]`) por:
```ts
      {
        // Hub de comunicación con el cliente. Navega a la sección; su propia
        // navegación (Inbox/Difusiones/Flows/Audiencias/Config) vive en el sub-nav.
        label: 'Mensajería',
        href: (s) => `/${s}/mensajeria`,
        icon: 'MessageCircle',
      },
```

- [ ] **Step 2: Actualizar los hrefs del command palette**

En `components/command-palette/command-config.ts`, reemplazar los `href` de estas entradas:
- `new-broadcast`: `` `/${s}/difusiones/nueva` `` → `` `/${s}/mensajeria/difusiones/nueva` ``
- `inbox`: `` `/${s}/bandeja` `` → `` `/${s}/mensajeria/inbox` ``; y `label: 'Bandeja'` → `label: 'Inbox'`; agregar `'bandeja'` a keywords.
- `new-flow`: `` `/${s}/flows/nuevo` `` → `` `/${s}/mensajeria/flows/nuevo` ``
- `audiences`: `` `/${s}/audiencias` `` → `` `/${s}/mensajeria/audiencias` ``
- `broadcasts`: `` `/${s}/difusiones` `` → `` `/${s}/mensajeria/difusiones` ``
- `flows`: `` `/${s}/flows` `` → `` `/${s}/mensajeria/flows` ``
- `templates`: `` `/${s}/configuracion/templates` `` → `` `/${s}/mensajeria/plantillas` ``

Agregar `'mensajeria'` a los `keywords` de `inbox`, `broadcasts`, `flows` y `audiences`.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

- [ ] **Step 4: Smoke manual**

Sidebar: un solo "Mensajería" (sin children) que abre la sección. ⌘K → "Difusiones", "Inbox", "Flows", "Audiencias", "Plantillas" llevan a las rutas nuevas. Con un usuario `cashier`, el sub-nav de la sección muestra sólo Inbox + Mensajes rápidos.

- [ ] **Step 5: Commit**

```bash
git add components/shell/nav-config.ts components/command-palette/command-config.ts
git commit -m "feat(mensajeria): colapsar sidebar a un ítem + repuntar command palette"
```

---

### Task 6: Etiquetas de conversación con hogar propio

Agrega `updateConversationTag` (renombrar/color) y la página de gestión con **paleta curada** (no hex crudo — hallazgo de la auditoría).

**Files:**
- Modify: `lib/conversation-tags/schemas.ts` (schema de update + paleta)
- Modify: `lib/conversation-tags/actions.ts` (`updateConversationTag`)
- Create: `app/(manager)/[tenantSlug]/mensajeria/etiquetas/page.tsx`
- Create: `app/(manager)/[tenantSlug]/mensajeria/etiquetas/loading.tsx`
- Create: `app/(manager)/[tenantSlug]/mensajeria/etiquetas/_components/tags-manager.tsx` (client)
- Test: `tests/lib/conversation-tags-schemas.test.ts`

**Interfaces:**
- Produces: `updateConversationTagSchema`, `TAG_COLORS: readonly string[]`, `updateConversationTag(slug, prev, formData): Promise<ConversationTagActionState>`.

- [ ] **Step 1: Escribir el test que falla**

`tests/lib/conversation-tags-schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { TAG_COLORS, updateConversationTagSchema } from '@/lib/conversation-tags/schemas'

describe('updateConversationTagSchema', () => {
  it('acepta id + name + color válidos', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'VIP',
      color: TAG_COLORS[0],
    })
    expect(r.success).toBe(true)
  })
  it('rechaza name vacío', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      name: '   ',
      color: TAG_COLORS[0],
    })
    expect(r.success).toBe(false)
  })
  it('rechaza color fuera de la paleta', () => {
    const r = updateConversationTagSchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'VIP',
      color: '#123456',
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/lib/conversation-tags-schemas.test.ts`
Expected: FAIL — `TAG_COLORS`/`updateConversationTagSchema` no existen.

- [ ] **Step 3: Extender `schemas.ts`**

Agregar en `lib/conversation-tags/schemas.ts`:
```ts
/** Paleta curada — evita hex crudo que rompe el contraste de los tokens OKLCH. */
export const TAG_COLORS = [
  '#94a3b8', // slate
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#4ade80', // green
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
] as const

const paletteColor = z.enum(TAG_COLORS, { message: 'Elegí un color de la paleta' })

export const updateConversationTagSchema = z.object({
  id: z.string().uuid('ID inválido'),
  name: nameField,
  color: paletteColor,
})
```
(Nota: `createConversationTagSchema.color` puede quedar con el regex hex existente para no romper tags viejos; la UI nueva sólo ofrece `TAG_COLORS`.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/lib/conversation-tags-schemas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Agregar `updateConversationTag` a `actions.ts`**

Agregar (importando `updateConversationTagSchema` en el import de `./schemas`):
```ts
export async function updateConversationTag(
  slug: string,
  _prev: ConversationTagActionState,
  formData: FormData,
): Promise<ConversationTagActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateConversationTagSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    color: formData.get('color'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('conversation_tags')
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe una etiqueta con ese nombre.' }
    }
    console.error('[conversation-tags.update]', error.message)
    return { ok: false, message: 'No pudimos actualizar la etiqueta.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'conversation_tag.updated',
    entity: 'conversation_tag',
    entityId: parsed.data.id,
    payload: { name: parsed.data.name, color: parsed.data.color },
  })

  revalidatePath(`/${slug}/mensajeria/etiquetas`)
  revalidatePath(`/${slug}/mensajeria/inbox`)
  return { ok: true }
}
```
Además: actualizar los `revalidatePath('/${slug}/bandeja')` restantes de `create`/`delete` (líneas 93,131 — ya cambiados a `/mensajeria/inbox` en Task 2) para que **también** revaliden `/mensajeria/etiquetas`. (Agregar una segunda línea `revalidatePath(\`/${slug}/mensajeria/etiquetas\`)` en `createConversationTag` y `deleteConversationTag`.)

- [ ] **Step 6: Crear la página + loading**

`app/(manager)/[tenantSlug]/mensajeria/etiquetas/page.tsx`:
```tsx
import { PageHeader } from '@/components/ui/page-header'
import { listConversationTags } from '@/lib/conversation-tags/queries'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { TagsManager } from './_components/tags-manager'

export const metadata = { title: 'Etiquetas de conversación' }

export default async function EtiquetasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant, role } = await requireTenantAccess(tenantSlug)
  requireRole(role, ['owner', 'cashier'])
  const tags = await listConversationTags(tenant.id)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Mensajería"
        title="Etiquetas de conversación"
        description="Organizá las conversaciones del inbox con etiquetas de color."
      />
      <TagsManager tenantSlug={tenantSlug} tags={tags} />
    </div>
  )
}
```

`app/(manager)/[tenantSlug]/mensajeria/etiquetas/loading.tsx`:
```tsx
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mensajería" title="Etiquetas de conversación" description={<Skeleton className="h-4 w-80" />} />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Crear el client `tags-manager.tsx`**

`app/(manager)/[tenantSlug]/mensajeria/etiquetas/_components/tags-manager.tsx`: componente client que:
- lista los `tags` (nombre + swatch de color),
- un form de alta (`useActionState(createConversationTag.bind(null, tenantSlug))`) con input de nombre + selector de color desde `TAG_COLORS` (botones-swatch, no `<input type=color>`),
- por fila, editar (form con `updateConversationTag`) y borrar (`AlertDialog` + `deleteConversationTag`),
- `sonner` toast en `{ ok:false }`.

Estructura mínima (interactividad con `useActionState`/`useFormStatus`, patrón de `configuracion/tags/_components/tags-manager.tsx` como referencia de estilo):
```tsx
'use client'

import { useActionState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createConversationTag,
  deleteConversationTag,
} from '@/lib/conversation-tags/actions'
import { TAG_COLORS } from '@/lib/conversation-tags/schemas'
import type { ConversationTag } from '@/lib/conversation-tags/queries'

export function TagsManager({
  tenantSlug,
  tags,
}: {
  tenantSlug: string
  tags: ConversationTag[]
}) {
  const [, createAction] = useActionState(createConversationTag.bind(null, tenantSlug), {
    ok: true,
  })
  // ... form de alta con selector de TAG_COLORS + lista de tags con editar/borrar
  return (
    <div className="space-y-6">
      <form action={createAction} className="flex flex-wrap items-end gap-3">
        <Input name="name" placeholder="Nombre de la etiqueta" maxLength={40} required />
        {/* radio-swatches de TAG_COLORS, name="color" */}
        <fieldset className="flex gap-1.5">
          {TAG_COLORS.map((c, i) => (
            <label key={c} className="cursor-pointer">
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={i === 0}
                className="peer sr-only"
              />
              <span
                className="block size-6 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-foreground"
                style={{ backgroundColor: c }}
                aria-hidden
              />
            </label>
          ))}
        </fieldset>
        <Button type="submit">Agregar</Button>
      </form>

      <ul className="divide-y">
        {tags.map((tag) => (
          <li key={tag.id} className="flex items-center gap-3 py-2.5">
            <span className="size-4 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
            <span className="flex-1 text-sm">{tag.name}</span>
            <DeleteTagButton tenantSlug={tenantSlug} id={tag.id} />
          </li>
        ))}
        {tags.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">
            No hay etiquetas todavía. Creá la primera arriba.
          </li>
        ) : null}
      </ul>
    </div>
  )
}

function DeleteTagButton({ tenantSlug, id }: { tenantSlug: string; id: string }) {
  const [state, action] = useActionState(deleteConversationTag.bind(null, tenantSlug), { ok: true })
  if (state.ok === false) toast.error(state.message)
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button variant="ghost" size="sm" type="submit">
        Borrar
      </Button>
    </form>
  )
}
```
(La edición inline con `updateConversationTag` se puede sumar como un `Sheet`/inline-form por fila reusando el mismo patrón de swatches; mantenerlo simple y accesible.)

- [ ] **Step 8: Typecheck + lint + tests**

Run: `npm run typecheck && npm run lint && npx vitest run tests/lib/conversation-tags-schemas.test.ts`
Expected: sin errores; test verde.

- [ ] **Step 9: Smoke manual**

`/hub/mensajeria/etiquetas`: crear una etiqueta con color de la paleta, verla en la lista, borrarla. Abrir el inbox y confirmar que la etiqueta nueva aparece como opción al etiquetar una conversación.

- [ ] **Step 10: Commit**

```bash
git add lib/conversation-tags/ "app/(manager)/[tenantSlug]/mensajeria/etiquetas/" tests/lib/conversation-tags-schemas.test.ts
git commit -m "feat(mensajeria): página de etiquetas de conversación (CRUD + paleta curada)"
```

---

### Task 7: Mudar "Tags de carta" a Menú + eliminar el hub muerto /marketing

**Files:**
- Move: `configuracion/tags/` → `menu/tags/`
- Modify: `lib/item-tags/actions.ts` (5× revalidatePath), `components/command-palette/command-config.ts` (entrada `tags`)
- Delete: `app/(manager)/[tenantSlug]/marketing/`
- Modify: `next.config.ts` (2 redirects)

- [ ] **Step 1: Mover "Tags de carta" a Menú**

```bash
git mv "app/(manager)/[tenantSlug]/configuracion/tags" "app/(manager)/[tenantSlug]/menu/tags"
```

- [ ] **Step 2: Actualizar revalidatePath de item-tags**

Reemplazar `` `/${slug}/configuracion/tags` `` → `` `/${slug}/menu/tags` `` en `lib/item-tags/actions.ts:99,146,188,231,342`.

- [ ] **Step 3: Actualizar la entrada `tags` del command palette**

En `command-config.ts`, entrada `id: 'tags'`: `href` `` `/${s}/configuracion/tags` `` → `` `/${s}/menu/tags` ``. (El label "Tags de carta" y el ícono `Tags` quedan.)

- [ ] **Step 4: Eliminar el hub muerto /marketing**

```bash
git rm -r "app/(manager)/[tenantSlug]/marketing"
```

- [ ] **Step 5: Redirects en `next.config.ts`**

```ts
      { source: '/:slug/configuracion/tags', destination: '/:slug/menu/tags', permanent: true },
      { source: '/:slug/marketing', destination: '/:slug/mensajeria', permanent: true },
```

- [ ] **Step 6: Verificar que no quedó nada apuntando a /marketing ni a configuracion/tags**

Run: `grep -rn "/marketing\b\|configuracion/tags" app lib components --include=*.ts --include=*.tsx | grep -v next.config`
Expected: sin resultados.

- [ ] **Step 7: Typecheck + lint + test suite completa**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: todo verde.

- [ ] **Step 8: Smoke manual final**

- `/hub/marketing` → redirige a `/hub/mensajeria`.
- `/hub/configuracion/tags` → redirige a `/hub/menu/tags`; el CRUD de tags del menú funciona.
- El sub-nav de Configuración ya no tiene "Tags de carta" ni el grupo "Mensajería".
- ⌘K → "Tags de carta" lleva a `/hub/menu/tags`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(mensajeria): mover Tags de carta a Menú + eliminar hub /marketing"
```

---

## Self-Review

**Spec coverage** (contra `2026-07-01-mensajeria-rediseno-ia-design.md`):
- §3.1 Shell (sidebar 1 ítem, layout, sub-nav) → Task 1 + Task 5. ✔
- §3.2 Sub-nav + roles → Task 1 (`visibleMessagingNav` + test). ✔
- §3.3 Rutas + redirects (todas) → Tasks 2/3/4/7 (moves + redirects). ✔ (Inbox full-width: diferido explícitamente al spec del Inbox, ver Global Constraints.)
- §3.4 Etiquetas de conversación (CRUD + paleta) → Task 6. ✔
- §4 Taxonomía (eyebrow único, retirar /marketing, Tags de carta → Menú, quitar grupo settings-nav, ⌘K, links internos) → Tasks 2/3/4/5/7. ✔
- §5 Touch-points → cubiertos (nav-config T5, nav-icons T1, settings-nav T4, command-config T5/T7, moves T2/3/4/7, layout T1, etiquetas T6, next.config T2/3/4/7, marketing T7). ✔
- Limpieza opcional del inbox huérfano del salón: **no incluida** (marcada opcional en el spec; se deja para un cleanup aparte para no ampliar el blast radius de esta fase).

**Placeholder scan:** sin TODO/TBD; el único punto "a completar por criterio" es el detalle de la edición inline de etiquetas (Task 6 Step 7), que tiene patrón + código base y es opcional respecto del CRUD mínimo (alta/lista/borrado están completos).

**Type consistency:** `ConversationTagActionState`, `authorizeOwnerCashier`, `nameField`, `createClient`, `logAudit`, `revalidatePath` reusados del módulo existente; `MessagingNavItem/Group` + `visibleMessagingNav` consistentes entre `messaging-nav.ts`, el test y `MensajeriaNav`; `TAG_COLORS`/`updateConversationTagSchema` consistentes entre schema, test, action y UI.

---

## Notas de ejecución
- **Orden:** Task 1 (shell) primero; los ítems del sub-nav entran en línea a medida que 2–4 mueven las páginas. Durante 1–4 el sidebar viejo sigue funcionando vía redirects.
- **Riesgo principal:** una `revalidatePath` o link olvidado. Los greps de verificación de cada task lo atajan; el grep final (T7 Step 6/7) cierra.
- **Difusiones/Flows renderizan dentro de un contenedor `max-w-7xl`** (el del layout de sección). Si alguna página se ve doble-padeada, es un ajuste de esa página en su propia fase, no de esta.
