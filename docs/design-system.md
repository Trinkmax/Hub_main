# HUB Design System (2026)

Sistema de diseño para HUB — cream + forest, light/dark a paridad,
multi-tenant ready. Basado en Tailwind v4 + shadcn/ui new-york.

---

## 1. Tokens de color (OKLCH)

Todas las CSS vars viven en `app/globals.css`. Light mode bajo `:root`,
dark bajo `.dark` (clase aplicada por el `ThemeProvider` en
`<html>`).

### Polos de marca

| Concepto | Light | Dark |
|---|---|---|
| Cream paper (background) | `oklch(0.965 0.022 88)` ≈ `#f5edd7` | `oklch(0.155 0.022 165)` ≈ `#0f2a20` |
| Forest ink (foreground) | `oklch(0.205 0.035 165)` ≈ `#14332a` | `oklch(0.945 0.015 88)` ≈ `#f0e8d0` |
| Primary CTA | forest | cream |
| Destructive | terracotta `oklch(0.555 0.155 35)` | warm `oklch(0.66 0.165 35)` |

### Surface ladder

```
background  ←  surface  ←  card  ←  popover
   más bajo                         más alto
```

Cada paso sube ~1% en luminosidad (light) y diluye un poco el chroma.
Los hovers usan `--cream-tint` (cream con alpha 65%) y los glows
`--forest-glow` (primary con alpha 18%).

### Status

| Token | Uso |
|---|---|
| `--success` | Confirmaciones positivas (forest variant). |
| `--warning` | Alertas no-bloqueantes (warm amber). |
| `--info` | Mensajes informativos (dusty blue). |
| `--destructive` | Acciones peligrosas / errores (terracotta). |

### Charts

`--chart-1..5` son una paleta análoga warm earth tones (forest →
terracotta → amber → dusty navy → salmon). NO usar para semántica de
estados — eso es status.

### Multi-tenant ready

`--tenant-accent` y `--tenant-accent-foreground` son vars listas para
inyectar via `<style>` server-renderizado por tenant. HUB hereda
`--primary`. Cuando entre otro bar con paleta propia, el componente
`TenantAccentStyle` (`components/theme/tenant-accent-style.tsx`)
inyecta el override.

---

## 2. Tipografía

```css
--font-sans:    var(--font-inter), ui-sans-serif, system-ui, …
--font-serif:   var(--font-fraunces), ui-serif, Georgia, …
--font-display: var(--font-fraunces), ui-serif, Georgia, …
```

**Fraunces** se carga con `next/font/google` y `display: 'swap'`
con eje opsz para servir corte óptimo según tamaño.
**Inter** ídem.

### Cuándo usar serif

- Hero `<h1>` de cualquier página (`PageHeader.title`)
- Section `<h2>` decorativos
- Big numbers en `StatCard` / `NumberTicker`
- Wordmark "HUB!" en `BrandWordmark` / `BrandWordmarkLarge`
- **Todo lo demás** → Inter.

### Escala (tokens utilities Tailwind)

| Token | Tamaño | Peso | Uso |
|---|---|---|---|
| `font-serif text-3xl` (hero) | 30px | 600 | Page titles |
| `font-serif text-xl` (card) | 20px | 600 | Card hero titles |
| `text-sm` (body) | 14px | 400 | Default body |
| `text-xs uppercase tracking-[0.18em]` | 11px | 500 | Eyebrow / label |
| `tabular-nums` | inherit | inherit | Money, counts |

---

## 3. Espaciado, radius, sombras

- **Radius**: base 10px (`--radius`); scale `sm/md/lg/xl/2xl` derivada
  con calc().
- **Sombras tintadas**: usan `color-mix(in oklch, var(--foreground) X%, transparent)`.
  Resultado: warm-brown en light, forest-deep en dark — nunca
  `rgba(0,0,0,…)` plano.
- **Page padding**: `px-4 sm:px-6 lg:px-8`. `PageShell` lo envuelve.
- **Section spacing**: `space-y-6` entre bloques verticales.

---

## 4. Animaciones

Tokens de timing en `@theme inline`:

```
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1)
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)
--ease-spring: cubic-bezier(0.5, 1.4, 0.5, 1)
--duration-fast:   120ms
--duration-base:   200ms
--duration-slow:   320ms
--duration-slower: 500ms
```

Patrones usados:

- **Botones**: `active:scale-[0.985]` con `transition-transform`.
- **Cards en hover**: `-translate-y-0.5` + `shadow-md` con duración
  `var(--duration-base)`.
