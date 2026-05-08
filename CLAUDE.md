# CLAUDE.md — Plataforma HUB

> Este archivo es el contexto permanente del proyecto. **Léelo siempre antes de cualquier tarea.** Si algo en un prompt de fase contradice este archivo, este archivo gana.

---

## 1. Contexto

Estamos construyendo una **plataforma SaaS multi-tenant tipo CRM para bares**. El bar semilla es **HUB** (Córdoba, Argentina), pero la plataforma debe servir a cualquier bar desde el día 1.

**Problema que resuelve:** los bares no saben quién es su cliente. La plataforma captura datos de cliente al momento de cobrar, los fideliza con un sistema de puntos, gestiona eventos del calendario mensual y permite hacer marketing por WhatsApp e Instagram con difusiones y flows automáticos.

**Usuarios:**
- **Dueño (`owner`)**: configura el bar, ve estadísticas, gestiona staff, lanza difusiones.
- **Cajero (`cashier`)**: cierra mesas, carga consumo, registra clientes nuevos.
- **Mozo (`waiter`)**: registra clientes, marca check-in en eventos.

**Cliente final del bar:** carga sus datos (nombre, apellido, teléfono) escaneando un QR en la mesa o lo carga el staff manualmente.

---

## 2. Stack (cerrado, no cambiar sin autorización)

- **Next.js 16.2+** App Router, React Server Components, Server Actions.
  **Turbopack es default** en `next dev` y `next build` — no agregar
  `--turbopack` a los scripts. **No activar React Compiler** al inicio
  (queda como optimización futura).
- **React 19.2+** (incluido por Next.js 16). Hooks `useActionState`,
  `useFormStatus`, `useEffectEvent` estables.
