# HUB Platform

CRM multi-tenant para bares — Next.js 16 + Supabase + Tailwind v4.

## Bootstrap

```bash
git clone <repo> hub
cd hub
npm install
cp .env.example .env.local           # completar las variables
npx supabase start                    # levanta Postgres local + Studio
npm run db:reset                      # migraciones + seed.sql (incluye bootstrap)
npm run dev                           # http://localhost:3000
```

`db:reset` corre `seed.sql`, que crea de forma idempotente:
- Tenant `HUB! Coffee & Bar` con slug `hub` (id fijo en el seed).
- Owner user `owner@hub.local` (password `hub2026`) con `active_tenant_id`
  apuntando a HUB.
- Membership owner → HUB.
- Toda la data demo (40 clientes, 5 categorías de menú, eventos, audiencias,
  difusiones, flows, etc.) lista para exhibir el dashboard.

Después de cada migración nueva regenerá los tipos:

```bash
npm run db:types
```

### Credenciales de prueba (local)

| Email | Password | Rol | Tenant |
|---|---|---|---|
| `owner@hub.local` | `hub2026` | `owner` | `/hub` |

> Estas credenciales sólo aplican en local — el seed detecta permisos y
> omite el bootstrap de auth en proyectos remotos.

## Workspaces

Desde el rediseño 2026, HUB tiene dos productos visualmente distintos
según el rol del usuario logueado. El proxy decide adónde mandarte
después del login.

```
LOGIN (cream/forest neutral)
   │
   ├── role = owner   →  /[slug]                (Manager Dashboard)
   └── role staff     →  /[slug]/salon          (Salón POS, PWA)
```

**Manager** (desktop-first): sidebar persistente con 6 dominios
(Hoy / Clientes / Marketing / Catálogo / Insights / Ajustes), topbar
con búsqueda ⌘K, tenant switcher y theme toggle. Pensado para uso
prolongado con teclado/mouse.

**Salón** (mobile-first): bottom-tab nav (Mesas, Cocina, Bandeja,
Mi turno), gestos de swipe-left y pull-to-refresh, instalable como
PWA con su propio service worker. Pensado para celular en turno.

`docs/redesign-2026.md` documenta el changelog y `docs/design-system.md`
los tokens, tipografía y patrones.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Next.js dev (Turbopack, ya es default en Next 16) |
| `npm run build` | Build de producción |
| `npm run start` | Server de producción |
| `npm run lint` | Biome (lint + format check) |
| `npm run lint:fix` | Biome con `--write` |
| `npm run format` | Solo format con Biome |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest watch |
| `npm run test:ci` | Vitest run (single pass) |
| `npm run db:start` / `db:stop` / `db:reset` / `db:push` / `db:diff` | Wrappers de Supabase CLI |
| `npm run db:types` | Regenera `types/database.ts` desde el schema local |

## PWA — modo salón

El servicio worker está en `public/sw.js`. Se registra automáticamente
en `production` cuando entrás a `/[slug]/salon`. En desarrollo el SW
NO se registra (para no cachear assets viejos durante hot reload).

Para probar la PWA en local:

```bash
npm run build
npm run start
# abrir http://localhost:3000 en Chrome → DevTools → Application
# → Manifest / Service Workers / "Add to Home Screen"
```

El manifest está en `public/manifest.webmanifest`. Los iconos en
`public/icons/` (SVG; agregar PNGs reales antes de Lighthouse 100).

## Estructura

Ver `CLAUDE.md` para la estructura completa, la ley multi-tenant y las
convenciones del proyecto.

## Calidad

- **Biome** reemplaza ESLint+Prettier.
- **Husky** corre `typecheck + lint + test:ci` en pre-commit.
- **GitHub Actions** corre los mismos checks en cada PR a `main`.

## Variables de entorno

Ver `.env.example`. Las variables sensibles (`SUPABASE_SERVICE_ROLE_KEY`,
`META_TOKEN_KEY`, `META_APP_SECRET`, `CRON_SECRET`) **nunca** se
exponen al cliente — el patrón `NEXT_PUBLIC_*` es solo para vars
públicas.