- **NumberTicker**: spring (`useSpring` de `motion`) durante ~800ms,
  honra `prefers-reduced-motion`.
- **Realtime card reorder** (cocina, mesas): `motion.div` con `layout`
  (TODO en próxima fase).
- **View Transitions API** entre rutas: `ViewTransitionLink`
  (`components/ui/view-transition-link.tsx`) detecta soporte y hace
  fallback transparente.

---

## 5. Componentes shadcn

`components/ui/*` — todos basados en shadcn new-york.

### Custom (no shadcn)

| Componente | Uso |
|---|---|
| `NumberTicker` | Anima un número de 0→n con spring suave. |
| `Kbd` | `<kbd>` styling para shortcuts (⌘K, etc.). |
| `PageShell` | Container estándar (compact/default/wide/full). |
| `ViewTransitionLink` | Wrap de Link con View Transitions API. |
| `StatCard` | KPI card; admite `numberValue` para usar NumberTicker. |
| `EmptyState` | Hero ilustración + CTA cuando no hay data. |
| `PageHeader` | h1 serif + eyebrow + actions slot. |
| `DataTable*` | HTML table primitives con sticky header + cream hover. |

### Variantes nuevas en primitives

- `Badge`: `default | secondary | destructive | success | warning | info | outline | muted`.
- `Button`: `default | destructive | outline | secondary | ghost | link | success`. Sizes `sm/default/lg/xl/icon`.

---

## 6. Brandmark

`components/shell/brand-mark.tsx`:

- `BrandMark size={n}` — SVG cuadrado con "HUB!" serif heavy en
  `currentColor`. Usa `var(--font-fraunces)` con fallback Georgia.
- `BrandWordmark` — wordmark inline 15px tracking -0.04em con `!` en
  `text-primary`.
- `BrandWordmarkLarge` — hero login/onboarding/email; 5xl + tagline
  COFFEE & BAR sm+.

---

## 7. PWA (modo salón)

- `public/manifest.webmanifest`: `display: standalone`, portrait,
  cream/forest theme colors.
- `public/icons/hub.svg` y `hub-maskable.svg`: iconos en SVG con
  HUB! serif. **TODO**: PNGs 192/512 reales para Lighthouse 100.
- `public/sw.js`: cache versionado (`hub-salon-v1`), network-first
  HTML, cache-first static. POSTs van directo al network.
- `components/shell/salon/service-worker-registration.tsx`: monta SW
  solo en production.
- `components/shell/salon/install-prompt.tsx`: captura
  `beforeinstallprompt`, espera 2 min, ofrece instalar con cooldown
  de 7 días.

---

## 8. Theme

- Cookie `hub_theme` (`auto`/`light`/`dark`), TTL 1 año, no httpOnly
  (JS necesita leerla en el no-flash script inline).
- `lib/theme/cookie.ts` — server-side reader.
- `lib/theme/actions.ts` — Server Action que persiste preferencia.
- `components/theme/theme-provider.tsx` — Client provider, listener
  de `prefers-color-scheme` cuando pref=auto.
- `components/theme/no-flash-script.ts` — script inline en `<head>`
  que setea `dark` class antes de hidratación.
- `components/theme/theme-toggle.tsx` — DropdownMenu con 3 opciones.

---

## 9. Idioma + locale

UI en español rioplatense (`es-AR`). Moneda ARS. Fechas
`dd/MM/yyyy HH:mm`. Plata en centavos (bigint). Locale fijo:
`America/Argentina/Cordoba`.

Verbos en imperativo positivo: "Cerrar", "Abrir", "Enviar".
Tono neutro-elegante: "¿Cerrás esta mesa?" sí, "vos chocho" no.

---

## 10. Convenciones de uso

```tsx
// Page típica del manager
<PageShell>
  <PageHeader
    eyebrow="Marketing"
    title="Difusiones"
    description="Mandá un template aprobado a una audiencia."
    actions={<Button>Nueva difusión</Button>}
  />
  <DataTableShell>
    <DataTableScroll>
      <DataTableRoot>
        <DataTableHead sticky>…</DataTableHead>
        <DataTableBody>…</DataTableBody>
      </DataTableRoot>
    </DataTableScroll>
  </DataTableShell>
</PageShell>
```

```tsx
// Stat con NumberTicker
<StatCard
  icon={Users}
  label="Clientes"
  numberValue={1247}
  numberFormat={(n) => Intl.NumberFormat('es-AR').format(Math.round(n))}
  delta="+12%"
  deltaTone="positive"
/>
```
