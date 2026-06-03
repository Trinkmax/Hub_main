# Carta del comensal (drill-in) + Captura de datos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la carta del comensal a un modelo "elegí categoría primero" (drill-in con cards hero + imagen configurable, búsqueda global y carrusel de destacados) y sumar una captura de datos con bottom sheet en el primer escaneo + card en la confirmación de la primera orden, con copy configurable por el dueño.

**Architecture:** Branch `feat/carta-comensal-captura` (ya creada, spec commiteado). El comensal sigue siendo `anon` y consume todo vía el RPC `get_session_state` (SECURITY DEFINER) — se extiende para devolver `category.image_url` y un objeto `capture_prompt` leído de `tenants.settings`. El drill-in se implementa como estado de cliente dentro de un nuevo `MenuHub` que reemplaza a `MenuList` (sin rutas nuevas, preserva sesión/carrito/realtime). La persistencia del "No por ahora" es client-side en `localStorage` keyed por `sessionId`. El copy del banner vive en `tenants.settings.capture_prompt` y se gestiona desde un módulo `lib/capture-prompt/` + una sección nueva en `configuracion/bienvenida`.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), React 19 (`useActionState`/`useFormStatus`), TypeScript estricto, Supabase (Postgres + RPC SECURITY DEFINER + Storage `menu-images`), Tailwind v4 + shadcn new-york (`Sheet`, `Switch`, `Textarea`, `Input`, `Dialog`), Vitest (environment node), Biome.

**Reglas que NO se rompen (de CLAUDE.md):** RLS por `tenant_id`; el browser nunca usa `service_role`; cada Server Action valida owner; zod en cada borde; sin PII en logs; sin `any`/`@ts-ignore` sin justificar; Conventional Commits; tras migración correr `npm run db:types`.

---

## File Structure

**Migración / DB**
- Create: `supabase/migrations/<ts>_carta_category_image_and_capture_prompt.sql` — `alter table menu_categories add column image_url` + `create or replace function get_session_state` (suma `image_url` por categoría y `capture_prompt`).
- Modify (generado): `types/database.ts` — regenerado con `npm run db:types`.

**Lib (lógica pura + actions/queries — testeable)**
- Modify: `lib/m-session/actions.ts` — suma `image_url` por categoría y `capture_prompt` al tipo `ActiveSessionStateData`.
- Create: `lib/m-session/capture-dismissal.ts` — helper localStorage (Storage inyectable).
- Create: `lib/m-session/menu-search.ts` — `searchMenuItems(categories, query)` pura.
- Create: `lib/capture-prompt/schemas.ts` — zod + `DEFAULT_CAPTURE_PROMPT`.
- Create: `lib/capture-prompt/queries.ts` — `getCapturePromptConfig(tenantId)`.
- Create: `lib/capture-prompt/actions.ts` — `updateCapturePromptConfig` (owner).
- Modify: `lib/menu/schemas.ts` — `image_url` en create/update category.
- Modify: `lib/menu/queries.ts` — `image_url` en `MenuCategory` + selects.
- Modify: `lib/menu/actions.ts` — `createCategory`/`updateCategory` manejan `image_url`.

**Tests**
- Create: `tests/lib/capture-dismissal.test.ts`
- Create: `tests/lib/menu-search.test.ts`
- Create: `tests/lib/capture-prompt-schema.test.ts`
- Create: `tests/lib/menu-category-schema.test.ts`

**UI comensal (`app/m/[qrToken]/_components/`)**
- Create: `register-form.tsx` — `<form>` de registro extraído de `register-dialog.tsx`.
- Create: `capture-hero.tsx` — encabezado (headline/subtext) compartido.
- Create: `capture-sheet.tsx` — bottom sheet del primer escaneo.
- Create: `capture-prompt-card.tsx` — card embebida (post-orden).
- Create: `order-confirmation.tsx` — overlay "¡Pedido enviado!".
- Create: `item-row.tsx` — fila de ítem (extraída de `menu-list.tsx`).
- Create: `category-card.tsx` — card hero de categoría (con/sin imagen).
- Create: `recommended-carousel.tsx` — carrusel de destacados.
- Create: `menu-hub.tsx` — hub drill-in (búsqueda + carrusel + lista + detalle de categoría).
- Modify: `mesa-screen.tsx` — usa `MenuHub`, orquesta `CaptureSheet` (auto-open + dismissal) y `OrderConfirmation`.
- Delete: `menu-list.tsx` — reemplazado por `menu-hub.tsx` + `item-row.tsx`.
- Modify: `register-dialog.tsx` — eliminado (su form vive en `register-form.tsx`); se borra al desconectar el último consumer.

**UI owner**
- Modify: `app/(manager)/[tenantSlug]/menu/_components/category-edit-dialog.tsx` — uploader de imagen (+ prop `tenantId`).
- Modify: `app/(manager)/[tenantSlug]/menu/_components/new-category-form.tsx` — uploader de imagen (+ prop `tenantId`).
- Modify: `app/(manager)/[tenantSlug]/menu/_components/category-row.tsx` — pasa `tenantId` al edit dialog.
- Modify: `app/(manager)/[tenantSlug]/menu/page.tsx` — pasa `tenant.id` a los forms/rows.
- Create: `app/(manager)/[tenantSlug]/configuracion/bienvenida/_components/capture-prompt-form.tsx`.
- Modify: `app/(manager)/[tenantSlug]/configuracion/bienvenida/page.tsx` — suma sección de capture prompt.

---

## Phase 1 — DB & types

### Task 1: Migración — `menu_categories.image_url` + RPC `get_session_state`

**Files:**
- Create: `supabase/migrations/<timestamp>_carta_category_image_and_capture_prompt.sql`
- Modify (generado): `types/database.ts`

- [ ] **Step 1: Crear el archivo de migración vacío con timestamp correcto**

Run:
```bash
npx supabase migration new carta_category_image_and_capture_prompt
```
Esto crea `supabase/migrations/<timestamp>_carta_category_image_and_capture_prompt.sql`. Anotá el path exacto.

- [ ] **Step 2: Escribir la migración completa**

Pegá EXACTAMENTE este contenido en el archivo creado. La función reproduce la versión vigente (`20260527130200_get_session_state_merged.sql`) con 3 cambios marcados con `-- NUEVO`:

