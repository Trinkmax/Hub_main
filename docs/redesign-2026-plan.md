Confirmed: HUB! is a coffee & bar with a bold serif (Fraunces/Domaine display feel), forest green (#1F4D38-ish) on cream (#F5EDD7-ish). Now I have everything I need. Producing the master plan.

---

# PLAN MAESTRO — Rediseño UI/UX HUB · `redesign-2026`

> Big Bang. Una sola PR. ~3000 LOC. Branch `redesign-2026`. Cream + forest, AUTO theme, dual workspace por rol, PWA en salón. Cada decisión está cerrada.

---

## 0. Resumen ejecutivo (2 minutos)

Vamos a partir HUB en **dos workspaces** que comparten plataforma pero son productos visualmente y ergonómicamente distintos:

```
                     ┌─────────────────────────────────────┐
                     │     LOGIN  ·  cream/forest neutral  │
                     └──────────────┬──────────────────────┘
                                    │
                ┌───────────────────┴────────────────────┐
                ▼                                        ▼
      role = owner                       role ∈ {cashier, waiter, kitchen}
                │                                        │
                ▼                                        ▼
      ┌─────────────────────┐              ┌──────────────────────┐
      │  /[slug]            │              │  /[slug]/salon       │
      │  Manager Dashboard  │              │  POS Mode (PWA)      │
      │  desktop-first      │              │  mobile vertical     │
      │  sidebar 6 dominios │              │  bottom-tab nav (4)  │
      │  ⌘K palette         │              │  swipe + pull-refresh│
      │  analytics-rich     │              │  install prompt      │
      └─────────────────────┘              └──────────────────────┘
```

Ambos comparten un único **design system** (tokens cream+forest, OKLCH light+dark a paridad, Fraunces serif solo en headers, Inter en todo lo demás, motion + view transitions, radius 10px, sombras tintadas cálidas, AUTO theme con toggle).

Reorganizamos **33+ páginas dispersas** en una **IA de 6 dominios** para owner y **4 tabs** para staff. Eliminamos 6 secciones legacy del nav, fusionamos `/visitas` dentro de `/clientes/[id]`, reagrupamos las 9 sub-páginas de `/configuracion` en 4 cards. Login redirige por rol (server-side, en `proxy.ts`).

El big bang corre en **9 commits convencionales** auto-contenidos, lint+typecheck verde en cada uno. DoD agrega Lighthouse 90+, PWA score 100, smoke desktop owner + mobile staff (real device si posible).

---

## 1. Hallazgos colaterales (anotados, NO se resuelven en este rediseño salvo bloqueantes)

Encontré durante el spike. No bloquean el rediseño pero quedan registrados para `BACKLOG.md`:

1. **`SessionsGrid` y `KdsScreen` polletean por fetch en cada cambio realtime** (fetch full GET ante cualquier insert/update). Es un anti-pattern que tira ~10 reqs/min con tickets activos. **No se resuelve acá** — el rediseño solo cambia el visual; el patrón optimista queda para fase post-redesign.
2. **`tenant-switcher.tsx` redirige sin verificar que el slug destino corresponde al `tenantId` que activó.** Toda asume que `tenant.slug` está bien. Es seguro hoy porque viene de membership, pero conviene loguear.
3. **`updatePasswordAction` no chequea si el usuario tiene sesión válida de recovery vs sesión normal** — un usuario logueado podría cambiarse la pass sin reauth. Riesgo bajo, fuera de scope.
4. **`UserMenu` no usa `next-themes`** (no instalado). El toggle Auto/Light/Dark requiere agregar `next-themes` o implementar manual con `localStorage` + cookie. Decidido: implementación manual ligera con cookie httpOnly desde server action (~30 LOC), sin dependencia nueva. Justificación: `next-themes` es overkill y rompe RSC con flash.
5. **`/cocina` y `/sesiones` ya filtran por role en el `page.tsx`**, pero la URL es `/[slug]/cocina` (manager-style). Con la nueva IA, **migran a `/[slug]/salon/cocina`** y `/[slug]/salon/mesas`. Hay que portar la lógica server-side, los componentes _client_ se reusan tal cual.
6. **`nav-config.ts` ya tenía `'kitchen'` como role**, pero el `TenantRole` type lo contempla. La UI nueva los manda al salon también.
7. **`captura legacy`** en `/configuracion/captura` y **`Cerrar mesa (legacy)`** en `/visitas/nueva` son flujos pre-mesas-QR. Quedan accesibles desde `/[slug]/configuracion` pero no en sidebar — solo como "Acciones rápidas" contextuales en el dashboard del owner.
8. **`login` actualmente redirige a `/`**, que después en `app/page.tsx` redirige al `/[slug]`. Doble redirect que se puede colapsar — lo arreglamos al meter el redirect-by-role.
9. **No hay manifest.json ni service worker**. Hoy `viewport.themeColor` está en root layout pero sin PWA real. Con el salón, lo agregamos.
10. **`Toaster` está hardcodeado a `theme="dark"` en `app/layout.tsx`** — hay que pasarlo a `theme="system"` para acompañar AUTO.

---

## 2. Investigación inicial — checklist completado

Páginas leídas: `app/(dashboard)/[tenantSlug]/page.tsx`, `clientes/page.tsx`, `clientes/[id]/page.tsx`, `bandeja/page.tsx`, `eventos/page.tsx`, `eventos/[id]/page.tsx`, `audiencias/page.tsx`, `difusiones/page.tsx`, `flows/page.tsx`, `estadisticas/page.tsx`, `cocina/page.tsx`, `sesiones/page.tsx`, `sesiones/[sessionId]/page.tsx`, `menu/page.tsx`, `visitas/nueva/page.tsx`, las 9 de `/configuracion/*`. Layout `(dashboard)/[tenantSlug]/layout.tsx`. Auth: `app/(auth)/login/page.tsx`, `login-form.tsx`, `lib/auth/actions.ts`, `app/onboarding/page.tsx`. Shell completo (`app-shell.tsx`, `sidebar-nav.tsx`, `sidebar-content.tsx`, `nav-config.ts`, `mobile-shell.tsx`, `tenant-switcher.tsx`, `user-menu.tsx`, `brand-mark.tsx`). Tenant lib (`access.ts`, `current.ts`, `actions.ts`, `errors.ts`, `types.ts`). Supabase clients (`server.ts`, `browser.ts`, `service.ts`, `middleware.ts` que es el proxy real). `proxy.ts`. 3 server-action representativas: `lib/customers/queries.ts`, `lib/sessions-waiter/queries.ts`, `lib/broadcasts/queries.ts`. Realtime helper (`lib/realtime/subscribe.ts`). Todos los primitives shadcn (`button`, `card`, `input`, `form`, `dialog`, `sheet`, `data-table`, `stat-card`, `empty-state`, `page-header`, `sonner`, `badge`, `skeleton`). Layout root (`app/layout.tsx`), config (`components.json`, `next.config.ts`, `postcss.config.mjs`, `tailwindcss + globals.css`). Migraciones SQL listadas (29 archivos). `tenant_role` enum confirmado (`owner|cashier|waiter|kitchen`). JWT con `active_tenant_id` confirmado vía `custom_access_token_hook`.

**Logo HUB!** confirmado visualmente: cream `#F5EDD7-ish`, forest green `#1F4D38-ish`, serif bold con curva tipo Fraunces / Domaine Display, exclamación que es seña de identidad.

**Context7**: marcado para verificar antes de implementar. Versiones objetivo:
- `next` 16.2.4 (ya instalado) — proxy.ts pattern, view-transitions API, cache components
- `react` 19.2.5 (ya instalado) — `useActionState`, `useFormStatus`, `useTransition`
- `tailwindcss` 4.2.4 (ya instalado) — `@theme inline`, `@import "tailwindcss"`, OKLCH
- `tw-animate-css` 1.4.0 (ya instalado)
- `shadcn/ui` new-york — confirmar registry de Command, Tooltip, ScrollArea
- `motion` última (Framer Motion v15+, paquete `motion`) — instalar
- `next-pwa` o solución manual (`@serwist/next` es la ruta moderna en 2026) — confirmar
- `@dnd-kit/*` (ya instalado) — para drag de menú, reordering
- `recharts` 3.8.1 (ya instalado)
- `date-fns` 4.1.0 (ya instalado)
- `react-hook-form` 7.75.0 (ya instalado)
- `sonner` 2.0.7 (ya instalado)

**Si Context7 no responde**, queda anotado en la PR como "verificar antes de implementar" y se valida con un spike de 30min antes del Commit 1.

---

## 3. Sistema de diseño (foundation)

### 3.1 Paleta OKLCH — light + dark a paridad

**Concepto**: `cream` y `forest` son los dos polos de marca. El sistema queda neutro (no tira a colorido), las dos variantes se mueven en eje L (luminosidad) y mantienen H (hue) consistente. Forest green se usa como accent semántico: success-leaning (positivo, calmo, hospitalidad). Destructive es un terracota (no rojo plano) para combinar con cream.

**Tokens base** (en `app/globals.css`, reemplazar bloque actual):

```css
/* Light — derivada del logo HUB!: cream paper + forest ink */
:root {
  --radius: 0.625rem; /* 10px */

  /* Surface ladder: cream-paper → cream-card → cream-popover */
  --background:        oklch(0.965 0.022 88);   /* cream paper #F5EDD7-ish */
  --foreground:        oklch(0.205 0.035 165);  /* forest ink #14332A */

  --surface:           oklch(0.952 0.026 88);   /* cream slightly deeper for sidebar */
  --surface-foreground: oklch(0.205 0.035 165);

  --card:              oklch(0.985 0.014 88);   /* cream card, lifted */
  --card-foreground:   oklch(0.205 0.035 165);

  --popover:           oklch(0.99 0.008 88);    /* cream popover, very light */
  --popover-foreground: oklch(0.205 0.035 165);

  /* Primary = forest green (action color) */
  --primary:           oklch(0.355 0.058 165);  /* HUB! forest #1F4D38-ish */
  --primary-foreground: oklch(0.965 0.022 88);  /* cream */

  /* Secondary = neutral cream tint */
  --secondary:         oklch(0.92 0.022 88);
  --secondary-foreground: oklch(0.245 0.035 165);

  --muted:             oklch(0.92 0.018 88);
  --muted-foreground:  oklch(0.45 0.022 165);

  /* Accent = warm forest tint, used in hover/active states */
  --accent:            oklch(0.91 0.04 165);
  --accent-foreground: oklch(0.245 0.05 165);

  /* Destructive = terracotta (combina con cream, no rojo plano) */
  --destructive:           oklch(0.555 0.155 35);  /* #B85A2A-ish */
  --destructive-foreground: oklch(0.985 0.012 88);

  /* Status colors — desaturados para coherencia con cream */
  --success:           oklch(0.5 0.12 155);     /* deeper forest variant */
  --success-foreground: oklch(0.985 0.012 88);
  --warning:           oklch(0.71 0.135 70);    /* warm amber bistro */
  --warning-foreground: oklch(0.225 0.05 70);
  --info:              oklch(0.55 0.075 215);   /* dusty blue */
  --info-foreground:   oklch(0.985 0.012 88);

  --border:            oklch(0.86 0.018 88);
  --input:             oklch(0.88 0.018 88);
  --ring:              oklch(0.355 0.058 165 / 55%);

  /* Charts — paleta cálida que viva con cream/forest */
  --chart-1:           oklch(0.355 0.058 165);  /* forest (primary) */
  --chart-2:           oklch(0.555 0.155 35);   /* terracotta */
  --chart-3:           oklch(0.71 0.135 70);    /* amber */
  --chart-4:           oklch(0.5 0.075 240);    /* dusty navy */
  --chart-5:           oklch(0.62 0.08 25);     /* salmon */

  /* Marca + theming-ready */
  --tenant-accent:           var(--primary);
  --tenant-accent-foreground: var(--primary-foreground);

  /* Tokens semánticos extra */
  --cream-tint:        oklch(0.965 0.022 88 / 65%); /* glassy cream para hovers */
  --forest-glow:       oklch(0.355 0.058 165 / 18%); /* halo sutil */
}

/* Dark — cream se vuelve "midnight cream", forest sigue siendo accent vivo */
.dark {
  --background:        oklch(0.155 0.022 165);  /* deep forest near-black */
  --foreground:        oklch(0.945 0.015 88);   /* cream ink */

  --surface:           oklch(0.18 0.022 165);
  --surface-foreground: oklch(0.945 0.015 88);

  --card:              oklch(0.215 0.025 165);
  --card-foreground:   oklch(0.945 0.015 88);

  --popover:           oklch(0.225 0.025 165);
  --popover-foreground: oklch(0.945 0.015 88);

  --primary:           oklch(0.78 0.105 88);    /* cream INVERTED becomes the action */
  --primary-foreground: oklch(0.18 0.04 165);

  --secondary:         oklch(0.27 0.025 165);
  --secondary-foreground: oklch(0.945 0.015 88);

  --muted:             oklch(0.255 0.022 165);
  --muted-foreground:  oklch(0.66 0.015 88);

  --accent:            oklch(0.32 0.05 165);
  --accent-foreground: oklch(0.92 0.04 88);

  --destructive:           oklch(0.66 0.165 35);
  --destructive-foreground: oklch(0.155 0.035 35);

  --success:           oklch(0.7 0.135 155);
  --success-foreground: oklch(0.16 0.04 155);
  --warning:           oklch(0.78 0.13 70);
  --warning-foreground: oklch(0.165 0.05 70);
  --info:              oklch(0.7 0.085 215);
  --info-foreground:   oklch(0.16 0.04 215);

  --border:            oklch(1 0 0 / 9%);
  --input:             oklch(1 0 0 / 13%);
  --ring:              oklch(0.78 0.105 88 / 55%);

  --chart-1:           oklch(0.78 0.105 88);
  --chart-2:           oklch(0.66 0.165 35);
  --chart-3:           oklch(0.78 0.13 70);
  --chart-4:           oklch(0.65 0.075 240);
  --chart-5:           oklch(0.72 0.08 25);

  --tenant-accent:           var(--primary);
  --tenant-accent-foreground: var(--primary-foreground);

  --cream-tint:        oklch(0.215 0.025 165 / 65%);
  --forest-glow:       oklch(0.78 0.105 88 / 18%);
}
```

**Justificación por rol**:
- `--primary` light = forest verdadero (acción CTA). Dark = cream invertida (en dark, cream pasa a ser el "ink" brillante).
- `--accent` ≠ `--primary`: accent es estado de hover/selected, primary es CTA. Esa distinción no estaba clara antes.
- `--destructive` terracota en lugar de rojo: rojo plano contra cream se ve estridente; terracota mantiene la calidez bistro.
- `--chart-*` con paleta análoga (warm earth tones), no oposición fría.
- `--tenant-accent` es CSS var inyectable: en `tenants.theme jsonb` un tenant con paleta propia inyecta `--tenant-accent: oklch(...)` desde `<style>` server-rendered en el layout. HUB no usa tenant-accent (queda igual al primary), pero el sistema está listo.

**`@theme inline` en `globals.css`** mapea CSS vars a Tailwind. Hay que agregar `--font-serif` (Fraunces), `--color-success`, `--color-warning`, `--color-info`, `--color-tenant-accent`.

### 3.2 Tipografía

**Fuentes**: dos `next/font/google` con `display: swap` para no inflar bundle.

```ts
// app/layout.tsx
import { Inter, Fraunces } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  axes: ['opsz'],
})
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  axes: ['opsz', 'SOFT', 'WONK'],
  weight: ['400', '500', '600', '700'],
})
```

`@theme inline`:
```css
--font-sans: var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-serif: var(--font-serif), ui-serif, Georgia, "Times New Roman", serif;
--font-display: var(--font-serif), ui-serif, Georgia, serif; /* alias para display */
```

**Cuándo usar serif** (regla simple, no negociable):
- Page hero titles (`h1` con prop `serif`)
- KPI big numbers (números grandes en stat cards) — opt-in por prop
- Marquee headlines del tipo "Hoy, 12 mesas activas"
- Logo wordmark "HUB!"
- TODO LO DEMÁS: Inter

**Escala tipográfica** (definida en una clase `prose-hub` y/o tailwind utilities):

| Token | Tamaño | Peso | Leading | Tracking | Familia | Uso |
|---|---|---|---|---|---|---|
| `display` | `clamp(2rem, 4vw, 3.25rem)` | 600 | 1.05 | -0.02em | serif | Hero h1 (Manager dashboard, login) |
| `h1` | `1.875rem` (30px) | 600 | 1.15 | -0.015em | serif | Page titles |
| `h2` | `1.25rem` (20px) | 600 | 1.25 | -0.01em | serif | Section titles |
| `h3` | `1rem` (16px) | 600 | 1.4 | -0.005em | sans | Card titles |
| `body` | `0.875rem` (14px) | 400 | 1.6 | 0 | sans | Default body |
| `small` | `0.75rem` (12px) | 500 | 1.5 | 0 | sans | Helpers, eyebrow |
| `tabular` | inherit | inherit | inherit | 0 | sans + `tabular-nums` | Money/counts |

Aplicación: `font-serif` se usa en `h1`/`h2` que renderizan headers de página y card titles "decorativos". `font-sans` en todo lo restante. La clase `font-display` se mantiene para retrocompatibilidad pero apunta a serif ahora.

### 3.3 Espaciado, radius, sombras

**Radius**:
```css
--radius: 0.625rem; /* 10px base */
--radius-sm: calc(var(--radius) - 4px);   /*  6px */
--radius-md: calc(var(--radius) - 2px);   /*  8px */
--radius-lg: var(--radius);               /* 10px */
--radius-xl: calc(var(--radius) + 4px);   /* 14px */
--radius-2xl: calc(var(--radius) + 8px);  /* 18px */
```

**Sombras tintadas cálidas**: usamos `color-mix(in oklch, ...)` para que la sombra herede el color del foreground. Resultado: sombra warm-brown en light, sombra forest-deep en dark. Ya no son `rgba(0,0,0,0.x)` planos.

```css
--shadow-2xs: 0 1px 0 0 color-mix(in oklch, var(--foreground) 6%, transparent);
--shadow-xs:  0 1px 2px 0 color-mix(in oklch, var(--foreground) 8%, transparent);
--shadow-sm:  0 2px 4px -1px color-mix(in oklch, var(--foreground) 8%, transparent),
              0 1px 2px 0 color-mix(in oklch, var(--foreground) 6%, transparent);
--shadow-md:  0 6px 14px -4px color-mix(in oklch, var(--foreground) 12%, transparent),
              0 2px 4px -2px color-mix(in oklch, var(--foreground) 8%, transparent);
--shadow-lg:  0 18px 32px -10px color-mix(in oklch, var(--foreground) 18%, transparent),
              0 8px 12px -6px color-mix(in oklch, var(--foreground) 10%, transparent);
--shadow-glow: 0 0 0 1px color-mix(in oklch, var(--ring) 25%, transparent),
               0 8px 32px -8px color-mix(in oklch, var(--primary) 35%, transparent);
```

**Espaciado**: Tailwind default 4px scale (no se modifica). Convención: page padding `px-4 sm:px-6 lg:px-8`, sections `space-y-6`, cards `p-5 sm:p-6`, list-items `py-3 px-4`. Manager max-width `max-w-7xl`. Salón es full-width siempre.

### 3.4 Animaciones

**Librería**: `motion` v15+ (paquete `motion`, sucesor de `framer-motion`). Tree-shakeable, ~12kb gzip si se usa solo `motion/react`. **Confirmar versión con Context7 antes de instalar**.

**Tokens timing** (en `@theme inline`):
```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);   /* iOS-y, suave al final */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.5, 1.4, 0.5, 1);   /* sutil overshoot */
--duration-fast:   120ms;
--duration-base:   200ms;
--duration-slow:   320ms;
--duration-slower: 500ms;
```

**Patrones**:

1. **View Transitions API entre rutas** (Next 16 lo soporta nativo). En `app/layout.tsx` envolver `<body>` con `<ViewTransitions>` (de `next-view-transitions` package o nativo según Context7). Fallback automático a fade en navegadores que no soportan.
2. **Number tickers en KPIs** — componente `<NumberTicker value={kpi.visits_30d} />` que anima de 0 al valor con `useMotionValue` + `useTransform`, easing `ease-out`, duración 800ms. **Hidratación-safe**: SSR renderiza el valor final, animación arranca en `useEffect`.
3. **Skeletons** — `Skeleton` ya existe; agregamos `animate-pulse` con OKLCH base + `motion.div` con shimmer opcional para hero skeletons.
4. **Card hover** — `transition-all duration-base ease-out`, `translateY(-1px)` + `shadow-md`. Cream tint en `--accent` light overlay con 40% alpha en hover, sutil glow en dark.
5. **Press button** — `active:scale-[0.985]` + `transition-transform duration-fast`. Sutil, no rebote.
6. **Sidebar entry** (mobile) — slide-in con `motion` + spring, ya viene de Radix Dialog.
7. **Toast** — sonner ya tiene su propio sistema, lo dejamos.
8. **Bottom-tab transition** (salón) — al cambiar de tab, fade + slide horizontal sutil, `duration-base`.
9. **Realtime ticket cards (cocina)** — al cambiar status, `motion.div` con `layout` prop hace que el card se reordene con spring. Esto sí mejora UX por encima de lo actual (que es brusco).

### 3.5 Iconografía

`lucide-react` ya está. **NO** reemplazamos por íconos custom — la marca está en el wordmark y en el logo "HUB!" (que sí redibujamos como SVG, ver 3.7). Excepción: los **bottom-tab icons del salón** son iconos lucide pero con tratamiento "filled" custom cuando el tab está activo (versión `*-fill` o trazo más grueso).

### 3.6 Componentes shadcn — inventario y plan

**Ya instalados** (revisados): `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`, `data-table` (custom), `dialog`, `dropdown-menu`, `empty-state` (custom), `filter-bar` (custom), `form`, `input`, `label`, `page-header` (custom), `section` (custom), `select`, `separator`, `sheet`, `skeleton`, `skeleton-list` (custom), `sonner`, `stat-card` (custom), `stepper` (custom), `table`, `tabs`, `textarea`.

**A agregar (shadcn add)**:
- `command` — palette ⌘K
- `tooltip` — hovers contextuales (importante en Manager)
- `scroll-area` — sidebars y popovers densos con scroll suave
- `popover` — inline editors, filtros chip
- `progress` — barra para broadcasts
- `switch` — toggles de settings
- `breadcrumb` — Manager nested pages

**Custom nuevos (no shadcn, propios)**:
- `theme-toggle.tsx` — dropdown Auto/Light/Dark, persiste en cookie
- `tenant-accent-style.tsx` — Server Component que lee `tenants.theme` y emite `<style>` con `--tenant-accent`
- `number-ticker.tsx` — tipo motion-primitives
- `kbd.tsx` — `<kbd>` styled
- `bottom-tab-bar.tsx` — salón
- `pwa-install-prompt.tsx`
- `command-palette.tsx` — wrapper sobre shadcn `Command`
- `view-transition-link.tsx` — wraps `next/link` con view-transition-name

**A reestilar** (mismo API, nueva piel):
- `button.tsx` — recibe nuevo `--shadow-xs`, hover bg-cream-tint en variant `outline`/`ghost`, active scale
- `card.tsx` — gap reducido, border opacity 60%, shadow tintada
- `input.tsx` — height 40px (en salon, escala a 44px touch target), padding y bg cream
- `data-table.tsx` — sticky header opcional, row hover cream tint
- `dialog.tsx`, `sheet.tsx` — overlay color y radius
- `stat-card.tsx` — value en serif, sparkline ya existe
- `empty-state.tsx` — ícono dentro de un círculo cream con border

### 3.7 Brandmark redesign

Hoy `BrandMark` dibuja una H minimal con líneas. Lo reemplazamos por un SVG fiel al logo HUB! (forest sobre cream círculo): glifo "H!" con serif heavy weight + el `!`, en `currentColor`. Tamaño 32px / 40px / 48px. Wordmark `HUB!` en `font-serif` 600 con tracking `-0.04em`.

```
BrandMark size=32   ┌─────┐
                    │ H!  │  ← redondeado, cream bg + forest stroke
                    └─────┘
BrandWordmark        H U B !  ← Fraunces serif 600
```

**Nuevo `brand-mark.tsx`** mantiene exports `BrandMark` y `BrandWordmark` para que el resto del código no se rompa.

---

## 4. Arquitectura de información (IA)

### 4.1 Manager Workspace `/[tenantSlug]/...`

Layout: sidebar 280px persistente desktop (≥1024), drawer + topbar tablet/mobile. Sidebar agrupada en **6 dominios** (no 5: separamos Catálogo de Configuración). Justificación: el owner alterna entre "operar hoy" / "entender clientes" / "marketing" / "preparar el lugar"; agrupar todo en un balde de "configuración" mata findability.

```
┌─ HUB! [logo] ─ HUB! Coffee&Bar ▼ ─ owner ┐
├─ Tenant switcher                         ┤
│                                          │
│ HOY                                      │
│  ◯ Resumen                               │
│  ◯ Salón en vivo  ← shortcut a /salon    │
│  ◯ Bandeja                               │
│                                          │
│ CLIENTES                                 │
│  ◯ Personas                              │
│  ◯ Audiencias                            │
│                                          │
│ MARKETING                                │
│  ◯ Difusiones                            │
│  ◯ Flows                                 │
│  ◯ Eventos                               │
│                                          │
│ CATÁLOGO                                 │
│  ◯ Menú                                  │
│  ◯ Puntos                                │
│  ◯ Punch cards                           │
│                                          │
│ INSIGHTS                                 │
│  ◯ Estadísticas                          │
│                                          │
│ AJUSTES                                  │
│  ◯ Configuración                         │
│                                          │
│ HUB! Coffee & Bar      /hub               │
└──────────────────────────────────────────┘
```

**Justificación de cada agrupación** (job-to-be-done):

- **HOY** = "qué está pasando ahora". `Resumen` (KPIs y onboarding), `Salón en vivo` (link a `/[slug]/salon` en una nueva pestaña — para owner que quiere ver el POS sin perder su cabina), `Bandeja` (mensajes activos).
- **CLIENTES** = "quién viene". `Personas` (es `/clientes`, renombrado para diferenciarlo del cliente final del SaaS), `Audiencias` (segmentos derivados).
- **MARKETING** = "cómo los traigo de vuelta". `Difusiones` (one-shot), `Flows` (recurrentes), `Eventos` (driver de tráfico programado).
- **CATÁLOGO** = "qué vendo y cómo se premia". `Menú`, `Puntos`, `Punch cards`. Nota: Puntos y Punch cards están hoy en `/configuracion`. Los movemos a primer nivel porque son productos del bar, no settings.
- **INSIGHTS** = "qué entiendo". `Estadísticas` solo. Si más adelante hay reportes específicos, viven acá.
- **AJUSTES** = "cómo lo configuro". Solo `Configuración`, que adentro tiene 4 cards (ver 4.3).

**Renombres / fusiones / movimientos**:

| Antes | Después | Motivo |
|---|---|---|
| `/visitas` (registro de visitas pasadas) | **eliminada del nav**. Visitas pasadas viven dentro de `/clientes/[id]` tab "Visitas" (ya existe). | El listado global no tiene job-to-be-done claro; siempre se llega vía cliente. |
| `/visitas/nueva` (legacy cerrar mesa) | accesible solo desde "Acciones rápidas" del Resumen. NO en sidebar. | Es flujo legacy (pre-QR-mesas). No queremos confundir. |
| `/clientes` | renombre visible: **"Personas"**. URL queda `/clientes` por compatibilidad. | "Clientes" en CRM B2B confunde porque "cliente" es ambiguo (el bar es el cliente del SaaS, los comensales son los clientes del bar). "Personas" es más neutral. |
| `/configuracion/puntos` | **`/puntos`** (top-level) | Es producto del bar. |
| `/configuracion/punch-cards` | **`/punch-cards`** (top-level) | Idem. |
| `/configuracion/equipo`, `/canales`, `/templates`, `/tags`, `/mesas`, `/captura`, `/auto-aceptacion` | reagrupados en `/configuracion` (4 cards, ver 4.3) | Reduce cognitive load. |
| `/cocina` | mueve a **`/[slug]/salon/cocina`** (workspace salón) | Es uso de staff, no de owner. |
| `/sesiones` | mueve a **`/[slug]/salon/mesas`** (workspace salón) | Idem. |
| `/bandeja` | **se mantiene en Manager** Y aparece como tab en Salón. Es ambidiestra: owner ve y staff responde. | Justificación: si el staff respondió en mostrador, el owner quiere ver el hilo. |

### 4.2 Manager top-bar

```
[ menu(mobile) | search ⌘K (md+) | tenant-switcher | theme | user-menu ]
```

- Búsqueda ⌘K reemplaza el botón disabled actual. Abre `command-palette.tsx`.
- Tenant switcher se mueve del sidebar al top-bar (para liberar espacio en sidebar y porque es acción global, no de nav).
- Theme toggle: dropdown con `Sun / Moon / Monitor` icons, tres opciones (Light / Dark / Auto). Default Auto.
- User menu: igual que hoy + entry "Cambiar tema" (mismo dropdown).

### 4.3 `/configuracion` reagrupado (4 cards con sub-tabs)

```
┌─ Configuración ─────────────────────────────────────────────┐
│                                                             │
│ ┌─ Equipo ───────┐  ┌─ Local ──────────┐  ┌─ Mensajería ──┐│
│ │ • Miembros     │  │ • Mesas físicas  │  │ • Canales (WA│IG)│
│ │ • Roles        │  │ • Captura QRs    │  │ • Plantillas  ││
│ │                │  │ • Auto-aceptación│  │ • Tags carta  ││
│ └────────────────┘  └──────────────────┘  └───────────────┘│
│                                                             │
│ ┌─ Apariencia ───────────────────────────────────────────┐ │
│ │ • Logo del bar   • Acento (futuro)   • Idioma  • TZ    │ │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Routing** (preservando paths actuales para SEO interno y muscle memory):

- `/[slug]/configuracion` → renderiza index con las 4 cards link a su detalle
- Las sub-pages siguen vivas (`/configuracion/equipo`, `/configuracion/canales`, etc.) — no rompemos. Solo cambia el index.
- Card `Equipo` → link a `/configuracion/equipo`
- Card `Local` → tabs internos en una nueva página `/configuracion/local` que tabula entre `mesas`, `captura`, `auto-aceptacion` (server component leyendo `?tab=`). Los paths viejos siguen funcionando, redirigen a `local?tab=X`.
- Card `Mensajería` → tabs internos en nueva `/configuracion/mensajeria` con `canales`, `plantillas`, `tags-carta` (mover `tags` desde `/configuracion/tags`).
- Card `Apariencia` → nueva `/configuracion/apariencia` (logo upload + zona horaria readonly + futuro tenant-accent picker).

**Tags-carta** (que hoy es `/configuracion/tags`) lo movemos a `Mensajería` porque sirve para audiencias por consumo, no para apariencia. Justificación de UX: la persona que define tags es la persona que arma broadcasts/audiences, no quien configura mesas físicas.

### 4.4 Command Palette ⌘K

**Tecnología**: shadcn `Command` (cmdk) con groups.

**Entries pre-cargados**:

```
> Buscar…

[Acciones rápidas]
  ⌘ Cerrar mesa
  ⌘ Nueva difusión
  ⌘ Nuevo cliente
  ⌘ Nuevo evento
  ⌘ Sincronizar plantillas

[Ir a]
  → Resumen
  → Personas
  → Salón en vivo
  → Bandeja
  → Difusiones · Flows · Eventos · Audiencias
  → Estadísticas
  → Menú · Puntos · Punch cards
  → Configuración · Equipo · Canales · Plantillas · Mesas · Captura · Auto-aceptación · Apariencia

[Buscar clientes "<query>"]
  Maru López — +5491133...
  Pancho Ríos — +5493515...
  → Ver todos los resultados

[Tema]
  ☀ Light · 🌙 Dark · 🖥 Auto
```

**Implementación**:
- Componente `command-palette.tsx` (client). Trigger por `⌘K`/`Ctrl+K` con `useEffect` global.
- "Acciones rápidas" e "Ir a" son estáticas (config en archivo `command-config.ts`).
- "Buscar clientes" hace fetch debounced (250ms) a un endpoint `GET /api/customers/search?q=&tenant_id=` que ya existe (`lib/customers/search.ts`). Resultados cacheados en memoria por sesión.

### 4.5 Salón Workspace `/[tenantSlug]/salon/...`

**Layout**: stack vertical full-screen, **bottom-tab nav 4 pestañas** (estándar iOS/Android).

```
┌────────── 390 × 844 (iPhone 12) ──────────┐
│ Mesa 4 · 18:42 · $12.300                  │ ← top-bar contextual
├───────────────────────────────────────────┤
│                                           │
│              [contenido tab]              │
│                                           │
│                                           │
│                                           │
│                                           │
├───────────────────────────────────────────┤
│   [⊞ Mesas]  [🍳 Cocina]  [💬]  [👤]      │ ← bottom-tab
└───────────────────────────────────────────┘
```

**4 tabs**:

1. **Mesas** (`/salon/mesas`) — grid live de sesiones abiertas. Card por mesa: número, hora, total, badges (guests, pending, bill_requested). Tap → `/salon/mesas/[id]`. Pull-to-refresh. Swipe-left en card → "Marcar pagada". CTA flotante (FAB) bottom-right "Abrir mesa manual" (raro pero existe).
2. **Cocina** (`/salon/cocina`) — solo para roles `kitchen`, `owner`, `cashier`. Si role es `waiter`, este tab se reemplaza por **"Bandeja"**. Cards de tickets activos en orden de antigüedad. Tap card para expandir items. Botones primarios: "Empezar", "Listo", "Sin stock".
3. **Bandeja** (`/salon/bandeja`) — visible siempre. Lista de conversaciones, tap para abrir hilo. Mobile-first redesign del actual `/bandeja` (hoy es desktop-split-pane).
4. **Mi turno** (`/salon/mi-turno`) — perfil con email, role, theme toggle, "Cerrar sesión", "Ir al modo manager" (solo si role=owner, para "salir" del salón).

**Quick add cliente desde mesa**: en `/salon/mesas/[id]`, botón "+ Cliente" abre un modal full-screen (no dialog chico) con:
- Tab `Existente` con buscador (autocomplete sobre `customer_search`).
- Tab `Nuevo` con teclado numérico nativo (`inputMode="tel"`) para teléfono y dos campos texto. Confirma con Server Action.

**Sin command palette** — gestos primarios solamente.

**Gestos**:
- **Swipe-left** en card de mesa → "Marcar pagada" (confirma con AlertDialog full-screen).
- **Pull-to-refresh** en `/salon/mesas` y `/salon/cocina` y `/salon/bandeja` — usa `<RefreshableList />` custom con touch handlers (≤ 80 LOC).
- **Tap-and-hold** en ticket cocina → abre menú "Cancelar ticket / Ver guest".

**PWA**: instalable obligatoria.

`public/manifest.json`:
```json
{
  "name": "HUB! · Salón",
  "short_name": "HUB!",
  "description": "Modo salón para staff de HUB!",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F5EDD7",
  "theme_color": "#1F4D38",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["business", "productivity"]
}
```

`<link rel="manifest" href="/manifest.json" />` y `<meta name="apple-mobile-web-app-capable" content="yes" />` en `app/(salon)/layout.tsx` (no en root, no queremos PWA en manager).

**Service worker**: usamos **`@serwist/next`** (sucesor moderno de `next-pwa` para Next 16). **Confirmar versión exacta con Context7 antes de instalar.** Plan:
- Cache `app shell` (HTML + critical CSS + fonts).
- Cache assets `/_next/static/*` con `CacheFirst`.
- Cache logo + icons con `CacheFirst`.
- **Read-only offline**: `/api/sessions/list`, `/api/kitchen/queue`, `/api/customers/search` con `NetworkFirst` + fallback a cache (TTL 5 min).
- **Mutations require online**: en cualquier `POST` (Server Actions y Route Handlers) detectamos offline en cliente con `navigator.onLine` y mostramos toast "Necesitás conexión para esta acción". El SW NO encola mutations (queremos avoid stale state).
- **Install prompt**: capturamos `beforeinstallprompt`, lo guardamos, y lo disparamos con un toast "Instalá HUB en tu teléfono" después de 2 minutos de uso del salón si NO está instalada (`window.matchMedia('(display-mode: standalone)')`).

### 4.6 Routing — estructura final

```
app/
├── layout.tsx                       ← root: fonts + manifest + viewport + theme provider
├── page.tsx                         ← server redirect a /[slug] o /[slug]/salon según rol
├── globals.css                      ← tokens cream+forest light/dark
├── not-found.tsx
├── loading.tsx
│
├── (auth)/
│   ├── layout.tsx                   ← cream gradient bg, neutral (sin tenant-accent)
│   ├── login/
│   │   ├── page.tsx
│   │   └── login-form.tsx
│   ├── forgot-password/
│   └── (no se cambia auth/callback ni accept-invite ni onboarding)
│
├── (manager)/                       ← NEW: separación explícita por workspace
│   └── [tenantSlug]/
│       ├── layout.tsx               ← AppShellManager (sidebar + topbar + ⌘K)
│       ├── page.tsx                 ← Resumen
│       ├── clientes/
│       ├── audiencias/
│       ├── difusiones/
│       ├── flows/
│       ├── eventos/
│       ├── menu/
│       ├── puntos/                  ← NEW (movido)
│       ├── punch-cards/             ← NEW (movido)
│       ├── bandeja/
│       ├── estadisticas/
│       ├── configuracion/           ← reagrupado
│       │   ├── page.tsx             ← index 4 cards
│       │   ├── equipo/
│       │   ├── local/               ← NEW (tabbed)
│       │   ├── mensajeria/         ← NEW (tabbed)
│       │   └── apariencia/         ← NEW
│       └── visitas/nueva/           ← legacy, accesible solo por link directo
│
├── (salon)/                         ← NEW
│   ├── layout.tsx                   ← AppShellSalon (bottom-tab + manifest + sw)
│   └── [tenantSlug]/
│       └── salon/
│           ├── page.tsx             ← redirect a /salon/mesas
│           ├── mesas/
│           │   ├── page.tsx
│           │   └── [sessionId]/page.tsx
│           ├── cocina/
│           ├── bandeja/
│           └── mi-turno/
│
├── m/[qrToken]/                     ← cliente final (no se toca, el rediseño no lo cubre)
├── capture/[linkSlug]/              ← idem
├── api/                             ← idem
├── auth/...
├── accept-invite/...
└── onboarding/                      ← se rediseña visual, mantiene flujo
```

> **Aclaración**: hoy el grupo es `(dashboard)`. Lo renombramos a `(manager)` para hacer explícito el split. Esto implica mover physical files (un `git mv`), no afecta URLs.

### 4.7 Redirect post-login por rol

**Estrategia**: en `proxy.ts` (que es el routing-middleware de Next 16). No en server action de login (porque queremos atajar también navegación libre del usuario manualmente entrando a `/`), no en `page.tsx` de `/` (porque ya está ahí pero no chequea rol).

Lógica nueva en `lib/supabase/middleware.ts → updateSession`:

```ts
// Pseudocódigo
const user = await supabase.auth.getUser()
if (!user && !isPublicPath(pathname)) → redirect /login
if (user && pathname === '/login') → redirect calculado por rol

// NUEVO: si user está logueado y entra a /[slug] (manager) y su rol es staff,
// lo mandamos a /[slug]/salon. Recíprocamente, si role=owner entra a /[slug]/salon
// directamente (sin haber ido por sidebar), lo permitimos (puede querer probar
// el salón). NO lo redirigimos.

if (user) {
  const claim = (user.app_metadata?.active_tenant_id as string | undefined)
  if (!claim) return next() // se resuelve abajo en page.tsx

  // Detectamos si la URL apunta al manager root del tenant
  const m = pathname.match(/^\/([^/]+)(\/.*)?$/)
  if (m) {
    const slug = m[1]
    const rest = m[2] ?? ''
    const isReservedSlug = RESERVED_SLUGS.has(slug)
    if (!isReservedSlug && rest === '' /* o rest matchea manager-only paths */) {
      const role = await fetchRoleForSlug(slug, user.id) // 1 query, cached por sesión
      if (role && ['cashier','waiter','kitchen'].includes(role)) {
        return NextResponse.redirect(new URL(`/${slug}/salon`, request.url))
      }
    }
  }
}
```

**Optimización**: cachear el `(user.id, slug) → role` lookup en una cookie de sesión `hub_role_<slug>` (httpOnly, sameSite=lax, 1h TTL) seteada por la action de login. Si la cookie está, evitamos la query. Si el role cambia (ej: el owner le cambia el role al staff), la cookie expira en 1h y se re-resuelve.

**Edge case**: owner que entra manualmente a `/[slug]/salon`. No lo bloqueamos. Útil para "probar la UX". Su sidebar ya tiene un link "Salón en vivo" que abre `/salon` en `target="_blank"`.

**Page `app/page.tsx`** (root) sigue redirigiendo a `/[slug]`, pero ahora ese redirect lo intercepta el proxy y manda a `/salon` si role staff.

---

## 5. Patrones por dominio (cómo se va a ver cada tipo)

### 5.1 Listings con tabla (clientes, audiencias, difusiones, eventos, flows, sesiones, visitas, equipo, templates, mesas, punch-cards, tags)

**Decisión**: NO TanStack Table (overkill, +12kb). Usamos el `data-table.tsx` actual (server-rendered HTML table) potenciado con:

- **Sticky header** (`sticky top-0 bg-secondary/40 backdrop-blur`).
- **Búsqueda inline** en el `PageHeader` actions slot (input compacto). Server-driven via `searchParams.q`.
- **Filtros** en chips horizontales arriba de la tabla (no sidebar — sidebar la usamos para nav). Componente `FilterBar` ya existe; lo reestilizamos.
- **Paginación** server-driven (URL searchParams `?page=`).
- **Empty state** ya existe — pulir copy y forest-green CTA.
- **Row hover** → cream tint suave (`bg-[--cream-tint]` light, `bg-[--accent]/40` dark).

**Patrón de columna**: primera columna es **identificadora con avatar/initial** + nombre, ahí está el link. Última columna es chevron. Cellas numéricas siempre `tabular-nums`.

### 5.2 Detail pages (`/clientes/[id]`, `/eventos/[id]`, `/difusiones/[id]`, `/flows/[id]`, `/audiencias/[id]`)

**Patrón**: hero card + tabs + sidebar metadata.

```
┌── Volver a personas ─────────────────────────────────────┐
│                                                          │
│ ┌─ HERO ──────────────────────────────────────────────┐ │
│ │ [avatar 56] Maru López   Cliente desde 12 mar 2025  │ │
│ │             📞 +54 9 351...    [Tags] [+]            │ │
│ │                                                       │ │
│ │                              [⭐ Canjear puntos]      │ │
│ │                              [🗑 Eliminar (owner)]    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ KPIs (3 stat cards) ───────────────────────────────┐ │
│ │ 12 visitas | $48.300 gastado | 240 pts disponibles │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ Insights (cream highlight, sparkles serif h2) ─────┐ │
│ │ ...                                                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ [Visitas | Puntos | Datos | Mensajes | Notas]            │
│ ──────────                                               │
│  [contenido tab]                                         │
└──────────────────────────────────────────────────────────┘
```

Hero card con `card-hairline` + glow forest blur sutil top-right. h1 en serif. Eventos y Difusiones tienen layout 340px sidebar + main (ya existe en `eventos/[id]`).

### 5.3 Forms (`/clientes/nuevo`, `/audiencias/nueva`, `/difusiones/nueva`, `/eventos/nuevo`, `/flows/nuevo`, `/captura/nuevo-link`)

**Patrón**:

- React Hook Form + Zod resolver (ya está).
- Server Action submit con `useActionState` (ya está).
- Inline errors con `FormMessage` (ya está).
- Loading: `useFormStatus().pending` → botón submit con spinner.
- Optimistic toast con sonner: éxito "Cliente creado" / error con `toast.error`.
- **Layout**: card single-column max-w-2xl. Stepper (`stepper.tsx`) solo si tiene >3 secciones lógicas (ej. crear difusión: audiencia → template → schedule).
- **Navigation**: botón "Cancelar" con `router.back()` Y, si hay dirty state, AlertDialog "¿Descartar cambios?". Botón submit primary con texto verbo-acción ("Crear cliente", "Programar difusión", "Publicar evento").

### 5.4 Live realtime views (sesiones/mesas, cocina, bandeja)

**Patrón**:

- Inicial server-rendered con datos frescos (`force-dynamic`).
- Client component `useEffect(() => subscribeChanges(...), [])` con cleanup.
- En lugar de re-fetch full GET en cada cambio (pattern actual), **migrar a optimistic local merge** del payload Realtime → state. Pero como dije en hallazgos colaterales, **NO en este redesign** — solo el visual cambia.
- Cards con `motion.div` `layout` prop para que el reorder/move sea suave.
- Skeleton inicial: 6 placeholders en grid mientras carga.
- Cambio de estado de ticket → `motion`-fade del badge.
- Empty state acogedor: "Por ahora no hay nada. ¡Buena suerte con el turno!"

### 5.5 Settings cards (`/configuracion/*`)

**Patrón**:

- Index `/configuracion` = grid 2-col de Cards grandes con título serif, descripción, ícono lucide en círculo cream/forest.
- Detail = page con 1+ cards "Sumar X" arriba + lista debajo (ya está así en `/equipo`, `/captura`).
- **Save inline**: edit-in-place con debounce → server action. Mostrar `<Badge variant="secondary">Sin guardar</Badge>` si dirty, `<Badge variant="success">Guardado</Badge>` con fade-out 1500ms post-save.
- Tabs internas (en `/configuracion/local`, `/configuracion/mensajeria`) con `Tabs` shadcn ya existente, `?tab=` searchparam para deep-linkear.
- Switches con `switch` shadcn, no checkboxes.

### 5.6 Charts (estadísticas, dashboard)

**Patrón**:

- Recharts ya está, no migramos.
- Paleta forzada a `--chart-1..5` (las nuevas, warm earth tones).
- Ejes: tick custom con `text-xs text-muted-foreground tabular-nums`, axis line invisible (`stroke="transparent"`), grid line con `--border` y `strokeDasharray="3 3"`.
- **Tooltip glassy custom**: `bg-popover/85 backdrop-blur border border-border rounded-md shadow-lg p-2.5`. Custom `<Tooltip content={<HubTooltip />} />` componente.
- Sparklines (ya hay) — sin tooltip, sin axis. Pequeño "halo" linear-gradient bottom (ya existe).
- Heatmap: usa una matriz HTML (no recharts) con clases de tono cream→forest según valor.

---

## 6. Migration & Refactoring plan (Big Bang)

### 6.1 Archivos a CREAR (exhaustivo)

**Foundation / system**:
- `app/globals.css` (rewrite, no nuevo archivo) — tokens cream+forest, fonts vars, motion tokens, sombras tintadas
- `lib/theme/cookie.ts` — server-side helpers para leer/escribir `theme` cookie (Auto/Light/Dark), zod-validated
- `lib/theme/actions.ts` — Server Action `setThemePreference`
- `components/theme/theme-provider.tsx` — Client RSC-friendly provider que aplica `dark` class según cookie SSR + `prefers-color-scheme` change listener si pref="auto"
- `components/theme/theme-toggle.tsx` — Dropdown Sun/Moon/Monitor → action setThemePreference
- `components/theme/tenant-accent-style.tsx` — Server Component que lee `tenants.theme.accent` y emite `<style>` inline con CSS var `--tenant-accent`

**Brand**:
- `components/shell/brand-mark.tsx` (rewrite) — SVG fiel al logo HUB!
- `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` — generados desde el logo
- `public/manifest.json`
- `public/apple-touch-icon.png`

**Manager workspace**:
- `app/(manager)/[tenantSlug]/layout.tsx` — wrapper con `AppShellManager`
- `components/shell/manager/app-shell-manager.tsx` — equivalente al actual `app-shell.tsx` con sidebar + topbar
- `components/shell/manager/sidebar-content.tsx` — refactor con grupos nuevos
- `components/shell/manager/sidebar-nav.tsx` — refactor (mismo API, distinto styling)
- `components/shell/manager/nav-config-manager.ts` — config de los 6 dominios
- `components/shell/manager/topbar.tsx` — search-trigger + tenant-switcher + theme + user-menu
- `components/shell/manager/mobile-shell.tsx` — drawer manager
- `components/shell/manager/breadcrumbs.tsx` — para nested pages
- `components/command-palette/command-palette.tsx` — ⌘K palette
- `components/command-palette/command-config.ts` — entries estáticas
- `components/command-palette/use-command-shortcuts.ts` — hook global keyboard
- `app/(manager)/[tenantSlug]/configuracion/page.tsx` (rewrite) — index 4 cards
- `app/(manager)/[tenantSlug]/configuracion/local/page.tsx` — tabbed
- `app/(manager)/[tenantSlug]/configuracion/local/_components/local-tabs.tsx`
- `app/(manager)/[tenantSlug]/configuracion/mensajeria/page.tsx` — tabbed
- `app/(manager)/[tenantSlug]/configuracion/mensajeria/_components/mensajeria-tabs.tsx`
- `app/(manager)/[tenantSlug]/configuracion/apariencia/page.tsx`
- `app/(manager)/[tenantSlug]/puntos/page.tsx` (movido desde `/configuracion/puntos`, mismo content)
- `app/(manager)/[tenantSlug]/punch-cards/page.tsx` (movido)

**Salón workspace**:
- `app/(salon)/layout.tsx` — manifest link, viewport mobile, sw register, AppShellSalon
- `app/(salon)/[tenantSlug]/salon/layout.tsx` — bottom-tab nav + access guard staff
- `components/shell/salon/app-shell-salon.tsx`
- `components/shell/salon/bottom-tab-bar.tsx` — 4 tabs con role-aware (waiter no ve "Cocina")
- `components/shell/salon/salon-topbar.tsx` — context-aware (mesa actual, hora, total)
- `components/shell/salon/pull-to-refresh.tsx` — touch handlers nativos, no librería
- `components/shell/salon/swipe-action.tsx` — wrapper con `motion`/touch para swipe-left
- `components/shell/salon/install-prompt.tsx` — toast con beforeinstallprompt
- `app/(salon)/[tenantSlug]/salon/page.tsx` — redirect a `/salon/mesas`
- `app/(salon)/[tenantSlug]/salon/mesas/page.tsx`
- `app/(salon)/[tenantSlug]/salon/mesas/_components/mesas-list-mobile.tsx`
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/page.tsx` — adaptado del actual `sesiones/[sessionId]`
- `app/(salon)/[tenantSlug]/salon/cocina/page.tsx` — adaptado del actual
- `app/(salon)/[tenantSlug]/salon/bandeja/page.tsx` — mobile redesign del actual `/bandeja`
- `app/(salon)/[tenantSlug]/salon/bandeja/_components/conversation-list-mobile.tsx`
- `app/(salon)/[tenantSlug]/salon/bandeja/_components/conversation-view-mobile.tsx`
- `app/(salon)/[tenantSlug]/salon/mi-turno/page.tsx`
- `app/(salon)/[tenantSlug]/salon/_components/quick-add-customer-modal.tsx` — full-screen modal
- `next.config.ts` (modify, ver abajo) — registro Serwist
- `serwist.config.ts` (or equivalent) — config service worker

**Theme infra**:
- `lib/theme/types.ts` — `type ThemePreference = 'auto' | 'light' | 'dark'`
- Hook `useResolvedTheme()` para devolver `'light' | 'dark'` resuelto (auto resuelve a `prefers-color-scheme`)

**View Transitions**:
- `components/transitions/view-transition-link.tsx` — wrapper de Next Link con name único

**UI primitives nuevas (shadcn add)**:
- `components/ui/command.tsx`
- `components/ui/tooltip.tsx`
- `components/ui/scroll-area.tsx`
- `components/ui/popover.tsx`
- `components/ui/progress.tsx`
- `components/ui/switch.tsx`
- `components/ui/breadcrumb.tsx`

**UI primitives nuevas (custom)**:
- `components/ui/number-ticker.tsx`
- `components/ui/kbd.tsx`
- `components/ui/page-shell.tsx` — replace ad-hoc `mx-auto max-w-7xl space-y-6 px-4 py-8` (DRY)

**Docs**:
- `docs/design-system.md` — esta misma documentación + screenshots de tokens
- `docs/redesign-2026.md` — changelog detallado
- `README.md` (modify) — actualizar IA + setup PWA local

### 6.2 Archivos a MODIFICAR (cambios concretos)

- `app/layout.tsx` — agregar Fraunces import, `font-serif` var, ThemeProvider wrapper, `Toaster` con `theme="system"`, locale `lang="es-AR"` ya está, manifest link condicional via `metadata.manifest` para `(salon)` route group only? — alternative: link en `(salon)/layout.tsx` head. Decisión: link manifest solo en salón layout.
- `app/page.tsx` — chequear role en redirect-by-role compatible con proxy lógica.
- `app/(auth)/layout.tsx` — bg cream gradient, BrandMark grande, NO tenant-accent.
- `app/(auth)/login/page.tsx` y `login-form.tsx` — actualizar copy, h1 serif, hero ilustración HUB!.
- `app/(auth)/forgot-password/*` — idem styling.
- `app/onboarding/*` — idem styling.
- `app/auth/update-password/*` — idem.
- `app/accept-invite/[token]/*` — idem.
- `proxy.ts` — agregar role-based redirect (sección 4.7).
- `lib/supabase/middleware.ts` — implementar role detection + caching cookie (sección 4.7).
- `lib/tenant/access.ts` — agregar helper `getRoleByCookieOrQuery(slug, userId)`.
- Mover `app/(dashboard)/[tenantSlug]/*` → `app/(manager)/[tenantSlug]/*` con `git mv`. Cada `page.tsx` que esté afectada por la nueva IA se ajusta.
- Mover `app/(dashboard)/[tenantSlug]/cocina` → `app/(salon)/[tenantSlug]/salon/cocina`.
- Mover `app/(dashboard)/[tenantSlug]/sesiones` → `app/(salon)/[tenantSlug]/salon/mesas` (rename a "mesas").
- Componentes shadcn ya instalados — re-stylear:
  - `components/ui/button.tsx` — agregar `active:scale-[0.985]`, hover bg cream tint en `outline`/`ghost`
  - `components/ui/card.tsx` — gap-4 en lugar de gap-6, padding ajustado
  - `components/ui/input.tsx` — `h-10` default, en `(salon)` `h-11` via class
  - `components/ui/badge.tsx` — agregar variant `success`, `warning`, `info`
  - `components/ui/sonner.tsx` — `theme="system"` (ya está) + style con cream tints
  - `components/ui/empty-state.tsx` — ícono dentro de círculo cream con border forest
  - `components/ui/page-header.tsx` — h1 con `font-serif`, eyebrow con tracking más amplio
  - `components/ui/stat-card.tsx` — `<NumberTicker>` para `value`, serif
  - `components/ui/data-table.tsx` — sticky header, hover cream tint
- `components/shell/sidebar-content.tsx` — actualizar con groups nuevos (vía `nav-config-manager.ts`)
- `components/shell/sign-out-action.ts` — sin cambios estructurales
- `components/shell/tenant-switcher.tsx` — re-style, mover de sidebar a topbar
- `components/shell/user-menu.tsx` — agregar entry "Cambiar tema" (abre `theme-toggle`)
- `components/shell/brand-mark.tsx` — rewrite SVG y wordmark
- Páginas listings (`audiencias`, `difusiones`, `flows`, `eventos`, `clientes`) — cambiar copy/eyebrow al dominio nuevo, ej. eyebrow="Marketing" en `difusiones`. Agregar sticky header en sus tablas.
- Páginas detail (`clientes/[id]`, `eventos/[id]`, etc.) — h1 serif, hero glow más prominente.
- Página resumen `(manager)/[tenantSlug]/page.tsx` — `<NumberTicker>` en stat cards, hero serif.
- `next.config.ts` — agregar Serwist (or equivalent) si Context7 confirma. Headers PWA (cross-origin opener para safari quirks).

### 6.3 Archivos a ELIMINAR

- `components/shell/nav-config.ts` (legacy) — reemplazado por `manager/nav-config-manager.ts` y `salon/nav-config-salon.ts`
- `components/shell/app-shell.tsx` (legacy) — reemplazado por `manager/app-shell-manager.tsx`
- `components/shell/mobile-shell.tsx` (legacy) — reemplazado por `manager/mobile-shell.tsx`
- `components/shell/sidebar-nav.tsx` y `sidebar-content.tsx` (legacy) — reemplazados por `manager/*`
- `app/(dashboard)/` directorio entero (vacío después del git mv)
- `app/(dashboard)/[tenantSlug]/sesiones/_components/sessions-grid.tsx` original — re-creado en `salon/mesas`
- `app/(dashboard)/[tenantSlug]/cocina/_components/kds-screen.tsx` — recreado en `salon/cocina`
- Hojas de path `/configuracion/puntos`, `/configuracion/punch-cards`, `/configuracion/tags` — paths viejos: NO los borramos en el codebase de las pages — los **redirigimos** desde `proxy.ts` o un `redirects()` en `next.config.ts` para no romper bookmarks/links viejos:

  ```ts
  // next.config.ts
  async redirects() {
    return [
      { source: '/:slug/configuracion/puntos', destination: '/:slug/puntos', permanent: true },
      { source: '/:slug/configuracion/punch-cards', destination: '/:slug/punch-cards', permanent: true },
      { source: '/:slug/configuracion/tags', destination: '/:slug/configuracion/mensajeria?tab=tags', permanent: true },
      { source: '/:slug/configuracion/mesas', destination: '/:slug/configuracion/local?tab=mesas', permanent: true },
      { source: '/:slug/configuracion/captura', destination: '/:slug/configuracion/local?tab=captura', permanent: true },
      { source: '/:slug/configuracion/auto-aceptacion', destination: '/:slug/configuracion/local?tab=auto-aceptacion', permanent: true },
      { source: '/:slug/configuracion/canales', destination: '/:slug/configuracion/mensajeria?tab=canales', permanent: true },
      { source: '/:slug/configuracion/templates', destination: '/:slug/configuracion/mensajeria?tab=plantillas', permanent: true },
      { source: '/:slug/sesiones', destination: '/:slug/salon/mesas', permanent: true },
      { source: '/:slug/sesiones/:id', destination: '/:slug/salon/mesas/:id', permanent: true },
      { source: '/:slug/cocina', destination: '/:slug/salon/cocina', permanent: true },
      { source: '/:slug/visitas', destination: '/:slug/clientes', permanent: false }, // 307: legacy
    ]
  }
  ```

### 6.4 Orden de implementación dentro de la PR

Cada commit debe pasar `lint:fix && typecheck && test:ci` antes de pasar al siguiente.

1. **`chore(theme): foundation tokens cream+forest light/dark + Fraunces`**
   - `app/globals.css` rewrite
   - `app/layout.tsx` añadir Fraunces
   - `lib/theme/*` (cookie, actions, types)
   - `components/theme/*`
   - `components/ui/sonner.tsx` ajuste theme system
   - Smoke local: las páginas existentes siguen renderizando con cream/forest (no rompen).

2. **`feat(ui): primitives restyled + new shadcn components`**
   - shadcn add: command, tooltip, scroll-area, popover, progress, switch, breadcrumb
   - rewrites de button, card, input, badge (variantes nuevas), data-table, page-header, stat-card, empty-state
   - new: number-ticker, kbd, page-shell, view-transition-link
   - `components/shell/brand-mark.tsx` rewrite

3. **`feat(manager): app shell con sidebar 6 dominios + topbar + ⌘K`**
   - `git mv app/(dashboard) app/(manager)`
   - `components/shell/manager/*` (todos)
   - `components/command-palette/*`
   - `app/(manager)/[tenantSlug]/layout.tsx` actualizado
   - Smoke: sidebar nuevo se ve, ⌘K abre, todas las páginas viejas siguen accesibles via paths viejos (no movemos contenido todavía).

4. **`feat(manager): reagrupación IA — puntos/punch-cards top-level + configuracion 4 cards`**
   - mover `puntos/`, `punch-cards/` a top-level en `(manager)/[tenantSlug]/`
   - rewrite `configuracion/page.tsx` (4 cards index)
   - new `configuracion/local/page.tsx` (tabbed)
   - new `configuracion/mensajeria/page.tsx` (tabbed)
   - new `configuracion/apariencia/page.tsx`
   - `next.config.ts` redirects
   - rename: `clientes` queda con eyebrow "Personas", URL no cambia.

5. **`feat(salon): app shell con bottom-tab + PWA scaffolding`**
   - `app/(salon)/[tenantSlug]/salon/layout.tsx`
   - `components/shell/salon/*` (bottom-tab, topbar, pull-to-refresh, swipe-action, install-prompt)
   - `public/manifest.json` + icons (placeholder PNGs first, real assets last)
   - service worker (Serwist) wiring en `next.config.ts`
   - `app/(salon)/[tenantSlug]/salon/page.tsx` redirect

6. **`feat(salon): mesas + cocina + bandeja mobile-first`**
   - move `(dashboard)/sesiones/*` → `(salon)/salon/mesas/*` (renombrar Sessions → Mesas)
   - move `(dashboard)/cocina/*` → `(salon)/salon/cocina/*`
   - new `(salon)/salon/bandeja/*` (re-styling mobile del split-pane)
   - new `(salon)/salon/mi-turno/page.tsx`
   - `quick-add-customer-modal.tsx`

7. **`feat(manager): redesign de pages — listings + details + forms`**
   - aplicar PageHeader con eyebrow del dominio nuevo en cada page
   - sticky headers en data-tables
   - reescribir `(manager)/[tenantSlug]/page.tsx` (Resumen) con NumberTicker, hero serif, glow forest
   - re-styling de hero cards en `clientes/[id]`, `eventos/[id]`, `difusiones/[id]`, `flows/[id]`, `audiencias/[id]`
   - pulir empty states, loaders y skeletons en cada listing

8. **`feat(auth): rebrand login/onboarding/emails + redirect-by-role`**
   - `app/(auth)/layout.tsx` con cream gradient, hero HUB!, neutral
   - `login-form.tsx` re-styling, copy
   - `forgot-password-form.tsx`, `update-password-form.tsx`, `onboarding-form.tsx`, `accept-invite-client.tsx`
   - `proxy.ts` + `lib/supabase/middleware.ts` — role-based redirect
   - email templates (`resend` ya está) — `lib/email/*` revisar y re-stylear con cream/forest, foot-tag con HUB!

9. **`chore(docs): design-system.md + redesign changelog + README`**
   - `docs/design-system.md`
   - `docs/redesign-2026.md`
   - `README.md` actualizar
   - PR description con before/after screenshots (capturas hechas durante el smoke)

> **Lint+typecheck verde en cada commit**: TS strict + biome. Cualquier lint warning bloquea. Si tocás un type, regenerá `db:types` (no aplica acá pero queda recordado).

---

## 7. Testing manual — smoke pre-merge (≥30 pasos)

Ejecutar en este orden, anotar resultado/screenshot/video corto. **Toolset**: Chrome 124+ desktop, Chrome DevTools mobile sim (iPhone 12, Pixel 7), Safari iOS 17+ device real si posible. 3 cuentas pre-armadas: `owner@hub.dev`, `cashier@hub.dev`, `waiter@hub.dev`. Light + Dark forzados en cada paso relevante.

### Bloque A — Auth + redirect por rol (5 pasos)
1. Login como `owner@hub.dev` → debe llegar a `/hub` (Manager Resumen). Verificar h1 serif "Buen día, HUB! Coffee&Bar". Light + Dark.
2. Logout. Login como `cashier@hub.dev` → debe llegar a `/hub/salon/mesas` (Salón). Bottom-tab visible, top-bar contextual.
3. Logout. Login como `waiter@hub.dev` → idem cashier. Verificar que el tab "Cocina" NO aparece (waiter no tiene rol cocina), reemplazado por... actually waiter-only sees: Mesas, Bandeja, Mi turno + tab "Cocina" oculto.
4. Como `owner` logueado, navegar manualmente a `/hub/salon` → entra al salón (no se redirige). Verificar topbar muestra "Modo salón (estás como owner)" badge.
5. Como `cashier` logueado, navegar a `/hub` → debe redirigir a `/hub/salon/mesas` automáticamente.

### Bloque B — Manager: navegación + ⌘K (6 pasos)
6. En `/hub` (owner), abrir sidebar → verificar 6 dominios en orden HOY/CLIENTES/MARKETING/CATÁLOGO/INSIGHTS/AJUSTES. Verificar tenant-switcher en topbar (no en sidebar).
7. Click cada item de sidebar (≥10 clicks) → todas las páginas cargan, h1 serif, eyebrow correcto. Light.
8. Cambiar a Dark via UserMenu → todas las páginas se ven a paridad (sin glitches, sin flash de color).
9. Presionar `⌘K` (Mac) o `Ctrl+K` (Win) → palette abre. Tipear "cli" → "Personas" highlight. Enter → navega a `/hub/clientes`.
10. Tipear nombre de cliente real (ej. "Maru") → search debounced muestra resultados. Click → `/hub/clientes/<id>`. Verificar hero serif, KPIs con NumberTicker animando.
11. Probar todos los items "Acciones rápidas" del palette: "Cerrar mesa" lleva a `/hub/visitas/nueva`, "Nueva difusión" a `/hub/difusiones/nueva`, etc.

### Bloque C — Settings reagrupado (3 pasos)
12. Ir a `/hub/configuracion` → ver 4 cards (Equipo / Local / Mensajería / Apariencia).
13. Click `Local` → tabbed con `mesas | captura | auto-aceptación`. Cambiar tab via URL `?tab=` y refrescar — el tab queda seleccionado (deep-link funciona).
14. Bookmark viejo `/hub/configuracion/puntos` → 308 redirect a `/hub/puntos` (top-level). Verificar que el contenido es el mismo.

### Bloque D — Resumen + charts + KPIs (3 pasos)
15. En `/hub` (Resumen), verificar 4 stat cards. Refrescar página → NumberTicker anima 0→valor en ~800ms. Light + Dark.
16. Hover sobre RevenueChart → tooltip glassy aparece con backdrop-blur. Light + Dark.
17. Si `firstVisit=false`, OnboardingChecklist se ve con cream highlight y forest CTA. Click "Cargar menú" → navega a `/hub/menu`.

### Bloque E — Salón mobile (8 pasos)
18. Logout, login `cashier`, abrir DevTools mobile sim 390×844. Llegar a `/hub/salon/mesas`. Bottom-tab fixed bottom, sin scroll horizontal, h1 serif "Mesas activas" (o nombre dinámico).
19. Pull-to-refresh en grid de mesas → loading indicator + refresh. Datos no cambian si no hay pendings nuevos (esperable).
20. Tap card de mesa → `/hub/salon/mesas/[id]`. Topbar contextual muestra "Mesa 4 · 18:42 · $12.300".
21. Swipe-left card de mesa → reveal acción "Marcar pagada". AlertDialog full-screen confirm. Cancelar → vuelve a list.
22. Tap "+ Cliente" en mesa → modal full-screen con tabs Existente/Nuevo. En "Nuevo", tipear teléfono → teclado numérico nativo aparece. Submit → toast verde, modal cierra.
23. Tap tab "Cocina" → grid de tickets. Tap "Empezar" en un ticket → status cambia con animación motion. Toast "Empezando".
24. Tap tab "Bandeja" → lista vertical de conversaciones. Tap una → vista de mensajes. Botón back en topbar.
25. Tap tab "Mi turno" → perfil + theme toggle + cerrar sesión + (si rol owner) "Volver a modo manager".

### Bloque F — PWA + offline (3 pasos)
26. En Chrome DevTools mobile, Application → Manifest → todo verde (icons OK, theme color OK, start_url OK, display standalone). Lighthouse PWA score = 100.
27. Click "Add to Home Screen" sim → ícono se agrega. Abrir desde standalone → no se ve URL bar, sí se ve top-bar de la app.
28. DevTools → Network → offline. Refrescar `/hub/salon/mesas` → app shell carga desde SW cache, datos cached muestran (TTL 5min). Intentar mutación (swipe pagada) → toast "Necesitás conexión".

### Bloque G — Auth pages rebranded (2 pasos)
29. Logout. Ver `/login` → cream gradient bg, BrandMark grande, h1 serif "Ingresá a tu bar". Sin tenant-accent (neutral). Light + Dark.
30. Toggle theme en login (?) → verificamos: en login NO hay toggle (es decisión: keep simple). Forzar dark via OS → la pantalla respeta `prefers-color-scheme`.

---

## 8. Riesgos y mitigaciones

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | Staff abre `/[slug]/clientes` (manager) | Alto: ven UI que no entienden | Proxy redirige role staff a `/salon` antes de SSR. Cookie `hub_role_<slug>` cachea 1h. |
| 2 | PWA manifest mal configurado → no instala | Medio: feature core de salón | Lighthouse PWA score 100 en cada commit que toque salón. Test device real. |
| 3 | View Transitions API no soportada Firefox/iOS<18 | Bajo: degradado a fade | Feature detection `if ('startViewTransition' in document)`. Fallback a fade automático en Next 16. |
| 4 | Bundle size explota con Motion + Fraunces + Inter | Medio: Lighthouse perf < 90 | `font-display: swap`, code-split por route group, `motion` solo en `(salon)` y manager dashboard, NO en login/auth, NO en ⌘K si es solo CSS. Lighthouse audit en cada commit. |
| 5 | Tailwind v4 + tokens nuevos rompen shadcn primitives ya instalados | Alto: pages se rompen visual | Spike de 30min antes del Commit 1: meter solo `globals.css` rewrite + abrir 5 páginas representativas en local. Si rompe → fix antes. |
| 6 | RLS leakage al usar `tenants.theme jsonb` para tenant-accent | Alto: cross-tenant info | El query de `tenants.theme` ya pasa por `requireTenantAccess`. Doble check: server-only file con `'server-only'` import. |
| 7 | Redirect loop entre `/` → `/[slug]` → `/[slug]/salon` → ... | Crítico: app inutilizable | El proxy no debe redirigir si el path destino es el mismo. Test explícito en smoke (paso 5). |
| 8 | CSP/headers se rompen con SW + manifest | Medio: PWA no funciona | `next.config.ts` headers añade `Content-Security-Policy` permisivo para SW solo en `/_next/static/sw.js`. Test con Chrome DevTools Console (no errors). |
| 9 | Multi-tenant accent var leaking entre tenants | Alto: tenant A ve color de tenant B | `tenant-accent-style.tsx` server-renderiza `<style scoped>` por route, NO `<style global>`. Si hay duda, usar `style={{ '--tenant-accent': ... }}` directo en el `<div>` raíz del layout. |
| 10 | Cache stale del proxy `hub_role_<slug>` cookie cuando owner cambia rol a staff | Medio: staff ve manager por 1h | TTL 1h aceptable; el owner que cambia un role puede invalidar manualmente con server action que `cookies().delete()` (out-of-band). Documentar en `equipo` page. |
| 11 | Pull-to-refresh interfiere con scroll nativo iOS | Bajo: UX confusa | Solo activar pull-to-refresh cuando `scrollTop === 0` y el touch va hacia abajo. Threshold 80px. Bibliotecas no, 60 LOC custom. |
| 12 | Service Worker cachea HTML stale post-deploy | Alto: app no se actualiza | `serwist` ya hace `skipWaiting` y `clientsClaim`. Header `Cache-Control: no-store` para HTML. Test post-deploy. |
| 13 | NumberTicker hidrata a 0 → flash visual | Medio: degrada perceived perf | SSR renderiza el valor final. Animación arranca en `useEffect` desde el valor final hacia... no, justo al revés: SSR renderiza valor final, en client `useEffect` empieza la animación de `0 → valor`. Pero esto causa flash. **Decisión**: skip animación en first paint si `prefers-reduced-motion`. Sino, animación está OK porque ocurre dentro de `<motion.span>` con `useMotionValue`. |
| 14 | Light/Dark no a paridad — algún componente queda gris | Medio: incoherencia visual | Smoke explícito de cada page en ambos modos (sección 7). |
| 15 | `tw-animate-css` clases conflictan con motion v15+ | Bajo: animaciones dobles | Mantener `tw-animate-css` solo para skeletons + slide-in básicos. Motion solo donde haya state-driven animation (KDS, NumberTicker, route transitions). |
| 16 | Search ⌘K dispara fetches en cada keystroke | Bajo: rate limit | Debounce 250ms + abort previous request con AbortController. |
| 17 | Fraunces `axes` no soportado en algunos browsers | Bajo: serif feo | `next/font` resuelve fallback. Test en Safari 16. |
| 18 | git mv masivo rompe imports | Crítico: build no compila | Hacer git mv en commit dedicado (Commit 3) con find/sed para actualizar imports `from '@/app/(dashboard)/...'` → `from '@/app/(manager)/...'`. Biome catch los broken imports. |
| 19 | Cache Components / `use cache` directive en Next 16 entra en conflicto | Bajo: pero plan no usa cache components todavía | El sistema actual usa `force-dynamic` o nada. Anotar en BACKLOG: futuro fase Cache Components. NO en este redesign. |
| 20 | `next-themes` no instalado, theme switch genera flash | Medio: degrada percep perf | Implementación manual con cookie httpOnly leída en `app/layout.tsx` (server) → setea class `dark` en `<html>`. NO flash porque la clase está antes de hidratación. |

---

## 9. Definition of Done (DoD)

Reusamos DoD de `CLAUDE.md` sección 11, **agregamos 8 ítems específicos**:

1. ✅ UI accesible y mobile-friendly (manda `CLAUDE.md`)
2. ✅ Migraciones generadas y aplicadas localmente — **N/A en este PR**, no hay schema changes
3. ✅ RLS configurada y testeada — N/A, no hay tablas nuevas
4. ✅ Tipos regenerados — N/A
5. ✅ Zod schemas en cada borde nuevo (`setThemePreference` action)
6. ✅ Tests unit verdes — agregar test para `lib/theme/cookie.ts` (parse + serialize) y para `roleByCookieOrQuery`
7. ✅ Smoke manual del happy path — los 30 pasos de sección 7 documentados en PR
8. ✅ Sin errores TS, sin warnings de lint
9. ✅ README de la feature actualizado — actualizar README con nueva IA + setup PWA local
10. ✅ PR con descripción completa
11. ✅ Conventional commit (los 9 commits)

**Adicionales del rediseño**:
12. ✅ **Smoke desktop owner** completo (bloque B/C/D ejecutado, screenshots Light + Dark)
13. ✅ **Smoke mobile staff** completo (bloque E/F ejecutado, real device si posible, sino DevTools mobile sim)
14. ✅ **Lighthouse score Performance ≥ 90** en `/[slug]` y `/[slug]/salon` (mobile + desktop)
15. ✅ **Lighthouse PWA score = 100** en `/[slug]/salon` (Chrome DevTools)
16. ✅ **Light + Dark a paridad**: cada page rendereada en ambos modos (screenshot pareado en PR)
17. ✅ **Sin warnings de tipos** en `tsc --noEmit`, `biome check`
18. ✅ **README actualizado** con nueva estructura de IA + comando para correr SW localmente
19. ✅ **Screenshots before/after** en PR description, mínimo 8 pares (login, resumen, clientes list, cliente detail, eventos, difusiones, salon mesas mobile, salon cocina mobile)

---

## 10. Diagrama final — la IA como vista por el usuario

```
                           ╔══════════════════════════════╗
                           ║     /login (cream / serif)   ║
                           ╚══════════════════════════════╝
                                         │
                                proxy.ts: role lookup
                          ┌──────────────┴────────────────┐
                          ▼                               ▼
      ╔═══════════════════════════════╗   ╔═══════════════════════════════╗
      ║  MANAGER  (owner only)        ║   ║  SALÓN  (cashier/waiter/      ║
      ║  /[slug]                      ║   ║         kitchen)              ║
      ║                               ║   ║  /[slug]/salon                ║
      ║  HOY                          ║   ║                               ║
      ║   • Resumen                   ║   ║  ┌──────────────────────────┐ ║
      ║   • Salón en vivo (link out)  ║   ║  │ TABS BOTTOM (4)          │ ║
      ║   • Bandeja                   ║   ║  │  ┌──┐ Mesas              │ ║
      ║                               ║   ║  │  ├──┤ Cocina (no waiter) │ ║
      ║  CLIENTES                     ║   ║  │  ├──┤ Bandeja            │ ║
      ║   • Personas (= /clientes)    ║   ║  │  └──┘ Mi turno           │ ║
      ║   • Audiencias                ║   ║  └──────────────────────────┘ ║
      ║                               ║   ║                               ║
      ║  MARKETING                    ║   ║  PWA installable              ║
      ║   • Difusiones                ║   ║  Service worker + cache shell ║
      ║   • Flows                     ║   ║  Pull-to-refresh              ║
      ║   • Eventos                   ║   ║  Swipe-left "marcar pagada"   ║
      ║                               ║   ║  Quick add cliente modal      ║
      ║  CATÁLOGO                     ║   ║                               ║
      ║   • Menú                      ║   ║  Mobile vertical 390×844      ║
      ║   • Puntos     ← top-level    ║   ║  Inputs h-11 touch target     ║
      ║   • Punch cards ← top-level   ║   ╚═══════════════════════════════╝
      ║                               ║
      ║  INSIGHTS                     ║
      ║   • Estadísticas              ║
      ║                               ║
      ║  AJUSTES                      ║
      ║   • Configuración             ║
      ║      └ 4 cards:               ║
      ║         · Equipo              ║
      ║         · Local (tabs)        ║
      ║         · Mensajería (tabs)   ║
      ║         · Apariencia          ║
      ║                               ║
      ║  desktop-first, sidebar 280px ║
      ║  ⌘K palette, AUTO theme       ║
      ║  view transitions             ║
      ╚═══════════════════════════════╝
```

---

## 11. Notas finales para el dev que ejecuta

1. **No ahorres en Context7**. Confirmá versiones de `motion`, `@serwist/next` (o equivalente), `next/font/google` axes Fraunces, view transitions API en Next 16 antes de escribir línea. Si Context7 no responde, parar y preguntar.
2. **Spike 30min** primero: solo aplicá `globals.css` nuevo y abrí 5 páginas. Si las shadcn primitives revientan, fix antes de los 9 commits.
3. **No toques RLS, no toques migraciones, no toques server actions de negocio.** Todo este rediseño es UI + IA + auth-redirect. Si te tienta tocar `lib/customers/queries.ts` para "mejorar el N+1", anotalo en BACKLOG y seguí.
4. **Cada commit debe ser auto-contenido**: `git checkout` cualquier commit y la app compila + pasa lint.
5. **No mergees sin smoke real device** del salón. La PWA hay que verla instalada en un teléfono.

---

### Critical Files for Implementation

Los archivos más load-bearing para ejecutar este plan, en orden de criticidad:

- `/Users/ignaciobaldovino/Hub/app/globals.css` (rewrite tokens + fonts vars + animation tokens)
- `/Users/ignaciobaldovino/Hub/app/layout.tsx` (Fraunces + ThemeProvider + Toaster system)
- `/Users/ignaciobaldovino/Hub/proxy.ts` y `/Users/ignaciobaldovino/Hub/lib/supabase/middleware.ts` (role-based redirect, single source of truth de routing por workspace)
- `/Users/ignaciobaldovino/Hub/components/shell/manager/app-shell-manager.tsx` y `/Users/ignaciobaldovino/Hub/components/shell/salon/app-shell-salon.tsx` (los dos shells nuevos — todo el resto cuelga de acá)
- `/Users/ignaciobaldovino/Hub/next.config.ts` (redirects de paths viejos + Serwist/PWA wiring + headers)