- **TypeScript** estricto (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Tailwind CSS v4.2+** + **shadcn/ui** estilo **`new-york`** (es el nuevo
  default desde la migración a v4), colores en OKLCH. Usar
  **`tw-animate-css`** — `tailwindcss-animate` está deprecado.
- **Supabase**: Postgres 15+ + Auth + Storage + Realtime + pg_cron.
  `@supabase/supabase-js` v2 (≥ 2.105) y `supabase` CLI v2 (≥ 2.98)
  como dev-dependency local.
- **Vercel** para deploy (web + API + cron jobs)
- **WhatsApp Business Platform (Cloud API)** + **Instagram Graph API** vía Meta Graph
- **react-hook-form** + **zod** para formularios y validación
- **TanStack Query** solo donde sea necesario revalidación granular en cliente; preferir RSC + Server Actions
- **sonner** para toasts (el `Toast` original de shadcn está deprecado)
- **date-fns** + `America/Argentina/Cordoba`
- **Vitest** (unit) — sin E2E automatizado en MVP, validación con smoke manual
- **npm** + **Biome** (lint+format) + **husky** (pre-commit)
- **Conventional Commits**

> Las versiones mínimas listadas son las que ya están en producción al inicio
> del proyecto. **Antes de instalar cualquier dependencia, consultá Context7**
> (sección 13) para confirmar la versión exacta vigente y revisar breaking
> changes recientes.

**Idioma:** UI en español rioplatense (`es-AR`). Moneda **ARS**. Fechas `dd/MM/yyyy HH:mm`. Plata siempre en **centavos** (`bigint`).

---

## 3. Estructura de carpetas

```
/app
  /(auth)/login
  /(auth)/accept-invite/[token]
  /(dashboard)
    /[tenantSlug]                  ← scoping por bar en URL
      /clientes
      /menu
      /visitas
      /eventos
      /difusiones
      /flows
      /bandeja
      /estadisticas
      /configuracion
  /capture/[linkSlug]              ← captura pública QR (sin auth)
  /api
    /webhooks/whatsapp
    /webhooks/instagram
    /webhooks/meta-verify
    /cron/process-broadcasts
    /cron/process-flows
    /cron/refresh-stats
/components
  /ui                              ← shadcn (no editar manualmente)
  /<dominio>                       ← componentes de negocio
/lib
  /supabase
    server.ts                      ← createServerClient (cookies)
    browser.ts                     ← createBrowserClient
    service.ts                     ← createServiceClient (SOLO server)
  /tenant                          ← getCurrentTenant, requireRole, etc.
  /auth
  /meta
    whatsapp.ts
    instagram.ts
    templates.ts
  /points                          ← motor de cálculo de puntos
  /audiences                       ← evaluador de filtros
  /flows                           ← runtime de flows
/db
  /migrations                      ← Supabase CLI
  /seed
  /policies                        ← snippets RLS reusables
/types
  database.ts                      ← generado con supabase gen types
```

---

## 4. LEY multi-tenant (no negociable)

Estas reglas se aplican **siempre**. Romperlas es bloqueante para mergear.

1. **Toda tabla de negocio lleva `tenant_id uuid not null references tenants(id) on delete cascade`.** Sin excepciones.
2. **Toda tabla de negocio tiene RLS habilitada** y políticas que filtran por membresía del usuario.
3. **El cliente browser nunca usa `service_role`.** Solo `anon` con sesión.
4. **`service_role` solo en**: webhooks (`/api/webhooks/*`), cron (`/api/cron/*`), y scripts admin. Siempre con `tenant_id` explícito en cada query.
5. **Cada Server Action y Route Handler valida**: usuario autenticado + membership con role suficiente para esa acción. Helpers obligatorios:
   ```ts
   const { tenant, role } = await requireTenantAccess(tenantSlug)
   await requireRole(role, ['owner', 'cashier'])
   ```
6. **Las URLs scopean al tenant**: `/{tenantSlug}/clientes`. El middleware valida el slug contra membership antes de servir.
7. **El JWT lleva el `tenant_id` activo** como custom claim para que las RLS puedan leerlo sin hop a la DB. Función `set_active_tenant(uuid)` que actualiza el claim.
8. **Auditoría**: toda mutación sensible (crear cliente, enviar broadcast, canjear puntos) escribe en `audit_log`.

### RLS pattern estándar

```sql
-- En toda tabla de negocio:
alter table public.<tabla> enable row level security;

create policy "<tabla>_tenant_isolation" on public.<tabla>
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid()
    )
  );

-- Para escrituras restringidas por rol:
create policy "<tabla>_owner_write" on public.<tabla>
  for insert
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
```

---

## 5. Convenciones de DB

- `snake_case`, tablas en plural.
- `id uuid primary key default gen_random_uuid()`.
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` con trigger.
- Plata: `_cents bigint`.
- Strings sensibles cifrados con `pgcrypto` (tokens de Meta, etc.).
- Migraciones generadas con `pnpm supabase migration new <slug>`. **Nunca** editar migraciones ya aplicadas.
- `pnpm supabase gen types typescript --local > types/database.ts` después de cada migración.
- Soft delete con `deleted_at timestamptz` solo donde haga falta (clientes, eventos cancelados). Default es delete físico.

### IMPORTANTE — Supabase Data API GRANTs (cambio del 30/05/2026)

A partir del **30 de mayo de 2026**, los nuevos proyectos Supabase
requieren GRANT explícito para que las tablas del schema `public` sean
accesibles vía Data API (PostgREST / `supabase-js`). Desde el
**30 de octubre de 2026** esto también aplica a proyectos existentes.

**Toda migración que cree tablas de negocio en `public` debe incluir
los GRANTs al final**:

```sql
-- después de crear la tabla y configurar RLS:
grant select, insert, update, delete on public.<tabla> to authenticated;

-- solo si necesitás acceso anónimo (ej. capture_links, capture_submissions):
grant select on public.<tabla> to anon;
grant insert on public.<tabla> to anon;
```

RLS sigue siendo la única defensa de filas. El GRANT abre el endpoint;
sin políticas RLS, el GRANT no expone datos. Antes de mergear cualquier
migración, **verificar que está el GRANT correspondiente** o las tablas
serán invisibles para `supabase-js`.

---

## 6. Convenciones de código

- **Server Components por defecto.** Marcar `"use client"` solo si hay interactividad.
- **Server Actions** para mutaciones, no Route Handlers (excepto webhooks y endpoints públicos).
- **Validación con zod** en cada borde (Server Action input, webhook payload, form).
- **Error handling**: nunca tragarse errores. Loguear con contexto (sin PII), responder al usuario con mensaje accionable.
- **Imports absolutos** desde `@/`.
- Componentes UI puros en `/components/ui` (shadcn). Componentes de dominio en `/components/<dominio>`.
- Naming: archivos `kebab-case.tsx`, componentes `PascalCase`, hooks `useCamelCase`, server actions `camelCase`.
- Sin `any`. Si hace falta, `unknown` + narrowing.
- Sin lógica de negocio en componentes — extraer a `/lib`.

---

## 7. UI/UX

- **Mobile-first**. El staff usa tablet o celular. El dashboard del owner se ve también en desktop.
- shadcn `default` theme + dark mode opcional vía `next-themes`.
- Skeletons en cualquier suspense > 200ms.
- Optimistic updates en acciones frecuentes (toggle, tag, check-in).
- Accesibilidad: keyboard nav, ARIA labels, contraste AA mínimo.
- Loading states explícitos, error states con CTA de retry.
- Confirmar acciones destructivas con `AlertDialog`.

---

## 8. Meta APIs (WhatsApp + Instagram)

- **Cada tenant conecta su propia cuenta** vía OAuth (Embedded Signup para WhatsApp).
- Tokens guardados en `channels.config` cifrados con `pgp_sym_encrypt` usando una clave en `process.env.META_TOKEN_KEY`.
- **Webhook único** por canal. Ruteo al tenant por `phone_number_id` (WhatsApp) o `ig_account_id` (Instagram).
- **Verificación de firma** obligatoria en todo webhook (`X-Hub-Signature-256`).
- **Templates de WhatsApp**: la plataforma sincroniza con Meta (crear, listar, status). No mandar mensajes fuera de ventana 24h sin template aprobado.
- **Rate limiting**: respetar tier del WABA. Cola con backoff exponencial en errores recuperables.
- **Opt-in registrado** explícitamente con timestamp e IP en `customers.opt_in_at`. No enviar marketing sin opt-in.

---

## 9. Seguridad

- Nunca loguear PII (teléfono, email, nombre completo) en cleartext. Usar hash o redactar.
- Secretos solo en `.env.local` y Vercel env. Nunca en código ni repo.
- Rate limit en `/capture/[slug]` (10 req/min por IP) y webhooks.
- CSRF: usar Server Actions (Next.js lo maneja).
- Headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin`.
- Cookies de sesión: `httpOnly`, `secure`, `sameSite=lax`.
- Validar **todo** input con zod, incluyendo webhooks.

---

## 10. Testing

- **Unit (Vitest)** obligatorio para toda lógica de negocio: motor de puntos,
  evaluador de audiences, runtime de flows, normalización de phone, cifrado
  de tokens, parsers de webhook, lógica de reservations.
- **Tests de RLS**: SQL que simula otro tenant y verifica que NO ve datos.
  Usar `set_config('request.jwt.claims', ...)` en tests.
- **Sin E2E (Playwright) en MVP** para acelerar entrega. Cada feature se
  valida con un **smoke manual documentado en su PR** (pasos exactos +
  resultado esperado + screenshots). Los happy paths que normalmente
  serían E2E quedan listados explícitamente en cada fase para retomarlos
  cuando se agregue Playwright post-MVP.
- CI: lint + typecheck + unit tests en cada PR.

---

## 11. Definition of Done

Una tarea está terminada cuando:

1. UI accesible y mobile-friendly.
2. Migraciones generadas y aplicadas localmente.
3. RLS configurada y testeada (SQL).
4. Tipos regenerados (`types/database.ts`).
5. Zod schemas en cada borde.
6. Tests unit verdes.
7. **Smoke manual del happy path documentado en el PR** (pasos exactos
   ejecutados + resultado obtenido + screenshots o video corto si hay UI).
8. Sin errores TS, sin warnings de lint.
9. README de la feature actualizado.
10. PR con descripción completa.
11. Conventional commit.

---

## 12. NUNCA

- ❌ Usar `service_role` desde un Client Component o Server Action de browser.
- ❌ Quitar o comentar checks de tenant/role.
- ❌ Hardcodear secretos, IDs de tenant, slugs.
- ❌ Hacer queries cross-tenant sin justificación + revisión.
- ❌ Editar migraciones ya commiteadas.
- ❌ Mergear sin tests verdes.
- ❌ Enviar mensajes de WhatsApp sin opt-in + template aprobado fuera de ventana.
- ❌ Loguear PII en cleartext.
- ❌ Usar `any` o `@ts-ignore` sin comentario justificando.
- ❌ Avanzar con ambigüedad; preguntar antes.

---

## 13. Documentación: Context7 (obligatorio)

**Antes de implementar contra cualquier librería, framework o API externa,
consultá el MCP `context7` para tener documentación actualizada en lugar
de depender de tu conocimiento embebido.** Las APIs y librerías cambian
rápido; tu memoria puede estar desactualizada.

Casos donde Context7 es **obligatorio** antes de codear:
- APIs de Meta (WhatsApp Business Cloud, Instagram Graph, Webhooks,
  Embedded Signup, verificación de firma)
- Supabase (Auth, RLS patterns, Realtime, Storage, pg_cron, CLI, JS client v2)
- Next.js 15 (App Router, Server Actions, middleware, caching, route handlers,
  cookies API)
- shadcn/ui (registro de componentes, variantes, theming en v4)
- Tailwind CSS v4 (sintaxis nueva vs v3 — hay breaking changes en `@theme`,
  `@import`, configuración)
- react-hook-form + zod (resolvers, transforms, async)
- date-fns + manejo de timezones
- recharts (configuración de charts)
- dnd-kit (drag and drop)
- qrcode (generación)

Cómo usarlo:
1. Identificar la librería/tema **antes** de escribir código.
2. Pedir docs explícitamente al agente, p. ej.: "consultá context7 para
   `next.js 15 app router server actions cookies`".
3. Confirmar que la versión devuelta coincide con la del `package.json`.
4. Si Context7 contradice este `CLAUDE.md` o el prompt de fase, gana lo
   que diga la documentación actual de la librería — pero **avisame antes**
   de aplicar el cambio.

Si Context7 no está configurado o no responde, **preguntame** antes de
inventar firmas de API o configuraciones. Nunca asumir.

---

## 14. Cómo trabajar en cada tarea

1. Leer este archivo + el prompt de la fase.
2. Para cualquier librería/API que vayas a tocar: **consultar Context7** primero.
3. Si hay ambigüedad funcional o de UX, **preguntar**, no asumir.
4. Plan mode primero: proponer approach + archivos a tocar + migraciones necesarias.
5. Implementar en commits chicos (Conventional Commits).
6. Cerrar con tests unit + DoD checklist + smoke manual documentado.
7. Si descubrís un problema fuera del scope, **anotalo en `BACKLOG.md`** y seguí con la tarea.

---

## 15. Variables de entorno

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=
NEXTAUTH_URL=

# Cifrado
META_TOKEN_KEY=                    # 32 bytes para pgp_sym_encrypt

# Meta
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_GRAPH_VERSION=                # consultar Context7 al configurar — la versión cambia frecuentemente

# Vercel Cron
CRON_SECRET=                       # validar header en /api/cron/*
```