```sql
-- ============================================================
-- Carta category image + capture_prompt
-- ============================================================
-- 1) menu_categories.image_url (foto alusiva de la categoría).
-- 2) get_session_state: agrega image_url por categoría y un objeto
--    capture_prompt (enabled/headline/subtext) leído de tenants.settings,
--    servido al comensal anon vía SECURITY DEFINER.

alter table public.menu_categories
  add column if not exists image_url text
  check (image_url is null or char_length(image_url) <= 2048);

-- menu_categories ya tiene RLS + GRANTs (authenticated). Columna nueva: sin cambios de permisos.

create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_tenant_name text;
  v_tenant_logo_url text;
  v_tenant_settings jsonb;        -- NUEVO
  v_capture_prompt jsonb;         -- NUEVO
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int := 0;
  v_menu jsonb;
  v_my_tickets jsonb;
  v_welcome_reward jsonb;
  v_welcome_reward_redeemed jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null
     and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- NUEVO: leemos settings junto con name/logo.
  select name, logo_url, settings
    into v_tenant_name, v_tenant_logo_url, v_tenant_settings
    from public.tenants where id = v_table.tenant_id;

  -- NUEVO: capture_prompt con defaults si la key no existe.
  v_capture_prompt := jsonb_build_object(
    'enabled', coalesce((v_tenant_settings->'capture_prompt'->>'enabled')::boolean, true),
    'headline', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'headline', ''),
      'Sumá puntos en cada visita'),
    'subtext', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'subtext', ''),
      'Dejá tu nombre y teléfono y empezá a ganar beneficios.')
  );

  select jsonb_build_object(
    'enabled', wrc.enabled,
    'reward_id', r.id,
    'name', r.name,
    'description', r.description,
    'image_url', r.image_url,
    'headline', wrc.headline,
    'subtext', wrc.subtext
  )
  into v_welcome_reward
  from public.welcome_reward_configs wrc
  left join public.rewards r
    on r.id = wrc.reward_id
    and r.tenant_id = wrc.tenant_id
    and r.active = true
  where wrc.tenant_id = v_table.tenant_id
    and wrc.enabled = true
    and r.id is not null
    and (r.stock is null or r.stock > 0);

  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is null then
    return jsonb_build_object(
      'is_activated', false,
      'tenant_id', v_table.tenant_id,
      'tenant_name', v_tenant_name,
      'tenant_logo_url', v_tenant_logo_url,
      'physical_table_id', v_table.id,
      'table_label', v_table.label,
      'welcome_reward', v_welcome_reward
    );
  end if;

  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session.id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session.id;

  -- Carta agrupada por categoría. NUEVO: image_url por categoría.
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'image_url', mc.image_url,            -- NUEVO
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id,
        'name', mi.name,
        'description', mi.description,
        'price_cents', mi.price_cents,
        'image_url', mi.image_url,
        'position', mi.position,
        'featured', mi.featured,
        'points_override', mi.points_override,
        'tags', coalesce(
          (
            select jsonb_agg(jsonb_build_object(
              'id', it.id,
              'name', it.name,
              'color', it.color
            ) order by it.name)
            from public.menu_item_tag_assignments mita
            join public.item_tags it on it.id = mita.tag_id
            where mita.menu_item_id = mi.id
          ),
          '[]'::jsonb
        )
      ) order by mi.position) filter (where mi.id is not null and mi.active), '[]'::jsonb)
    ) as category
    from public.menu_categories mc
    left join public.menu_items mi
      on mi.category_id = mc.id and mi.tenant_id = v_table.tenant_id
    where mc.tenant_id = v_table.tenant_id and mc.active = true
    group by mc.id
  ) cats;

  if v_guest_id is not null then
    select coalesce(jsonb_agg(ticket order by ticket->>'submitted_at' desc), '[]'::jsonb)
    into v_my_tickets
    from (
      select jsonb_build_object(
        'id', t.id,
        'status', t.status,
        'submitted_at', t.submitted_at,
        'total_cents', t.total_cents,
        'cancellation_reason', t.cancellation_reason,
        'items', coalesce(jsonb_agg(jsonb_build_object(
          'id', ti.id,
          'menu_item_name', mi.name,
          'quantity', ti.quantity,
          'unit_price_cents', ti.unit_price_cents,
          'line_total_cents', ti.line_total_cents,
          'notes', ti.notes,
          'cancelled_at', ti.cancelled_at
        )), '[]'::jsonb)
      ) as ticket
      from public.tickets t
      left join public.ticket_items ti on ti.ticket_id = t.id
      left join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session.id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  if v_customer_id is not null then
    select jsonb_build_object(
      'reward_id', r.id,
      'name', r.name,
      'image_url', r.image_url,
      'redemption_id', wrg.redemption_id,
      'granted_at', wrg.granted_at,
      'status', rr.status
    )
    into v_welcome_reward_redeemed
    from public.welcome_reward_grants wrg
    join public.rewards r on r.id = wrg.reward_id
    join public.reward_redemptions rr on rr.id = wrg.redemption_id
    where wrg.customer_id = v_customer_id;
    v_welcome_reward := null;
  end if;

  return jsonb_build_object(
    'is_activated', true,
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'tenant_name', v_tenant_name,
    'tenant_logo_url', v_tenant_logo_url,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', false,
    'menu', v_menu,
    'my_tickets', v_my_tickets,
    'welcome_reward', v_welcome_reward,
    'welcome_reward_redeemed', v_welcome_reward_redeemed,
    'capture_prompt', v_capture_prompt   -- NUEVO
  );
end $$;
```

- [ ] **Step 3: Aplicar la migración localmente**

Run:
```bash
npm run db:reset
```
Expected: corre todas las migraciones + seed sin error. Buscá una línea de éxito final sin `ERROR`.

- [ ] **Step 4: Verificar la columna y el shape del RPC con SQL**

Run (vía Studio SQL o psql contra el Postgres local):
```sql
-- columna existe:
select column_name from information_schema.columns
  where table_name = 'menu_categories' and column_name = 'image_url';
-- el RPC compila y devuelve capture_prompt (usa un qr_token real del seed):
select (get_session_state((select qr_token from public.physical_tables limit 1), null))
       ? 'welcome_reward' as has_keys;
```
Expected: la primera query devuelve 1 fila (`image_url`); la segunda no tira error de función.

- [ ] **Step 5: Regenerar tipos**

Run:
```bash
npm run db:types
```
Expected: `types/database.ts` cambia — `menu_categories.Row` ahora incluye `image_url: string | null`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/ types/database.ts
git commit -m "feat(carta): migración image_url de categoría + capture_prompt en get_session_state"
```

---

## Phase 2 — Tipos compartidos + helpers puros (TDD)

### Task 2: Extender `ActiveSessionStateData`

**Files:**
- Modify: `lib/m-session/actions.ts:213-229` (menu), `:200-266` (tipo)

- [ ] **Step 1: Agregar `image_url` a cada categoría del `menu`**

En `lib/m-session/actions.ts`, dentro del tipo `ActiveSessionStateData`, cambiá el bloque `menu`:

```ts
  menu: Array<{
    id: string
    name: string
    position: number
    image_url: string | null
    items: Array<{
```
(solo se agrega la línea `image_url: string | null` después de `position: number`).

- [ ] **Step 2: Agregar `capture_prompt` al tipo**

En el mismo tipo `ActiveSessionStateData`, justo antes de `my_tickets:`, agregá:

```ts
  // Copy configurable del banner de captura (de tenants.settings). Siempre presente.
  capture_prompt: {
    enabled: boolean
    headline: string
    subtext: string
  }
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS (los componentes que consumen `menu` ya toleran el campo extra; `menu-list.tsx` sigue compilando).

- [ ] **Step 4: Commit**

```bash
git add lib/m-session/actions.ts
git commit -m "feat(carta): tipo ActiveSessionStateData con image_url de categoría + capture_prompt"
```

### Task 3: `capture-prompt/schemas.ts` (TDD)

**Files:**
- Create: `lib/capture-prompt/schemas.ts`
- Test: `tests/lib/capture-prompt-schema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/capture-prompt-schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_PROMPT,
  capturePromptConfigSchema,
} from '@/lib/capture-prompt/schemas'

describe('capturePromptConfigSchema', () => {
  it('acepta una config válida', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: true,
      headline: 'Sumá puntos',
      subtext: 'Dejá tus datos',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza headline vacío', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: true,
      headline: '',
      subtext: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza headline > 80 chars', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: false,
      headline: 'a'.repeat(81),
      subtext: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('coerce de enabled "on" a true', () => {
    const r = capturePromptConfigSchema.safeParse({
      enabled: 'on',
      headline: 'h',
      subtext: 's',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.enabled).toBe(true)
  })

  it('el default tiene copy no vacío', () => {
    expect(DEFAULT_CAPTURE_PROMPT.headline.length).toBeGreaterThan(0)
    expect(DEFAULT_CAPTURE_PROMPT.subtext.length).toBeGreaterThan(0)
    expect(DEFAULT_CAPTURE_PROMPT.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/capture-prompt-schema.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/capture-prompt/schemas'`.

- [ ] **Step 3: Implementar el schema**

Create `lib/capture-prompt/schemas.ts`:
```ts
import { z } from 'zod'

export const capturePromptConfigSchema = z.object({
  enabled: z.coerce.boolean().default(true),
  headline: z.string().trim().min(1, 'Título requerido').max(80, 'Máximo 80'),
  subtext: z.string().trim().min(1, 'Subtítulo requerido').max(160, 'Máximo 160'),
})

export type CapturePromptConfig = z.infer<typeof capturePromptConfigSchema>

export const DEFAULT_CAPTURE_PROMPT: CapturePromptConfig = {
  enabled: true,
  headline: 'Sumá puntos en cada visita',
  subtext: 'Dejá tu nombre y teléfono y empezá a ganar beneficios.',
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/capture-prompt-schema.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture-prompt/schemas.ts tests/lib/capture-prompt-schema.test.ts
git commit -m "feat(captura): zod schema + default de capture_prompt config"
```

### Task 4: `capture-dismissal.ts` (TDD)

**Files:**
- Create: `lib/m-session/capture-dismissal.ts`
- Test: `tests/lib/capture-dismissal.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/capture-dismissal.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  captureKey,
  isCaptureSeen,
  markCaptureSeen,
} from '@/lib/m-session/capture-dismissal'

function fakeStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
  }
}

describe('capture-dismissal', () => {
  it('genera keys distintas por momento y sesión', () => {
    expect(captureKey('sheet', 's1')).toBe('hub:capture:sheet:s1')
    expect(captureKey('postorder', 's1')).toBe('hub:capture:postorder:s1')
    expect(captureKey('sheet', 's2')).not.toBe(captureKey('sheet', 's1'))
  })

  it('isCaptureSeen es false antes de marcar', () => {
    const store = fakeStore()
    expect(isCaptureSeen('sheet', 's1', store)).toBe(false)
  })

  it('markCaptureSeen luego isCaptureSeen es true', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('sheet', 's1', store)).toBe(true)
  })

  it('los momentos son independientes', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('postorder', 's1', store)).toBe(false)
  })

  it('las sesiones son independientes', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('sheet', 's2', store)).toBe(false)
  })

  it('sessionId vacío es no-op seguro', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', '', store)
    expect(isCaptureSeen('sheet', '', store)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/capture-dismissal.test.ts
```
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el helper**

Create `lib/m-session/capture-dismissal.ts`:
```ts
'use client'

// Persistencia client-side del "No por ahora". Keyed por sessionId: una sesión
// nueva (nuevo session_id) vuelve a invitar. Storage inyectable para tests.

const PREFIX = 'hub:capture'

export type CaptureMoment = 'sheet' | 'postorder'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function captureKey(moment: CaptureMoment, sessionId: string): string {
  return `${PREFIX}:${moment}:${sessionId}`
}

function resolveStore(store?: StorageLike): StorageLike | null {
  if (store) return store
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function isCaptureSeen(
  moment: CaptureMoment,
  sessionId: string,
  store?: StorageLike,
): boolean {
  const s = resolveStore(store)
  if (!s || !sessionId) return false
  try {
    return s.getItem(captureKey(moment, sessionId)) === '1'
  } catch {
    return false
  }
}

export function markCaptureSeen(
  moment: CaptureMoment,
  sessionId: string,
  store?: StorageLike,
): void {
  const s = resolveStore(store)
  if (!s || !sessionId) return
  try {
    s.setItem(captureKey(moment, sessionId), '1')
  } catch {
    // localStorage lleno o deshabilitado (modo privado) → degradar a no-op.
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/capture-dismissal.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/m-session/capture-dismissal.ts tests/lib/capture-dismissal.test.ts
git commit -m "feat(captura): helper de dismissal por sesión (localStorage inyectable)"
```

### Task 5: `menu-search.ts` pura (TDD)

**Files:**
- Create: `lib/m-session/menu-search.ts`
- Test: `tests/lib/menu-search.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/menu-search.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { searchMenuItems } from '@/lib/m-session/menu-search'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

function item(partial: Partial<Item> & { id: string; name: string }): Item {
  return {
    description: null,
    price_cents: 1000,
    image_url: null,
    position: 0,
    featured: false,
    points_override: null,
    tags: [],
    ...partial,
  }
}

function cat(id: string, items: Item[]): Category {
  return { id, name: id, position: 0, image_url: null, items }
}

const MENU: Category[] = [
  cat('cafe', [item({ id: '1', name: 'Flat White' }), item({ id: '2', name: 'Cortado' })]),
  cat('comer', [
    item({ id: '3', name: 'Hamburguesa', description: 'con cheddar' }),
    item({ id: '4', name: 'Milanesa' }),
  ]),
]

describe('searchMenuItems', () => {
  it('devuelve [] con query vacía', () => {
    expect(searchMenuItems(MENU, '')).toEqual([])
    expect(searchMenuItems(MENU, '   ')).toEqual([])
  })

  it('matchea por nombre, case-insensitive, a través de categorías', () => {
    const r = searchMenuItems(MENU, 'mila')
    expect(r.map((i) => i.id)).toEqual(['4'])
  })

  it('matchea por descripción', () => {
    const r = searchMenuItems(MENU, 'cheddar')
    expect(r.map((i) => i.id)).toEqual(['3'])
  })

  it('devuelve varios resultados aplanados', () => {
    const r = searchMenuItems(MENU, 'a')
    expect(r.length).toBeGreaterThan(1)
  })

  it('sin matches devuelve []', () => {
    expect(searchMenuItems(MENU, 'zzz')).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/menu-search.test.ts
```
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar la búsqueda**

Create `lib/m-session/menu-search.ts`:
```ts
import type { ActiveSessionStateData } from './actions'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

/** Búsqueda plana sobre toda la carta: nombre + descripción, accent-tolerant simple. */
export function searchMenuItems(categories: Category[], query: string): Item[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []
  const out: Item[] = []
  for (const cat of categories) {
    for (const it of cat.items) {
      const haystack = `${it.name} ${it.description ?? ''}`.toLowerCase()
      if (haystack.includes(q)) out.push(it)
    }
  }
  return out
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/menu-search.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/m-session/menu-search.ts tests/lib/menu-search.test.ts
git commit -m "feat(carta): búsqueda global plana de ítems (pura, testeable)"
```

---

## Phase 3 — Owner: imágenes de categoría

### Task 6: Schemas de categoría con `image_url` (TDD)

**Files:**
- Modify: `lib/menu/schemas.ts:3-11`
- Test: `tests/lib/menu-category-schema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/menu-category-schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createCategorySchema, updateCategorySchema } from '@/lib/menu/schemas'

describe('createCategorySchema con image_url', () => {
  it('acepta sin image_url (=> null)', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).toBeNull()
  })

  it('normaliza string vacío a null', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres', image_url: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).toBeNull()
  })

  it('acepta una URL válida', () => {
    const r = createCategorySchema.safeParse({
      name: 'Postres',
      image_url: 'https://x.supabase.co/storage/v1/object/public/menu-images/t/abc.webp',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).not.toBeNull()
  })

  it('rechaza una URL no-URL', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres', image_url: 'no-es-url' })
    expect(r.success).toBe(false)
  })
})

describe('updateCategorySchema con image_url', () => {
  it('acepta payload completo', () => {
    const r = updateCategorySchema.safeParse({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Postres',
      active: true,
      image_url: null,
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/menu-category-schema.test.ts
```
Expected: FAIL — `image_url` no existe / no se normaliza.

- [ ] **Step 3: Extender los schemas**

En `lib/menu/schemas.ts`, reemplazá `createCategorySchema` y `updateCategorySchema`:
```ts
const categoryImageUrl = z
  .union([z.string().trim().url().max(2048), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v && v.length > 0 ? v : null))

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60, 'Máximo 60'),
  image_url: categoryImageUrl,
})

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  active: z.coerce.boolean(),
  image_url: categoryImageUrl,
})
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/menu-category-schema.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/schemas.ts tests/lib/menu-category-schema.test.ts
git commit -m "feat(menu): image_url en schemas de categoría"
```

### Task 7: `MenuCategory` query con `image_url`

**Files:**
- Modify: `lib/menu/queries.ts:5-10, 44-47, 87, 98-103, 141`

- [ ] **Step 1: Agregar `image_url` al tipo `MenuCategory`**

En `lib/menu/queries.ts`, en el tipo `MenuCategory`:
```ts
export type MenuCategory = {
  id: string
  name: string
  position: number
  active: boolean
  image_url: string | null
}
```

- [ ] **Step 2: Sumar `image_url` a los dos selects de categorías**

En `listMenu` y `listActiveMenu`, cambiá los dos `.select('id, name, position, active')` de `menu_categories` por:
```ts
.select('id, name, position, active, image_url')
```
(hay uno en cada función — total 2 ocurrencias).

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS (`image_url` ya existe en `database.ts` por Task 1; el cast `as MenuCategory[]` ahora incluye el campo).

- [ ] **Step 4: Commit**

```bash
git add lib/menu/queries.ts
git commit -m "feat(menu): servir image_url de categoría en listMenu/listActiveMenu"
```

### Task 8: Actions `createCategory` / `updateCategory` con `image_url`

**Files:**
- Modify: `lib/menu/actions.ts:69-135`

- [ ] **Step 1: `createCategory` lee y persiste `image_url`**

En `createCategory`, cambiá el `safeParse` y el `insert`:
```ts
  const parsed = createCategorySchema.safeParse({
    name: formData.get('name'),
    image_url: formData.get('image_url'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: maxPos } = await supabase
    .from('menu_categories')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: created, error } = await supabase
    .from('menu_categories')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      image_url: parsed.data.image_url,
      position: (maxPos?.position ?? 0) + 1,
    })
    .select('id')
    .single()
```

- [ ] **Step 2: `updateCategory` acepta `image_url` en el payload**

Cambiá la firma y el cuerpo de `updateCategory`:
```ts
export async function updateCategory(
  slug: string,
  payload: { id: string; name: string; active: boolean; image_url: string | null },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateCategorySchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('menu_categories')
    .update({
      name: parsed.data.name,
      active: parsed.data.active,
      image_url: parsed.data.image_url,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: FAIL en 2 lugares que llaman `updateCategory` sin `image_url`: `category-edit-dialog.tsx` (`onSave`) y `menu-board.tsx` (`onToggleCat`). Se arreglan en Task 9. Confirmá que los errores son solo esos.

- [ ] **Step 4: Commit**

```bash
git add lib/menu/actions.ts
git commit -m "feat(menu): createCategory/updateCategory persisten image_url"
```

### Task 9: UI owner — uploader de imagen en categorías

**Files:**
- Modify: `app/(manager)/[tenantSlug]/menu/_components/category-edit-dialog.tsx`
- Modify: `app/(manager)/[tenantSlug]/menu/_components/new-category-form.tsx`
- Modify: `app/(manager)/[tenantSlug]/menu/_components/menu-board.tsx` (render del `CategoryEditDialog` + `onToggleCat`)
- Modify: `app/(manager)/[tenantSlug]/menu/page.tsx`

> Contexto verificado: `CategoryEditDialog` se renderiza dentro de `SortableCategory` en `menu-board.tsx` (no en `category-row.tsx`). `SortableCategory`/`MenuBoard` ya reciben `tenantId`. `CategoryRow` ya recibe `tenantId`. La page pasa `tenantId` a `MenuBoard` pero **no** a `NewCategoryForm` (2 renders).

- [ ] **Step 1: `CategoryEditDialog` con uploader (+ prop `tenantId`)**

Reemplazá `category-edit-dialog.tsx` por:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateCategory } from '@/lib/menu/actions'
import type { MenuCategory } from '@/lib/menu/queries'
import { MenuImageUploader } from './image-uploader'

export function CategoryEditDialog({
  category,
  tenantId,
  tenantSlug,
  onClose,
}: {
  category: MenuCategory
  tenantId: string
  tenantSlug: string
  onClose: () => void
}) {
  const [name, setName] = useState(category.name)
  const [imageUrl, setImageUrl] = useState<string | null>(category.image_url)
  const [pending, start] = useTransition()

  const onSave = () => {
    start(async () => {
      const r = await updateCategory(tenantSlug, {
        id: category.id,
        name,
        active: category.active,
        image_url: imageUrl,
      })
      if (r.ok) {
        toast.success('Guardado.')
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar categoría</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cat-edit-name">Nombre</Label>
            <Input
              id="cat-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <MenuImageUploader
            tenantId={tenantId}
            value={imageUrl}
            onChange={setImageUrl}
            label="Foto de la categoría"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending || name.trim().length === 0}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `NewCategoryForm` con uploader (+ prop `tenantId`)**

Reemplazá `new-category-form.tsx` por:
```tsx
'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCategory, type MenuActionState } from '@/lib/menu/actions'
import { MenuImageUploader } from './image-uploader'

const initial: MenuActionState = { ok: true }

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear categoría'}
    </Button>
  )
}

export function NewCategoryForm({
  tenantId,
  tenantSlug,
}: {
  tenantId: string
  tenantSlug: string
}) {
  const action = createCategory.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setImageUrl(null)
    } else if (!state.ok) toast.error(state.message)
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="grid gap-3">
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          name="name"
          required
          maxLength={60}
          placeholder="Tragos, Comida, Postres…"
          className="flex-1"
        />
        <SubmitBtn />
      </div>
      <MenuImageUploader
        tenantId={tenantId}
        value={imageUrl}
        onChange={setImageUrl}
        label="Foto de la categoría (opcional)"
      />
    </form>
  )
}
```

- [ ] **Step 3: `menu-board.tsx` — `tenantId` al dialog + `image_url` en `onToggleCat`**

En `menu-board.tsx`, dentro de `SortableCategory`:

(a) En `onToggleCat`, agregá `image_url` al payload de `updateCategory`:
```tsx
      const r = await updateCategory(tenantSlug, {
        id: category.id,
        name: category.name,
        active: !category.active,
        image_url: category.image_url,
      })
```

(b) Pasá `tenantId` al `CategoryEditDialog` (el `tenantId` ya está en las props de `SortableCategory`):
```tsx
      {editingCat ? (
        <CategoryEditDialog
          category={category}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          onClose={() => setEditingCat(false)}
        />
      ) : null}
```

- [ ] **Step 4: `page.tsx` — `tenantId` a los dos `NewCategoryForm`**

En `app/(manager)/[tenantSlug]/menu/page.tsx` hay **dos** renders de `<NewCategoryForm tenantSlug={tenantSlug} />` (≈ líneas 98 y 122). Cambiá ambos a:
```tsx
<NewCategoryForm tenantId={access.tenant.id} tenantSlug={tenantSlug} />
```
(`MenuBoard` ya recibe `tenantId={access.tenant.id}` — no se toca.)

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS (el error de Task 8 Step 3 ya está resuelto).

- [ ] **Step 6: Smoke manual rápido**

Run `npm run dev`, entrá a `/{slug}/menu` como owner: editá una categoría, subí una foto, guardá; recargá y verificá que persiste. Creá una categoría nueva con foto.

- [ ] **Step 7: Commit**

```bash
git add "app/(manager)/[tenantSlug]/menu"
git commit -m "feat(menu): uploader de imagen en alta/edición de categoría"
```

---

## Phase 4 — Owner: config del copy del banner

### Task 10: `capture-prompt/queries.ts` + `actions.ts`

**Files:**
- Create: `lib/capture-prompt/queries.ts`
- Create: `lib/capture-prompt/actions.ts`

- [ ] **Step 1: Query de lectura (settings → config con defaults)**

Create `lib/capture-prompt/queries.ts`:
```ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  type CapturePromptConfig,
  capturePromptConfigSchema,
  DEFAULT_CAPTURE_PROMPT,
} from './schemas'

export async function getCapturePromptConfig(tenantId: string): Promise<CapturePromptConfig> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle()
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  const parsed = capturePromptConfigSchema.safeParse(settings.capture_prompt)
  return parsed.success ? parsed.data : DEFAULT_CAPTURE_PROMPT
}
```

- [ ] **Step 2: Action de escritura (owner, read-modify-write de settings)**

Create `lib/capture-prompt/actions.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { capturePromptConfigSchema } from './schemas'

export type CapturePromptState =
  | { ok: true; message?: string }
  | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return tenant
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

export async function updateCapturePromptConfig(
  slug: string,
  _prev: CapturePromptState,
  formData: FormData,
): Promise<CapturePromptState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = capturePromptConfigSchema.safeParse({
    enabled: formData.get('enabled') === 'on',
    headline: formData.get('headline'),
    subtext: formData.get('subtext'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  // Read-modify-write del jsonb settings (config owner-only, baja frecuencia).
  const { data: current } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenant.id)
    .maybeSingle()
  const settings = (current?.settings ?? {}) as Record<string, unknown>
  const nextSettings = { ...settings, capture_prompt: parsed.data }

  const { error } = await supabase
    .from('tenants')
    .update({ settings: nextSettings })
    .eq('id', tenant.id)
  if (error) {
    console.error('[capture-prompt.update]', error.message)
    return { ok: false, message: 'No se pudo guardar.' }
  }
  revalidatePath(`/${slug}/configuracion/bienvenida`)
  return { ok: true, message: 'Guardado.' }
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/capture-prompt/queries.ts lib/capture-prompt/actions.ts
git commit -m "feat(captura): queries/actions de capture_prompt sobre tenants.settings"
```

### Task 11: UI owner — form del copy en `bienvenida`

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/bienvenida/_components/capture-prompt-form.tsx`
- Modify: `app/(manager)/[tenantSlug]/configuracion/bienvenida/page.tsx`

- [ ] **Step 1: Form del capture prompt**

Create `capture-prompt-form.tsx`:
```tsx
'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type CapturePromptState,
  updateCapturePromptConfig,
} from '@/lib/capture-prompt/actions'
import type { CapturePromptConfig } from '@/lib/capture-prompt/schemas'

const initial: CapturePromptState = { ok: false, message: '' }

export function CapturePromptForm({
  tenantSlug,
  config,
}: {
  tenantSlug: string
  config: CapturePromptConfig
}) {
  const [state, action, pending] = useActionState(
    (prev: CapturePromptState, fd: FormData) => updateCapturePromptConfig(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok && state.message) toast.error(state.message)
  }, [state])

  return (
    <form action={action} className="max-w-2xl space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-display text-base font-semibold">Invitación a registrarse</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          El gancho que ve el comensal en el primer escaneo (bottom sheet) y al confirmar su
          primera orden. Si lo desactivás, no se muestra ninguna invitación automática.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="enabled" name="enabled" defaultChecked={config.enabled} />
        <Label htmlFor="enabled">Mostrar la invitación de captura</Label>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="headline">Título</Label>
        <Input
          id="headline"
          name="headline"
          maxLength={80}
          required
          defaultValue={config.headline}
          placeholder="Sumá puntos en cada visita"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="subtext">Subtítulo</Label>
        <Textarea
          id="subtext"
          name="subtext"
          maxLength={160}
          required
          defaultValue={config.subtext}
          placeholder="Dejá tu nombre y teléfono y empezá a ganar beneficios."
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}
```

> Nota: el `Switch` de shadcn no envía valor en FormData cuando está off; el action lee `formData.get('enabled') === 'on'`. shadcn `Switch` con `name` emite `value="on"` cuando está checked (igual que un checkbox). Verificá en Step 3; si el `Switch` instalado no soporta `name`, reemplazalo por `Checkbox` (mismo patrón que `auto-accept-form.tsx`).

- [ ] **Step 2: Sumar la sección a la page `bienvenida`**

En `app/(manager)/[tenantSlug]/configuracion/bienvenida/page.tsx`:
1. Importá al tope:
```ts
import { getCapturePromptConfig } from '@/lib/capture-prompt/queries'
import { CapturePromptForm } from './_components/capture-prompt-form'
```
2. En el `Promise.all` de carga, sumá la config:
```ts
  const [config, rewards, capturePrompt] = await Promise.all([
    getWelcomeRewardConfig(access.tenant.id),
    listActiveRewards({ tenantId: access.tenant.id }),
    getCapturePromptConfig(access.tenant.id),
  ])
```
3. Antes del cierre del `<main>` (después del bloque del welcome reward), agregá:
```tsx
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight">Captura de datos</h2>
        <CapturePromptForm tenantSlug={tenantSlug} config={capturePrompt} />
      </section>
```

- [ ] **Step 3: Verificar el `Switch` + typecheck + smoke**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. Luego `npm run dev`, entrá a `/{slug}/configuracion/bienvenida`, cambiá título/subtítulo, guardá, recargá y verificá persistencia. Confirmá que el toggle persiste (si no, cambiá `Switch`→`Checkbox`).

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/bienvenida"
git commit -m "feat(captura): config del copy del banner en configuración/bienvenida"
```

---

## Phase 5 — Comensal: form compartido + sheet + card post-orden

### Task 12: Extraer `RegisterForm` + `CaptureHero`

**Files:**
- Create: `app/m/[qrToken]/_components/register-form.tsx`
- Create: `app/m/[qrToken]/_components/capture-hero.tsx`

- [ ] **Step 1: `CaptureHero` (encabezado compartido)**

Create `capture-hero.tsx`:
```tsx
import { Gift } from 'lucide-react'

export function CaptureHero({ headline, subtext }: { headline: string; subtext: string }) {
  return (
    <div className="relative overflow-hidden rounded-t-2xl bg-app-gradient px-6 pt-6 pb-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[--forest-glow] blur-2xl"
      />
      <div className="relative">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <Gift className="size-6" />
        </div>
        <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
          {headline}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{subtext}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `RegisterForm` (form extraído de `register-dialog.tsx`)**

Create `register-form.tsx` (es el `<form>` de `register-dialog.tsx` líneas 118-273, sin el `<Dialog>`/hero, con `onDismiss` para el botón secundario):
```tsx
'use client'

import { Calendar, User } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type RegisterCustomerResult, registerCustomer } from '@/lib/m-session/actions'

const initial: RegisterCustomerResult = { ok: false, message: '' }

export function RegisterForm({
  qrToken,
  browserToken,
  tenantName,
  submitLabel,
  dismissLabel = 'No por ahora',
  onDismiss,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  submitLabel: string
  dismissLabel?: string
  onDismiss: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  const [state, action, pending] = useActionState(
    (_prev: RegisterCustomerResult, fd: FormData) => registerCustomer(fd),
    initial,
  )
  const [phone, setPhone] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.ok) onRegistered(state)
  }, [state, onRegistered])

  return (
    <form action={action} className="space-y-4 px-6 pt-5 pb-6">
      <input type="hidden" name="qr_token" value={qrToken} />
      <input type="hidden" name="browser_token" value={browserToken} />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />

      <div className="space-y-1.5">
        <Label
          htmlFor="first_name"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Nombre
        </Label>
        <div className="relative">
          <User
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="first_name"
            name="first_name"
            required
            maxLength={60}
            autoComplete="given-name"
            className="h-12 rounded-xl pl-9 text-base"
            placeholder="Juan"
          />
        </div>
        {!state.ok && state.fieldErrors?.first_name && (
          <p className="text-xs text-destructive">{state.fieldErrors.first_name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="last_name"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Apellido
        </Label>
        <Input
          id="last_name"
          name="last_name"
          required
          maxLength={60}
          autoComplete="family-name"
          className="h-12 rounded-xl text-base"
          placeholder="Pérez"
        />
        {!state.ok && state.fieldErrors?.last_name && (
          <p className="text-xs text-destructive">{state.fieldErrors.last_name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="phone-input"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Teléfono
        </Label>
        <PhoneInput
          id="phone-input"
          name="phone"
          international
          defaultCountry="AR"
          value={phone}
          onChange={setPhone}
          placeholder="11 4567 8901"
          className="hub-phone-input"
          aria-required="true"
        />
        <p className="text-[11px] text-muted-foreground">Tocá la bandera si sos de otro país.</p>
        {!state.ok && state.fieldErrors?.phone && (
          <p className="text-xs text-destructive">{state.fieldErrors.phone}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="birthdate"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Cumpleaños{' '}
          <span className="font-normal normal-case text-muted-foreground/60">(opcional)</span>
        </Label>
        <div className="relative">
          <Calendar
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="birthdate"
            name="birthdate"
            type="date"
            className="h-12 rounded-xl pl-9 text-base"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Para mandarte un regalo en tu día.</p>
      </div>

      <label
        htmlFor="opt_in_marketing"
        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 p-3"
      >
        <Checkbox id="opt_in_marketing" name="opt_in_marketing" defaultChecked className="mt-0.5" />
        <span className="text-xs leading-snug text-muted-foreground">
          Quiero recibir novedades y promos por WhatsApp.
          <br />
          <span className="text-[10px] opacity-70">Podés darte de baja en cualquier momento.</span>
        </span>
      </label>

      {!state.ok && state.message && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDismiss} className="sm:flex-none">
          {dismissLabel}
        </Button>
        <Button type="submit" disabled={pending} size="xl" className="rounded-xl font-semibold sm:flex-1">
          {pending ? 'Guardando…' : submitLabel}
        </Button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        Tus datos quedan únicamente con {tenantName}. No se comparten.
      </p>
    </form>
  )
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS (componentes nuevos, sin consumers todavía).

- [ ] **Step 4: Commit**

```bash
git add "app/m/[qrToken]/_components/register-form.tsx" "app/m/[qrToken]/_components/capture-hero.tsx"
git commit -m "feat(captura): RegisterForm + CaptureHero compartidos"
```

### Task 13: `CaptureSheet` (bottom sheet)

**Files:**
- Create: `app/m/[qrToken]/_components/capture-sheet.tsx`

- [ ] **Step 1: Implementar el sheet**

Create `capture-sheet.tsx`:
```tsx
'use client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { RegisterCustomerResult } from '@/lib/m-session/actions'
import { CaptureHero } from './capture-hero'
import { RegisterForm } from './register-form'

export function CaptureSheet({
  qrToken,
  browserToken,
  tenantName,
  headline,
  subtext,
  onClose,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  headline: string
  subtext: string
  onClose: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:max-w-md sm:mx-auto"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{headline}</SheetTitle>
        </SheetHeader>
        <CaptureHero headline={headline} subtext={subtext} />
        <RegisterForm
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          submitLabel="Quiero sumar"
          onDismiss={onClose}
          onRegistered={onRegistered}
        />
      </SheetContent>
    </Sheet>
  )
}
```

> Verificá los exports reales de `@/components/ui/sheet` (shadcn new-york exporta `Sheet, SheetContent, SheetHeader, SheetTitle`). Si `side="bottom"` no está soportado por la variante instalada, abrí `components/ui/sheet.tsx` y confirmá la prop `side`.

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/m/[qrToken]/_components/capture-sheet.tsx"
git commit -m "feat(captura): CaptureSheet (bottom sheet del primer escaneo)"
```

### Task 14: `CapturePromptCard` + `OrderConfirmation`

**Files:**
- Create: `app/m/[qrToken]/_components/capture-prompt-card.tsx`
- Create: `app/m/[qrToken]/_components/order-confirmation.tsx`

- [ ] **Step 1: `CapturePromptCard` (card embebida con form)**

Create `capture-prompt-card.tsx`:
```tsx
'use client'

import type { RegisterCustomerResult } from '@/lib/m-session/actions'
import { CaptureHero } from './capture-hero'
import { RegisterForm } from './register-form'

export function CapturePromptCard({
  qrToken,
  browserToken,
  tenantName,
  headline,
  subtext,
  onDismiss,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  headline: string
  subtext: string
  onDismiss: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  return (
    <div className="card-hairline overflow-hidden rounded-2xl border border-border/60 bg-card shadow-md">
      <CaptureHero headline={headline} subtext={subtext} />
      <RegisterForm
        qrToken={qrToken}
        browserToken={browserToken}
        tenantName={tenantName}
        submitLabel="Sumar mis puntos"
        onDismiss={onDismiss}
        onRegistered={onRegistered}
      />
    </div>
  )
}
```

- [ ] **Step 2: `OrderConfirmation` (overlay "¡Pedido enviado!")**

Create `order-confirmation.tsx`:
```tsx
'use client'

import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function OrderConfirmation({
  children,
  onClose,
}: {
  children?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-app-gradient">
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center px-4 py-10">
        <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="mt-4 text-center font-serif text-2xl font-semibold tracking-tight">
          ¡Pedido enviado!
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          El mozo lo va a confirmar en un momento.
        </p>

        {children && <div className="mt-6 w-full">{children}</div>}

        <Button variant="outline" onClick={onClose} className="mt-6 h-12 w-full rounded-xl">
          Seguir pidiendo
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add "app/m/[qrToken]/_components/capture-prompt-card.tsx" "app/m/[qrToken]/_components/order-confirmation.tsx"
git commit -m "feat(captura): CapturePromptCard + OrderConfirmation (post-orden)"
```

### Task 15: Cablear captura en `mesa-screen.tsx`

**Files:**
- Modify: `app/m/[qrToken]/_components/mesa-screen.tsx`

- [ ] **Step 1: Imports y nuevos estados**

En `mesa-screen.tsx`, reemplazá el import de `RegisterDialog`:
```ts
// borrar: import { RegisterDialog } from './register-dialog'
import { CaptureSheet } from './capture-sheet'
import { CapturePromptCard } from './capture-prompt-card'
import { OrderConfirmation } from './order-confirmation'
import { isCaptureSeen, markCaptureSeen } from '@/lib/m-session/capture-dismissal'
```
Agregá estados (junto a los otros `useState`):
```ts
  const [showOrderConfirm, setShowOrderConfirm] = useState(false)
  const autoSheetTriedRef = useRef(false)
```

- [ ] **Step 2: Efecto de auto-open del sheet en el primer escaneo**

Después del efecto de realtime (`useEffect(... [state, browserToken, qrToken])`), agregá:
```ts
  // Auto-abrir el sheet de captura una sola vez por sesión, si aplica.
  useEffect(() => {
    if (!state || autoSheetTriedRef.current) return
    autoSheetTriedRef.current = true
    if (
      !state.customer_id &&
      state.capture_prompt?.enabled &&
      !isCaptureSeen('sheet', state.session_id)
    ) {
      setShowRegister(true)
    }
  }, [state])
```

- [ ] **Step 3: `onSubmitted` del carrito dispara la confirmación + card post-orden**

Reemplazá el `onSubmitted` del `<CartSheet ...>`:
```tsx
          onSubmitted={() => {
            setCart([])
            setShowCart(false)
            const sid = state?.session_id
            if (
              state &&
              !state.customer_id &&
              state.capture_prompt?.enabled &&
              sid &&
              !isCaptureSeen('postorder', sid)
            ) {
              markCaptureSeen('postorder', sid)
              setShowOrderConfirm(true)
            } else {
              toast.success('Pedido enviado. Esperando confirmación del mozo.')
            }
            void refreshAfterSubmit()
          }}
```

- [ ] **Step 4: Reemplazar `RegisterDialog` por `CaptureSheet`**

Reemplazá el bloque `{state && showRegister && browserToken && (<RegisterDialog .../>)}` por:
```tsx
      {state && showRegister && browserToken && (
        <CaptureSheet
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          headline={state.capture_prompt.headline}
          subtext={state.capture_prompt.subtext}
          onClose={() => {
            setShowRegister(false)
            if (state.session_id) markCaptureSeen('sheet', state.session_id)
          }}
          onRegistered={handleRegistered}
        />
      )}
```

- [ ] **Step 5: Render del overlay de confirmación con la card post-orden**

Antes del cierre del componente (después del bloque del `CartSheet`), agregá:
```tsx
      {showOrderConfirm && state && browserToken && (
        <OrderConfirmation onClose={() => setShowOrderConfirm(false)}>
          {!state.customer_id && state.capture_prompt?.enabled ? (
            <CapturePromptCard
              qrToken={qrToken}
              browserToken={browserToken}
              tenantName={tenantName}
              headline={state.capture_prompt.headline}
              subtext={state.capture_prompt.subtext}
              onDismiss={() => setShowOrderConfirm(false)}
              onRegistered={(r) => {
                handleRegistered(r)
                setShowOrderConfirm(false)
              }}
            />
          ) : null}
        </OrderConfirmation>
      )}
```

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. (`register-dialog.tsx` queda sin consumers; se borra en Step 8.)

- [ ] **Step 7: Smoke manual**

Con una mesa activada localmente: escaneá `/m/<qrToken>` en un browser nuevo (localStorage limpio) → debe subir el bottom sheet con el copy del tenant → "No por ahora" cierra y deja ordenar → agregá ítems y enviá orden → aparece "¡Pedido enviado!" con la card de captura → recargá (misma sesión): el sheet NO reaparece.

- [ ] **Step 8: Borrar `register-dialog.tsx`**

Run:
```bash
git rm "app/m/[qrToken]/_components/register-dialog.tsx"
npm run typecheck
```
Expected: PASS (ya nadie lo importa).

- [ ] **Step 9: Commit**

```bash
git add "app/m/[qrToken]/_components/mesa-screen.tsx"
git commit -m "feat(captura): bottom sheet en primer escaneo + card post-orden en mesa-screen"
```

---

## Phase 6 — Comensal: carta drill-in

### Task 16: `ItemRow` (fila de ítem reutilizable)

**Files:**
- Create: `app/m/[qrToken]/_components/item-row.tsx`

- [ ] **Step 1: Extraer la fila de ítem de `menu-list.tsx`**

Create `item-row.tsx` (extrae el `<button>` de ítem de `menu-list.tsx` líneas 317-392 + helpers `ARSFormat` y `pickContrastText`):
```tsx
'use client'

import { ChevronRight, ImageOff, Star } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { cn } from '@/lib/utils'

type Item = ActiveSessionStateData['menu'][number]['items'][number]

export function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/** Texto claro u oscuro según luminancia del color hex del tag (YIQ). */
export function pickContrastText(bgHex: string): 'light' | 'dark' {
  if (!bgHex.startsWith('#') || bgHex.length !== 7) return 'light'
  const r = Number.parseInt(bgHex.slice(1, 3), 16)
  const g = Number.parseInt(bgHex.slice(3, 5), 16)
  const b = Number.parseInt(bgHex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'light'
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? 'dark' : 'light'
}

export function ItemRow({ item, onOpen }: { item: Item; onOpen: (item: Item) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="card-hairline group flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-card/95 hover:shadow-md"
    >
      <div className="relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-secondary/40">
        {item.image_url ? (
          <Image src={item.image_url} alt="" fill sizes="72px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            <ImageOff className="size-5" aria-hidden />
          </div>
        )}
        {item.featured && (
          <span
            role="img"
            className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-warning/95 text-warning-foreground shadow-sm"
            aria-label="Destacado"
          >
            <Star className="size-3 fill-current" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="line-clamp-1 font-medium leading-tight">{item.name}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>
        {(item.tags.length > 0 || item.points_override != null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.tags.slice(0, 3).map((tag) => {
              const tone = pickContrastText(tag.color)
              return (
                <span
                  key={tag.id}
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                    tone === 'light' ? 'text-white' : 'text-foreground',
                  )}
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              )
            })}
            {item.points_override != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-warning">
                +{item.points_override} pts
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end justify-between py-0.5 pl-1">
        <span className="font-serif text-base font-semibold tabular-nums">
          {ARSFormat(item.price_cents)}
        </span>
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add "app/m/[qrToken]/_components/item-row.tsx"
git commit -m "feat(carta): ItemRow reutilizable extraído de menu-list"
```

### Task 17: `CategoryCard` (hero + fallback)

**Files:**
- Create: `app/m/[qrToken]/_components/category-card.tsx`

- [ ] **Step 1: Implementar la card hero**

Create `category-card.tsx`:
```tsx
'use client'

import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'

type Category = ActiveSessionStateData['menu'][number]

export function CategoryCard({
  category,
  onSelect,
}: {
  category: Category
  onSelect: (id: string) => void
}) {
  const count = category.items.length
  const countLabel = `${count} ${count === 1 ? 'opción' : 'opciones'}`

  return (
    <button
      type="button"
      onClick={() => onSelect(category.id)}
      className="card-hairline group relative flex h-28 w-full items-end overflow-hidden rounded-2xl border border-border/60 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      {category.image_url ? (
        <>
          <Image
            src={category.image_url}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 480px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            unoptimized
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[oklch(0.15_0.03_165_/_0.82)] via-[oklch(0.15_0.03_165_/_0.15)] to-transparent"
          />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-primary">
          <div className="absolute -right-6 -top-6 size-28 rounded-full bg-[--forest-glow] blur-2xl" />
        </div>
      )}
      <div className="relative flex w-full items-end justify-between p-4">
        <div className="min-w-0">
          <p className="font-serif text-xl font-semibold leading-tight tracking-tight text-primary-foreground text-balance">
            {category.name}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-primary-foreground/80">{countLabel}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-primary-foreground backdrop-blur-sm transition-transform group-hover:translate-x-0.5">
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
    </button>
  )
}
```

> Nota de contraste: en light mode `--primary-foreground` es cream sobre forest/foto oscurecida (degradé) → contraste AA. El fallback usa `bg-primary` (forest) con texto `primary-foreground`. Si en dark el fallback queda bajo en contraste, verificá en el smoke (Task 21) y ajustá el degradé.

- [ ] **Step 2: Typecheck + commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add "app/m/[qrToken]/_components/category-card.tsx"
git commit -m "feat(carta): CategoryCard hero con fallback en paleta HUB"
```

### Task 18: `RecommendedCarousel` (destacados)

**Files:**
- Create: `app/m/[qrToken]/_components/recommended-carousel.tsx`

- [ ] **Step 1: Implementar el carrusel**

Create `recommended-carousel.tsx` (extrae la tarjeta de destacado de `menu-list.tsx` líneas 249-286):
```tsx
'use client'

import { ImageOff, Sparkles, Star } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { ARSFormat } from './item-row'

type Item = ActiveSessionStateData['menu'][number]['items'][number]

export function RecommendedCarousel({
  items,
  onOpen,
}: {
  items: Item[]
  onOpen: (item: Item) => void
}) {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="recommended-title">
      <h2
        id="recommended-title"
        className="mb-3 flex items-center gap-1.5 font-serif text-lg font-semibold tracking-tight"
      >
        <Sparkles className="size-4 text-warning" aria-hidden />
        Recomendados
      </h2>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <button
            key={`rec-${it.id}`}
            type="button"
            onClick={() => onOpen(it)}
            className="card-hairline group flex w-[15.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
              {it.image_url ? (
                <Image
                  src={it.image_url}
                  alt=""
                  fill
                  sizes="248px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                  <ImageOff className="size-8" aria-hidden />
                </div>
              )}
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-warning/95 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground shadow-sm">
                <Star className="size-3 fill-current" aria-hidden />
                Destacado
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <p className="line-clamp-1 font-medium leading-tight">{it.name}</p>
              {it.description && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{it.description}</p>
              )}
              <p className="mt-auto pt-1 font-serif text-base font-semibold tabular-nums">
                {ARSFormat(it.price_cents)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add "app/m/[qrToken]/_components/recommended-carousel.tsx"
git commit -m "feat(carta): RecommendedCarousel de destacados"
```

### Task 19: `MenuHub` (hub + drill-in + búsqueda)

**Files:**
- Create: `app/m/[qrToken]/_components/menu-hub.tsx`

- [ ] **Step 1: Implementar el hub**

Create `menu-hub.tsx`:
```tsx
'use client'

import { ArrowLeft, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { searchMenuItems } from '@/lib/m-session/menu-search'
import { CategoryCard } from './category-card'
import { ItemDetailSheet } from './item-detail-sheet'
import { ItemRow } from './item-row'
import type { CartItem } from './mesa-screen'
import { RecommendedCarousel } from './recommended-carousel'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

export function MenuHub({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Item | null>(null)

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.items.length > 0),
    [categories],
  )
  const featured = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => i.featured)).slice(0, 6),
    [categories],
  )
  const searchResults = useMemo(() => searchMenuItems(categories, query), [categories, query])
  const selected = useMemo(
    () => (selectedId ? (categories.find((c) => c.id === selectedId) ?? null) : null),
    [categories, selectedId],
  )

  const searching = query.trim().length > 0

  return (
    <div className="space-y-5">
      {/* Buscador global — siempre visible salvo dentro de una categoría */}
      {!selected && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en toda la carta…"
            className="h-11 rounded-xl pl-9 text-sm"
            aria-label="Buscar en la carta"
          />
        </div>
      )}

      {/* 1) Búsqueda activa → resultados planos */}
      {!selected && searching ? (
        searchResults.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
            <p className="text-sm font-medium">Sin resultados</p>
            <p className="mt-1 text-xs text-muted-foreground">Probá con otra búsqueda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {searchResults.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={setOpening} />
            ))}
          </div>
        )
      ) : selected ? (
        /* 2) Detalle de categoría (drill-in) */
        <section aria-labelledby="cat-detail-title" className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex size-9 items-center justify-center rounded-full border border-border/60 bg-card text-foreground shadow-sm transition-colors hover:bg-[--cream-tint]"
              aria-label="Volver a las categorías"
            >
              <ArrowLeft className="size-4" />
            </button>
            <h2
              id="cat-detail-title"
              className="font-serif text-xl font-semibold tracking-tight"
            >
              {selected.name}
            </h2>
          </div>
          <div className="space-y-2">
            {selected.items.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={setOpening} />
            ))}
          </div>
        </section>
      ) : (
        /* 3) Hub: recomendados + lista de categorías */
        <>
          <RecommendedCarousel items={featured} onOpen={setOpening} />
          {visibleCategories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
              <p className="text-sm font-medium">La carta está vacía</p>
              <p className="mt-1 text-xs text-muted-foreground">Pedile al mozo que te ayude.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleCategories.map((cat) => (
                <CategoryCard key={cat.id} category={cat} onSelect={setSelectedId} />
              ))}
            </div>
          )}
        </>
      )}

      {/* limpiar búsqueda flotante cuando hay query */}
      {!selected && searching && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"
        >
          <X className="size-3.5" /> Limpiar búsqueda
        </button>
      )}

      <ItemDetailSheet item={opening} onClose={() => setOpening(null)} onAdd={onAdd} />
    </div>
  )
}
```

> `ItemDetailSheet` ya existe y su interfaz es `{ item, onClose, onAdd }` (igual que la usaba `menu-list.tsx`). No se modifica.

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/m/[qrToken]/_components/menu-hub.tsx"
git commit -m "feat(carta): MenuHub category-first con drill-in + búsqueda global"
```

### Task 20: Conectar `MenuHub` en `mesa-screen` y borrar `menu-list`

**Files:**
- Modify: `app/m/[qrToken]/_components/mesa-screen.tsx:23, 456`
- Delete: `app/m/[qrToken]/_components/menu-list.tsx`

- [ ] **Step 1: Reemplazar el import y el uso**

En `mesa-screen.tsx`:
```ts
// cambiar: import { MenuList } from './menu-list'
import { MenuHub } from './menu-hub'
```
Y en el `TabsContent value="menu"`:
```tsx
            {state ? <MenuHub categories={state.menu} onAdd={addToCart} /> : <MenuSkeleton />}
```

- [ ] **Step 2: Borrar `menu-list.tsx`**

Run:
```bash
git rm "app/m/[qrToken]/_components/menu-list.tsx"
npm run typecheck && npm run lint
```
Expected: PASS (ya nadie importa `menu-list`; los helpers usados viven ahora en `item-row.tsx`).

- [ ] **Step 3: Smoke manual de la carta**

Con mesa activada: `/m/<qrToken>` → ver hub con cards de categoría (con foto la que tenga, fallback la que no) + "Recomendados" si hay featured → tocar categoría abre su detalle con "volver" → buscar en el buscador filtra toda la carta → tocar ítem abre el sheet de detalle y "agregar a la orden" funciona.

- [ ] **Step 4: Commit**

```bash
git add "app/m/[qrToken]/_components/mesa-screen.tsx"
git commit -m "feat(carta): mesa-screen usa MenuHub; baja menu-list"
```

---

## Phase 7 — Verificación final + docs

### Task 21: Verificación integral + documentación

**Files:**
- Modify: `docs/reservas.md` o crear `docs/carta-comensal-captura.md` (README de feature)

- [ ] **Step 1: Suite completa**

Run:
```bash
npm run typecheck && npm run lint && npm run test:ci
```
Expected: PASS. Si lint marca warnings preexistentes ajenos al cambio (ej. `commissions`, `sessions-waiter`), no bloquean; los nuevos archivos deben estar limpios.

- [ ] **Step 2: Test RLS de aislamiento del menú sigue verde (columna nueva)**

Run (requiere Supabase local + envs, ver CLAUDE.md §16):
```bash
npx vitest run tests/rls
```
Expected: PASS — `get_session_state` sigue aislando por tenant; `image_url`/`capture_prompt` no exponen otro tenant.

- [ ] **Step 3: Smoke manual end-to-end (documentar en el PR)**

Ejecutá y registrá resultado + screenshots:
1. Owner: subir imagen a 1 categoría, dejar otra sin imagen; editar copy del banner en `/configuracion/bienvenida`.
2. Comensal (browser limpio): escanear mesa activada → bottom sheet con el copy del owner.
3. "No por ahora" → ordenar → "¡Pedido enviado!" con card de captura.
4. Registrarse desde la card → toast de puntos/welcome reward → recargar: no reaparece nada.
5. Navegar categorías (foto + fallback), buscar global, abrir ítem, agregar a la orden.
6. Verificar dark mode de las cards hero y el fallback (contraste AA).

- [ ] **Step 4: README de feature**

Create `docs/carta-comensal-captura.md` con: modelo (RPC extendido + `tenants.settings.capture_prompt` + dismissal localStorage), componentes nuevos, decisiones (drill-in como estado de cliente, hero+fallback, 2 momentos de captura), y el smoke manual. (Seguí el estilo de `docs/reservas.md`.)

- [ ] **Step 5: Commit + push**

```bash
git add docs/carta-comensal-captura.md
git commit -m "docs(carta): README de carta drill-in + captura"
git push -u origin feat/carta-comensal-captura
```

- [ ] **Step 6: Abrir PR** con descripción completa (qué/por qué, decisiones de diseño del brainstorming, smoke manual + screenshots, checklist DoD).

---

## Self-Review (cubierto)

- **Spec §2 (carta drill-in)** → Tasks 16-20 (ItemRow, CategoryCard, RecommendedCarousel, MenuHub, wiring).
- **Spec §3 (banner sheet + post-orden + lifecycle + reconciliación)** → Tasks 4, 12-15.
- **Spec §4.1 (imágenes de categoría)** → Tasks 6-9.
- **Spec §4.2 (copy configurable)** → Tasks 3, 10-11.
- **Spec §5 (datos/RPC)** → Tasks 1-2.
- **Spec §8 (búsqueda global)** → Tasks 5, 19.
- **Spec §10 (testing)** → Tasks 3,4,5,6 (unit) + Task 21 (RLS + smoke).
- **Type consistency:** `image_url`/`capture_prompt` definidos en Task 1 (SQL) + Task 2 (TS) y consumidos consistentemente; `isCaptureSeen/markCaptureSeen/CaptureMoment` (Task 4) usados en Task 15; `searchMenuItems` (Task 5) en Task 19; `RegisterForm`/`CaptureHero` (Task 12) en Tasks 13-14; `CapturePromptConfig`/`updateCapturePromptConfig` (Tasks 3,10) en Task 11.
