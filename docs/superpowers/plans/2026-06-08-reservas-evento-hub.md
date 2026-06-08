# Reservas «Evento HUB» ↔ Eventos del calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al elegir Tipo de servicio «Evento HUB» en una reserva de salón, asociarla a un evento publicado del calendario `/eventos`; la reserva cuenta contra el cupo del evento (waitlist si se llena) reusando el motor de `event_attendees`, y se refleja en el calendario y el detalle del evento.

**Architecture:** La reserva guarda el link `hub_event_id`. Un **espejo** en `event_attendees` (con `salon_reservation_id`) es el ledger de cupo/waitlist. Dos RPCs `SECURITY DEFINER` (`link_…`, `unlink_…`) hacen el alta/baja del espejo bajo lock por evento reusando la lógica existente. Las server actions de salón sincronizan en alta/edición/cancelación. El estado de waitlist se lee del espejo (sin write-back a la reserva).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase Postgres (RLS + RPCs plpgsql), zod, react-hook-form, Vitest (unit + RLS integration), Biome.

**Spec:** `docs/superpowers/specs/2026-06-08-reservas-evento-hub-design.md`

**Working dir:** worktree `/mnt/c/Users/Agust/Hub_main_wt_reservas` (branch `feat/reservas-evento-hub`, ya creado desde `main`, con `node_modules` symlinkeado para que husky corra). Todos los comandos asumen ese cwd.

**Commits:** Conventional Commits. Cada commit debe terminar con el trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Decisiones clave (del spec):** counting contra capacidad + waitlist · reusar motor vía espejo · invitado sin cliente (customer_id nullable) · elegir evento fija la fecha de la reserva · el espejo es la fuente de verdad del estado.

---

## File Structure

**Crear:**
- `supabase/migrations/20260608120000_hub_event_reservations_link.sql` — columnas, índices, 2 RPCs, grants.
- `tests/rls/hub-event-link.test.ts` — integración del link/unlink + cupo/waitlist + aislamiento.

**Modificar:**
- `lib/salon/schemas.ts` — `hub_event_id` + superRefine (create/update).
- `lib/salon/humanize.ts` — mensajes de error del RPC.
- `lib/salon/actions.ts` — sync en `createSalonReservation` / `updateSalonReservation` / `cancelSalonReservation`.
- `lib/salon/types.ts` — `hub_event_id` en `SalonReservationRow`.
- `lib/salon/queries.ts` — `hub_event_id` en `RESERVATION_JOIN_SELECT`, type `ReservationWithJoins` y `flattenReservation`.
- `lib/events/queries.ts` — `listLinkableHubEvents` + `display_name`/`source` en `listReservations`/`ReservationRow`.
- `types/database.ts` — regenerado.
- `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx` — bloque condicional + prop `hubEvents` + helpers de fecha.
- `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx` — carga/pasa `hubEvents`.
- `app/(manager)/[tenantSlug]/reservas/[id]/page.tsx` — carga/pasa `hubEvents` + `hub_event_id` en initialValues.
- `app/(manager)/[tenantSlug]/eventos/_components/calendar-month.tsx` — ocupación en el pill.
- `app/(manager)/[tenantSlug]/eventos/[id]/_components/reservations-tab.tsx` — `display_name` + badge «Mesa».
- `app/(manager)/[tenantSlug]/eventos/[id]/_components/waitlist-tab.tsx` — `display_name` + badge «Mesa».
- `app/(manager)/[tenantSlug]/eventos/[id]/_components/check-in-tab.tsx` — `display_name`.

---

## Phase 1 — Base de datos

### Task 1: Migración (columnas + índices + RPCs + grants)

**Files:**
- Create: `supabase/migrations/20260608120000_hub_event_reservations_link.sql`

- [ ] **Step 1: Escribir la migración**

Crear el archivo con exactamente este contenido:

```sql
-- Asociar reservas de mesa (salon_reservations) a eventos del calendario (events).
-- - Link canónico hub_event_id en la reserva.
-- - event_attendees admite "invitados" (customer_id nullable) originados en reservas.
-- - RPCs link/unlink que reusan el motor de cupo/waitlist (locks por evento).

-- 1) Link en la reserva.
alter table public.salon_reservations
  add column hub_event_id uuid references public.events(id) on delete set null;

create index salon_reservations_hub_event_idx
  on public.salon_reservations(hub_event_id)
  where hub_event_id is not null;

-- 2) event_attendees: invitados sin cliente + back-ref a la reserva.
alter table public.event_attendees
  alter column customer_id drop not null;

alter table public.event_attendees
  add column salon_reservation_id uuid
    references public.salon_reservations(id) on delete cascade;

-- Una reserva ↔ a lo sumo un anotado vivo.
create unique index event_attendees_salon_reservation_uidx
  on public.event_attendees(salon_reservation_id)
  where salon_reservation_id is not null and status <> 'cancelled';

-- 3) RPC: vincular reserva a evento (capacidad + waitlist).
create or replace function public.link_salon_reservation_to_event(
  p_reservation_id uuid,
  p_event_id uuid
) returns table(attendee_id uuid, status public.reservation_status, waitlist_position int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_guests int;
  v_confirmed_seats int;
  v_status public.reservation_status;
  v_pos int;
  v_existing public.event_attendees;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  -- Lock por evento ANTES de contar cupos.
  perform pg_advisory_xact_lock(public.event_lock_key(p_event_id));

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'event_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_event.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;
  if v_res.tenant_id <> v_event.tenant_id then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;

  v_guests := v_res.estimated_guests;
  if v_guests is null or v_guests < 1 or v_guests > 99 then
    raise exception 'invalid_guests' using errcode = 'P0001';
  end if;
  if v_event.capacity is not null and v_guests > v_event.capacity then
    raise exception 'guests_exceed_capacity' using errcode = 'P0001';
  end if;

  -- Espejo activo previo de ESTA reserva (re-eval por cambio de comensales).
  select * into v_existing
    from public.event_attendees
    where salon_reservation_id = p_reservation_id and status <> 'cancelled'
    limit 1;

  -- Relink a OTRO evento debe pasar por unlink primero (libera/promueve el viejo).
  if v_existing.id is not null and v_existing.event_id <> p_event_id then
    raise exception 'relink_requires_unlink' using errcode = 'P0001';
  end if;

  -- Confirmados del evento, excluyendo el propio espejo si ya existía.
  select coalesce(sum(guests_count), 0) into v_confirmed_seats
    from public.event_attendees
    where event_id = p_event_id
      and status in ('confirmed', 'checked_in')
      and (v_existing.id is null or id <> v_existing.id);

  if v_event.capacity is null
     or (v_confirmed_seats + v_guests) <= v_event.capacity then
    v_status := 'confirmed';
    v_pos := null;
  elsif v_event.waitlist_enabled then
    v_status := 'waitlist';
    select coalesce(max(waitlist_position), 0) + 1 into v_pos
      from public.event_attendees
      where event_id = p_event_id and status = 'waitlist'
        and (v_existing.id is null or id <> v_existing.id);
  else
    raise exception 'capacity_reached' using errcode = 'P0001';
  end if;

  if v_existing.id is null then
    insert into public.event_attendees (
      tenant_id, event_id, customer_id, salon_reservation_id,
      guests_count, status, waitlist_position
    ) values (
      v_event.tenant_id, p_event_id, v_res.customer_id, p_reservation_id,
      v_guests, v_status, v_pos
    ) returning id into v_id;
  else
    update public.event_attendees set
      customer_id = v_res.customer_id,
      guests_count = v_guests,
      status = v_status,
      waitlist_position = v_pos
    where id = v_existing.id
    returning id into v_id;
  end if;

  update public.salon_reservations set hub_event_id = p_event_id where id = p_reservation_id;

  return query select v_id, v_status, v_pos;
end; $$;

-- 4) RPC: desvincular reserva de evento (libera cupo + promueve waitlist).
create or replace function public.unlink_salon_reservation_from_event(
  p_reservation_id uuid
) returns table(promoted_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_m public.event_attendees;
  v_event public.events;
  v_confirmed_seats int;
  v_promote_id uuid := null;
  rec record;
  i int := 1;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select * into v_m
    from public.event_attendees
    where salon_reservation_id = p_reservation_id and status <> 'cancelled'
    limit 1;

  -- Sin espejo activo: solo limpiar el link y salir (idempotente).
  if v_m.id is null then
    update public.salon_reservations set hub_event_id = null where id = p_reservation_id;
    return query select null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(public.event_lock_key(v_m.event_id));
  select * into v_m from public.event_attendees where id = v_m.id for update;
  select * into v_event from public.events where id = v_m.event_id;

  update public.event_attendees
    set status = 'cancelled', waitlist_position = null
    where id = v_m.id;

  if v_m.status in ('confirmed') and v_event.capacity is not null then
    select coalesce(sum(guests_count), 0) into v_confirmed_seats
      from public.event_attendees
      where event_id = v_m.event_id and status in ('confirmed', 'checked_in');

    for rec in
      select id, guests_count from public.event_attendees
        where event_id = v_m.event_id and status = 'waitlist'
        order by waitlist_position asc
        for update skip locked
    loop
      if v_confirmed_seats + rec.guests_count <= v_event.capacity then
        update public.event_attendees
          set status = 'confirmed', waitlist_position = null
          where id = rec.id;
        v_promote_id := rec.id;
        exit;
      end if;
    end loop;
  end if;

  -- Compactar posiciones de waitlist (1..N).
  for rec in
    select id from public.event_attendees
      where event_id = v_m.event_id and status = 'waitlist'
      order by waitlist_position asc
  loop
    update public.event_attendees set waitlist_position = i where id = rec.id;
    i := i + 1;
  end loop;

  update public.salon_reservations set hub_event_id = null where id = p_reservation_id;

  return query select v_promote_id;
end; $$;

-- 5) Grants (RPCs SECURITY DEFINER, chequeo de rol adentro).
revoke all on function
  public.link_salon_reservation_to_event(uuid, uuid),
  public.unlink_salon_reservation_from_event(uuid)
  from public;

grant execute on function
  public.link_salon_reservation_to_event(uuid, uuid),
  public.unlink_salon_reservation_from_event(uuid)
  to authenticated;
```

- [ ] **Step 2: Aplicar la migración**

Local (si hay Docker): `npm run db:reset` (corre migraciones + seed).
En este proyecto el CLI no está linkeado y puede no haber Docker — aplicar vía MCP de Supabase (`apply_migration`, proyecto `ogplsevtrclzxvyejlns`, name `hub_event_reservations_link`) pasando el SQL del Step 1 (ver memoria `supabase-prod-migrations-via-mcp`).

Verificar que aplicó: las columnas existen.
Run (local): `npx supabase db diff` → Expected: sin diferencias pendientes para estas tablas.
O vía MCP `execute_sql`: `select column_name from information_schema.columns where table_name='salon_reservations' and column_name='hub_event_id';` → 1 fila.

- [ ] **Step 3: Regenerar tipos**

Local: `npm run db:types`.
Sin Docker: MCP `generate_typescript_types` y re-anexar el bloque de alias que el generador borra (ver memoria `supabase-types-regen-via-mcp`). Guardar en `types/database.ts`.

Run: `npm run typecheck`
Expected: PASS (los tipos nuevos compilan; `event_attendees.customer_id` ahora `string | null`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608120000_hub_event_reservations_link.sql types/database.ts
git commit -m "feat(reservas): migración link reserva↔evento + RPCs cupo/waitlist"
```

---

## Phase 2 — Validación (zod)

### Task 2: `hub_event_id` + superRefine en los schemas (TDD)

**Files:**
- Modify: `lib/salon/schemas.ts`
- Test: `tests/lib/salon-reservation-schema.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/lib/salon-reservation-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSalonReservationSchema } from '@/lib/salon/schemas'

const base = {
  guest_name: 'Juan',
  meal_type: 'hub_event',
  reservation_date: '2026-06-20',
  reservation_time_local: '21:00',
  zone: 'planta_alta',
  estimated_guests: 4,
  primary_manager_id: '11111111-1111-1111-1111-111111111111',
}

describe('createSalonReservationSchema — hub_event_id', () => {
  it('rechaza meal_type hub_event sin hub_event_id', () => {
    const r = createSalonReservationSchema.safeParse(base)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'hub_event_id')).toBe(true)
    }
  })

  it('acepta meal_type hub_event con hub_event_id', () => {
    const r = createSalonReservationSchema.safeParse({
      ...base,
      hub_event_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(r.success).toBe(true)
  })

  it('no exige hub_event_id para otros meal_type', () => {
    const r = createSalonReservationSchema.safeParse({ ...base, meal_type: 'dinner' })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run tests/lib/salon-reservation-schema.test.ts`
Expected: FAIL — el primer caso pasa el parse (todavía no existe la regla), assert `success===false` falla.

- [ ] **Step 3: Agregar el campo a ambos schemas**

En `lib/salon/schemas.ts`, dentro de `createSalonReservationSchema` (después de `requested_template_id`, línea ~86) agregar:

```ts
    hub_event_id: z.string().uuid().optional().nullable(),
```

En `updateSalonReservationSchema` (después de `scheduled_event_id`, línea ~136) agregar la misma línea:

```ts
    hub_event_id: z.string().uuid().optional().nullable(),
```

- [ ] **Step 4: Agregar la regla superRefine en ambos schemas**

En el `superRefine` de `createSalonReservationSchema` (dentro del bloque que arranca en línea ~99), agregar al final del callback:

```ts
    if (data.meal_type === 'hub_event' && !data.hub_event_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['hub_event_id'],
        message: 'Elegí el evento del calendario al que se asocia.',
      })
    }
```

Agregar el mismo bloque al `superRefine` de `updateSalonReservationSchema` (línea ~150).

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `npx vitest run tests/lib/salon-reservation-schema.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add lib/salon/schemas.ts tests/lib/salon-reservation-schema.test.ts
git commit -m "feat(reservas): valida hub_event_id requerido para meal_type hub_event"
```

---

## Phase 3 — Queries

### Task 3: `listLinkableHubEvents` + `display_name`/`source` en anotados

**Files:**
- Modify: `lib/events/queries.ts`
- Modify: `lib/salon/types.ts`
- Modify: `lib/salon/queries.ts`

- [ ] **Step 1: `SalonReservationRow.hub_event_id`**

En `lib/salon/types.ts`, en `SalonReservationRow` (después de `scheduled_event_id: string | null`, línea 99) agregar:

```ts
  hub_event_id: string | null
```

- [ ] **Step 2: `hub_event_id` en el select y flatten de reservas**

En `lib/salon/queries.ts`, localizar la constante `RESERVATION_JOIN_SELECT` (string de columnas de `salon_reservations`) y agregar `hub_event_id` a la lista de columnas seleccionadas. Localizar el type `ReservationWithJoins` y agregar `hub_event_id: string | null`. En `flattenReservation`, asegurarse de copiar `hub_event_id` (si hace spread del row crudo ya viaja; si mapea campo a campo, agregar `hub_event_id: r.hub_event_id ?? null`).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: `listLinkableHubEvents` + `HubEventOption`**

En `lib/events/queries.ts`, agregar al final del archivo (después de `listReservations`):

```ts
export type HubEventOption = {
  id: string
  name: string
  starts_at: string
  capacity: number | null
  confirmed_seats: number
  waitlist_enabled: boolean
}

/**
 * Eventos publicados y futuros del tenant, con asientos confirmados agregados.
 * Para poblar el desplegable de asociación en el alta de reservas «Evento HUB».
 */
export async function listLinkableHubEvents(opts: {
  tenantId: string
}): Promise<HubEventOption[]> {
  const supabase = await createClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, starts_at, capacity, waitlist_enabled')
    .eq('tenant_id', opts.tenantId)
    .eq('status', 'published')
    .gte('ends_at', now)
    .order('starts_at', { ascending: true })
  if (error) throw error
  const events = data ?? []
  if (events.length === 0) return []

  const ids = events.map((e) => e.id)
  const { data: seats } = await supabase
    .from('event_attendees')
    .select('event_id, status, guests_count')
    .in('event_id', ids)

  const confirmed = new Map<string, number>()
  for (const id of ids) confirmed.set(id, 0)
  for (const r of seats ?? []) {
    const row = r as unknown as { event_id: string; status: ReservationStatus; guests_count: number }
    if (row.status === 'confirmed' || row.status === 'checked_in') {
      confirmed.set(row.event_id, (confirmed.get(row.event_id) ?? 0) + row.guests_count)
    }
  }

  return events.map((e) => ({
    ...(e as unknown as Omit<HubEventOption, 'confirmed_seats'>),
    confirmed_seats: confirmed.get(e.id) ?? 0,
  }))
}
```

- [ ] **Step 4: `display_name` + `source` en `ReservationRow`/`listReservations`**

En `lib/events/queries.ts`, reemplazar el type `ReservationRow` (líneas 134-146) por:

```ts
export type ReservationRow = {
  id: string
  status: ReservationStatus
  guests_count: number
  waitlist_position: number | null
  checked_in_at: string | null
  display_name: string
  source: 'attendee' | 'table'
  customer: {
    id: string
    first_name: string
    last_name: string
    phone: string
  }
}
```

Reemplazar el cuerpo de `listReservations` (el `.select(...)` y el `.map(...)`) por:

```ts
  const { data, error } = await supabase
    .from('event_attendees')
    .select(
      `id, status, guests_count, waitlist_position, checked_in_at,
       customer:customers(id, first_name, last_name, phone),
       salon_reservation:salon_reservations(guest_name)`,
    )
    .eq('tenant_id', opts.tenantId)
    .eq('event_id', opts.eventId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<ReservationRow, 'customer' | 'display_name' | 'source'> & {
      customer: ReservationRow['customer'] | ReservationRow['customer'][] | null
      salon_reservation: { guest_name: string } | { guest_name: string }[] | null
    }
    const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer
    const sr = Array.isArray(r.salon_reservation) ? r.salon_reservation[0] : r.salon_reservation
    const source: 'attendee' | 'table' = sr ? 'table' : 'attendee'
    const display_name = customer
      ? `${customer.first_name} ${customer.last_name}`.trim()
      : (sr?.guest_name ?? '—')
    return {
      id: r.id,
      status: r.status,
      guests_count: r.guests_count,
      waitlist_position: r.waitlist_position,
      checked_in_at: r.checked_in_at,
      display_name,
      source,
      customer: customer ?? { id: '', first_name: '—', last_name: '', phone: '' },
    }
  })
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS (lint puede mostrar los 18 warnings preexistentes de `main`, ninguno nuevo en estos archivos).

- [ ] **Step 6: Commit**

```bash
git add lib/events/queries.ts lib/salon/types.ts lib/salon/queries.ts
git commit -m "feat(reservas): query de eventos linkeables + nombre de invitado en anotados"
```

---

## Phase 4 — Server actions (sincronización)

### Task 4: Mensajes de error del RPC

**Files:**
- Modify: `lib/salon/humanize.ts`

- [ ] **Step 1: Agregar mappings**

En `lib/salon/humanize.ts`, dentro de `humanizeSalonError`, agregar antes del `if (m.includes('foreign key'))` (línea ~21):

```ts
  if (m.includes('event_not_found')) return 'El evento no existe.'
  if (m.includes('event_not_open')) return 'El evento no está publicado.'
  if (m.includes('tenant_mismatch')) return 'El evento es de otro local.'
  if (m.includes('guests_exceed_capacity'))
    return 'La cantidad de personas supera el cupo del evento.'
  if (m.includes('capacity_reached')) return 'El evento está lleno y no admite lista de espera.'
  if (m.includes('relink_requires_unlink')) return 'No se pudo reasignar el evento. Probá de nuevo.'
```

- [ ] **Step 2: Verificar + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add lib/salon/humanize.ts
git commit -m "feat(reservas): mensajes de error de link a evento"
```

### Task 5: Sync en create/update/cancel

**Files:**
- Modify: `lib/salon/actions.ts`

- [ ] **Step 1: Sync en `createSalonReservation`**

En `lib/salon/actions.ts`, en `createSalonReservation`, reemplazar el bloque final (desde `await logAudit({` de la creación hasta el `return { ok: true, message: 'Reserva creada.' ... }`, líneas ~185-202) por:

```ts
  const newId = (data as { id: string }).id

  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'salon_reservation.created',
    entity: 'salon_reservation',
    entityId: newId,
    payload: {
      kind: parsed.data.kind,
      meal_type: parsed.data.meal_type,
      estimated_guests: parsed.data.estimated_guests,
      manager: parsed.data.primary_manager_id,
      origin: parsed.data.origin,
    },
  })

  // Asociar al evento del calendario (cuenta contra cupo / waitlist).
  let hubMessage = 'Reserva creada.'
  if (parsed.data.meal_type === 'hub_event' && parsed.data.hub_event_id) {
    const { data: linkData, error: linkErr } = await supabase.rpc('link_salon_reservation_to_event', {
      p_reservation_id: newId,
      p_event_id: parsed.data.hub_event_id,
    })
    if (linkErr) {
      revalidatePath(`/${slug}/reservas`)
      return {
        ok: true,
        message: `Reserva creada, pero no se pudo asociar al evento: ${humanizeSalonError(linkErr.message)}`,
        data: { id: newId },
      }
    }
    const link = Array.isArray(linkData) ? linkData[0] : linkData
    if (link?.status === 'waitlist') {
      hubMessage = `Reserva creada — en lista de espera (puesto ${link.waitlist_position}).`
    } else if (link?.status === 'confirmed') {
      hubMessage = 'Reserva creada y confirmada en el evento.'
    }
    await logAudit({
      tenantId: access.tenant.id,
      userId: user?.id ?? null,
      action: 'salon_reservation.linked_to_event',
      entity: 'salon_reservation',
      entityId: newId,
      payload: { event_id: parsed.data.hub_event_id, status: link?.status ?? null },
    })
  }

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/eventos`)
  return { ok: true, message: hubMessage, data: { id: newId } }
```

(Quitar el `revalidatePath`/`return` viejos que quedaban después, para no duplicar.)

- [ ] **Step 2: Sync en `updateSalonReservation`**

En `updateSalonReservation`, justo después de `const { id, ...patch } = parsed.data` (línea ~219), leer el link previo:

```ts
  const { data: prevRow } = await supabase
    .from('salon_reservations')
    .select('hub_event_id')
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
    .maybeSingle()
  const prevHubEventId = (prevRow as { hub_event_id: string | null } | null)?.hub_event_id ?? null
```

Luego, después del `recalc_reservation_commission` (línea ~248) y antes del `logAudit`, agregar la reconciliación del link:

```ts
  // Reconciliar asociación a evento (el UPDATE ya guardó meal_type/estimated_guests).
  const wantsLink = patch.meal_type === 'hub_event' && !!patch.hub_event_id
  if (wantsLink) {
    if (prevHubEventId && prevHubEventId !== patch.hub_event_id) {
      await supabase.rpc('unlink_salon_reservation_from_event', { p_reservation_id: id })
    }
    const { error: linkErr } = await supabase.rpc('link_salon_reservation_to_event', {
      p_reservation_id: id,
      p_event_id: patch.hub_event_id,
    })
    if (linkErr) return { ok: false, message: humanizeSalonError(linkErr.message), code: linkErr.message }
  } else if (prevHubEventId) {
    await supabase.rpc('unlink_salon_reservation_from_event', { p_reservation_id: id })
  }
```

Agregar `revalidatePath(\`/${slug}/eventos\`)` junto a los otros `revalidatePath` del final de la función.

> Nota: el UPDATE de `salon_reservations` NO debe setear `hub_event_id` directamente — lo manejan los RPCs. No agregar `hub_event_id` al objeto `.update({...})`.

- [ ] **Step 3: Sync en `cancelSalonReservation`**

En `cancelSalonReservation`, después del `recalc_reservation_commission` (línea ~286) agregar:

```ts
  // Liberar cupo del evento si estaba asociada (no-op si no lo estaba).
  await supabase.rpc('unlink_salon_reservation_from_event', { p_reservation_id: parsed.data.id })
```

Agregar `revalidatePath(\`/${slug}/eventos\`)` al final.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS (sin nuevos errores/warnings).

- [ ] **Step 5: Commit**

```bash
git add lib/salon/actions.ts
git commit -m "feat(reservas): sincroniza link a evento en alta/edición/cancelación"
```

---

## Phase 5 — Formulario de reserva

### Task 6: Bloque condicional «Evento del calendario» + prop

**Files:**
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx`

- [ ] **Step 1: Importar el type y agregar la prop**

Cerca de los imports de tipo (junto a `import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'`, línea 40) agregar:

```ts
import type { HubEventOption } from '@/lib/events/queries'
```

En el type `Props` (líneas 60-74) agregar:

```ts
  hubEvents: HubEventOption[]
```

Desestructurar `hubEvents` en los parámetros del componente `ReservationForm({ … })` (junto a `initialEventsForDate`).

- [ ] **Step 2: Helpers de fecha/hora del evento (zona Córdoba)**

Cerca de `quickChips` (línea ~95) agregar:

```ts
function eventLocalDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}
function eventLocalTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Cordoba',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
function eventDateShort(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso))
}
```

- [ ] **Step 3: Agregar `hub_event_id` a los defaultValues del form**

En la inicialización de `useForm` (el objeto `defaultValues`), agregar junto a `scheduled_event_id`:

```ts
      hub_event_id: initialValues?.hub_event_id ?? undefined,
```

- [ ] **Step 4: Insertar el bloque condicional**

Inmediatamente después del bloque `event_floating` (el `</AnimatePresence>` de la línea ~557, antes del bloque `kind === 'birthday'...`), insertar:

```tsx
      {/* EVENTO HUB: asociar a un evento publicado del calendario */}
      <AnimatePresence initial={false}>
        {values.meal_type === 'hub_event' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="Evento del calendario" icon={Sparkles}>
              <p className="text-xs text-muted-foreground">
                Asociá esta reserva a un evento publicado. Las personas cuentan contra el cupo del
                evento; si está lleno entra a lista de espera.
              </p>
              <Select
                value={values.hub_event_id ?? ''}
                onValueChange={(v) => {
                  form.setValue('hub_event_id', v || undefined, { shouldValidate: true })
                  const ev = hubEvents.find((e) => e.id === v)
                  if (ev) {
                    form.setValue('reservation_date', eventLocalDate(ev.starts_at), {
                      shouldValidate: true,
                    })
                    form.setValue('reservation_time_local', eventLocalTime(ev.starts_at), {
                      shouldValidate: true,
                    })
                  }
                }}
              >
                <SelectTrigger className="h-11 text-base">
                  <SelectValue placeholder="Elegí un evento…" />
                </SelectTrigger>
                <SelectContent>
                  {hubEvents.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No hay eventos publicados próximos.{' '}
                      <a
                        href={`/${tenantSlug}/eventos/nuevo`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
                      >
                        Crear uno
                      </a>
                    </div>
                  ) : (
                    hubEvents.map((e) => {
                      const remaining =
                        e.capacity == null ? null : Math.max(0, e.capacity - e.confirmed_seats)
                      const full = remaining !== null && remaining <= 0
                      return (
                        <SelectItem key={e.id} value={e.id} disabled={full && !e.waitlist_enabled}>
                          <span className="flex items-center gap-2">
                            {e.name}
                            <span className="text-xs text-muted-foreground">
                              · {eventDateShort(e.starts_at)} {eventLocalTime(e.starts_at)}
                              {remaining === null
                                ? ''
                                : full
                                  ? e.waitlist_enabled
                                    ? ' · lleno (lista de espera)'
                                    : ' · lleno'
                                  : ` · ${remaining} lugares`}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.hub_event_id?.message ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.hub_event_id.message}
                </p>
              ) : null}
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (`values.hub_event_id` compila porque `CreateSalonReservationInput` ya incluye el campo tras la Task 2.)

- [ ] **Step 6: Commit**

```bash
git add app/\(manager\)/\[tenantSlug\]/reservas/_components/reservation-form.tsx
git commit -m "feat(reservas): selector de evento del calendario en el form (meal_type hub_event)"
```

### Task 7: Cargar `hubEvents` en las páginas de alta y edición

**Files:**
- Modify: `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/[id]/page.tsx`

- [ ] **Step 1: Página de alta**

En `reservas/nuevo/page.tsx`:
- Importar la query: agregar `import { listLinkableHubEvents } from '@/lib/events/queries'`.
- Sumar al `Promise.all` (líneas 60-66) la llamada y desestructurar `hubEvents`:

```ts
  const [managers, templates, eventsToday, tiers, bonus, hubEvents] = await Promise.all([
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledEventsForDate({ tenantId: access.tenant.id, date: initialDate }),
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    listLinkableHubEvents({ tenantId: access.tenant.id }),
  ])
```

- Pasar la prop al `<ReservationForm … />`: agregar `hubEvents={hubEvents}`.

- [ ] **Step 2: Página de edición**

En `reservas/[id]/page.tsx`:
- Importar `listLinkableHubEvents` desde `@/lib/events/queries`.
- Sumar al `Promise.all` (líneas 45-54) `listLinkableHubEvents({ tenantId: access.tenant.id })` y desestructurar `hubEvents`.
- Pasar `hubEvents={hubEvents}` al `<ReservationForm … />`.
- En `initialValues` (líneas 83-103) agregar:

```ts
            hub_event_id: reservation.hub_event_id ?? undefined,
```

- [ ] **Step 3: Verificar + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add app/\(manager\)/\[tenantSlug\]/reservas/nuevo/page.tsx app/\(manager\)/\[tenantSlug\]/reservas/\[id\]/page.tsx
git commit -m "feat(reservas): cargar eventos linkeables en alta y edición"
```

---

## Phase 6 — Calendario + detalle de evento

### Task 8: Ocupación en el pill del calendario `/eventos`

**Files:**
- Modify: `app/(manager)/[tenantSlug]/eventos/_components/calendar-month.tsx`

- [ ] **Step 1: Mostrar ocupación en el pill (desktop y mobile)**

En `calendar-month.tsx`, el componente recibe `events: EventListEntry[]` (ya trae `confirmed_seats`, `capacity`, `waitlist_count`). Agregar un helper arriba del `return` (después de armar `eventsByDay`, línea ~35):

```tsx
  const occ = (ev: EventListEntry): string =>
    ev.capacity === null ? `${ev.confirmed_seats}` : `${ev.confirmed_seats}/${ev.capacity}`
```

En el pill **mobile** (línea ~88-99), dentro del `<Link>`, después del `<span className="truncate">{ev.name}</span>` agregar:

```tsx
                        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums opacity-80">
                          {occ(ev)}
                          {ev.waitlist_count > 0 ? ` +${ev.waitlist_count}` : ''}
                        </span>
```

En el pill **desktop** (línea ~139-148), reemplazar el contenido del `<Link>` por una línea con ocupación:

```tsx
                  <Link
                    key={ev.id}
                    href={`/${tenantSlug}/eventos/${ev.id}`}
                    className="block truncate rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-primary hover:bg-primary/25"
                    title={`${ev.name} · ${occ(ev)}${ev.waitlist_count > 0 ? ` (+${ev.waitlist_count} espera)` : ''}`}
                  >
                    <span className="font-mono">{format(new Date(ev.starts_at), 'HH:mm')}</span>{' '}
                    {ev.name}{' '}
                    <span className="font-mono tabular-nums opacity-80">{occ(ev)}</span>
                  </Link>
```

- [ ] **Step 2: Verificar + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add app/\(manager\)/\[tenantSlug\]/eventos/_components/calendar-month.tsx
git commit -m "feat(eventos): ocupación por evento en el calendario mensual"
```

### Task 9: Mostrar reservas de mesa en el detalle del evento

**Files:**
- Modify: `app/(manager)/[tenantSlug]/eventos/[id]/_components/reservations-tab.tsx`
- Modify: `app/(manager)/[tenantSlug]/eventos/[id]/_components/waitlist-tab.tsx`
- Modify: `app/(manager)/[tenantSlug]/eventos/[id]/_components/check-in-tab.tsx`

- [ ] **Step 1: `reservations-tab.tsx`**

Reemplazar el filtro `visible` (líneas 45-55) para buscar por `display_name`:

```tsx
  const visible = reservations
    .filter((r) => r.status === 'confirmed' || r.status === 'checked_in')
    .filter((r) => {
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return r.display_name.toLowerCase().includes(q) || r.customer.phone.includes(q)
    })
```

En el `.map` (líneas 112-114), reemplazar el cálculo de `initials` y el nombre mostrado:

```tsx
            const initials = r.display_name
              .split(' ')
              .map((w) => w[0] ?? '')
              .slice(0, 2)
              .join('')
              .toUpperCase()
```

Reemplazar el `<p className="text-sm font-medium">{r.customer.first_name} {r.customer.last_name}</p>` (líneas 126-128) por:

```tsx
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {r.display_name}
                    {r.source === 'table' ? (
                      <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                        Mesa
                      </Badge>
                    ) : null}
                  </p>
```

- [ ] **Step 2: `waitlist-tab.tsx`**

En el `.map` (líneas 62-63) reemplazar el cálculo de `initials`:

```tsx
            const initials = r.display_name
              .split(' ')
              .map((w) => w[0] ?? '')
              .slice(0, 2)
              .join('')
              .toUpperCase()
```

Reemplazar el `<p className="text-sm font-medium">{r.customer.first_name} {r.customer.last_name}</p>` (líneas 78-80) por:

```tsx
                  <p className="text-sm font-medium">{r.display_name}</p>
```

Importar `Badge` si se quiere mostrar el tag «Mesa» (opcional aquí; el listado de waitlist es más compacto — dejar solo el nombre).

- [ ] **Step 3: `check-in-tab.tsx`**

Reemplazar el filtro `visible` (líneas 23-31) para usar `display_name`:

```tsx
  const visible = reservations.filter((r) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return r.display_name.toLowerCase().includes(q) || r.customer.phone.includes(q)
  })
```

Reemplazar el cálculo de `initials` (líneas 61-62) y el nombre (líneas 71-73):

```tsx
            const initials = r.display_name
              .split(' ')
              .map((w) => w[0] ?? '')
              .slice(0, 2)
              .join('')
              .toUpperCase()
```

```tsx
                  <p className="font-medium">{r.display_name}</p>
```

- [ ] **Step 4: Verificar + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add app/\(manager\)/\[tenantSlug\]/eventos/\[id\]/_components/reservations-tab.tsx app/\(manager\)/\[tenantSlug\]/eventos/\[id\]/_components/waitlist-tab.tsx app/\(manager\)/\[tenantSlug\]/eventos/\[id\]/_components/check-in-tab.tsx
git commit -m "feat(eventos): mostrar reservas de mesa (invitado) en el detalle del evento"
```

---

## Phase 7 — Test de integración (RLS)

### Task 10: `tests/rls/hub-event-link.test.ts`

> Estos tests crean tenants/usuarios reales contra el Postgres local y necesitan Supabase local (`npx supabase start`) + envs (`SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`). Si no hay Docker en local, se validan en el job `rls` de CI. Espejá el harness de `tests/rls/events.test.ts`.

**Files:**
- Create: `tests/rls/hub-event-link.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — link salon_reservation ↔ event', () => {
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let eventId: string
  let eventBId: string
  let managerId: string

  // Crea una reserva de mesa (vía service) y devuelve su id.
  async function makeReservation(guests: number, name: string): Promise<string> {
    const service = getServiceClient()
    const { data, error } = await service
      .from('salon_reservations')
      .insert({
        tenant_id: tenantA.id,
        guest_name: name,
        kind: 'normal',
        meal_type: 'hub_event',
        reservation_date: '2026-06-20',
        reservation_time_local: '21:00:00',
        zone: 'planta_alta',
        estimated_guests: guests,
        origin: 'in_person',
        primary_manager_id: managerId,
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  }

  beforeAll(async () => {
    cashierA = await createUserClient({ email: uniqueEmail('hub-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('hub-ownerB') })
    const ownerA = await createUserClient({ email: uniqueEmail('hub-ownerA') })
    tenantA = await createTenant({ name: 'Bar A', slug: uniqueSlug('hub-a'), ownerId: ownerA.userId })
    tenantB = await createTenant({ name: 'Bar B', slug: uniqueSlug('hub-b'), ownerId: ownerB.userId })
    const service = getServiceClient()
    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: cashierA.userId,
      role: 'cashier',
    })

    const { data: mgr } = await service
      .from('reservation_managers')
      .insert({ tenant_id: tenantA.id, display_name: 'Gestor A' })
      .select('id')
      .single()
    managerId = (mgr as { id: string }).id

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    const { data: ev } = await service
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Trivia',
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 4,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single()
    eventId = (ev as { id: string }).id

    const { data: evB } = await service
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Peña B',
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 10,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single()
    eventBId = (evB as { id: string }).id
  })

  afterAll(async () => {
    if (cashierA) await deleteUser(cashierA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('linkea como confirmed cuando hay cupo; invitado sin cliente', async () => {
    const resId = await makeReservation(3, 'Juan Invitado')
    const { data, error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    expect(error).toBeNull()
    const r = Array.isArray(data) ? data[0] : data
    expect(r?.status).toBe('confirmed')

    const service = getServiceClient()
    const { data: mirror } = await service
      .from('event_attendees')
      .select('customer_id, guests_count, salon_reservation_id, status')
      .eq('salon_reservation_id', resId)
      .single()
    expect(mirror?.customer_id).toBeNull()
    expect(mirror?.guests_count).toBe(3)
    expect(mirror?.status).toBe('confirmed')

    const { data: res } = await service
      .from('salon_reservations')
      .select('hub_event_id')
      .eq('id', resId)
      .single()
    expect(res?.hub_event_id).toBe(eventId)
  })

  it('al pasarse de cupo va a waitlist', async () => {
    // Ya hay 3 confirmados (capacity 4). 2 más → waitlist.
    const resId = await makeReservation(2, 'Ana Espera')
    const { data } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    const r = Array.isArray(data) ? data[0] : data
    expect(r?.status).toBe('waitlist')
    expect(r?.waitlist_position).toBe(1)
  })

  it('unlink libera cupo y promueve waitlist', async () => {
    const service = getServiceClient()
    // Reserva confirmada (3 personas) a desvincular.
    const { data: conf } = await service
      .from('event_attendees')
      .select('salon_reservation_id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .not('salon_reservation_id', 'is', null)
      .limit(1)
      .single()
    const target = (conf as { salon_reservation_id: string }).salon_reservation_id

    const { data, error } = await cashierA.client.rpc('unlink_salon_reservation_from_event', {
      p_reservation_id: target,
    })
    expect(error).toBeNull()
    const r = Array.isArray(data) ? data[0] : data
    // Liberó 3 lugares: la de waitlist (2) entra.
    expect(r?.promoted_id).toBeTruthy()

    const { data: res } = await service
      .from('salon_reservations')
      .select('hub_event_id')
      .eq('id', target)
      .single()
    expect(res?.hub_event_id).toBeNull()
  })

  it('guests > capacity bloqueado', async () => {
    const resId = await makeReservation(99, 'Grupo Grande')
    const { error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    expect(error?.message).toContain('guests_exceed_capacity')
  })

  it('cross-tenant: no se linkea a un evento de otro local', async () => {
    const resId = await makeReservation(1, 'Cross')
    const { error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventBId,
    })
    // user_role_in_tenant(tenantB) es null para cashierA → forbidden.
    expect(error?.message).toMatch(/forbidden|tenant_mismatch/)
  })

  it('owner B no ve los anotados de A', async () => {
    const { data } = await ownerB.client
      .from('event_attendees')
      .select('id')
      .eq('event_id', eventId)
    expect(data ?? []).toEqual([])
  })
})
```

- [ ] **Step 2: Correr (si hay Supabase local)**

Run: `npx supabase start` (si no está corriendo) y luego
`npx vitest run tests/rls/hub-event-link.test.ts`
Expected: PASS (6 passed). Si no hay Docker, los tests se marcan `skip` (vía `RLS_TESTS_ENABLED`) y corren en el job `rls` de CI.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/hub-event-link.test.ts
git commit -m "test(reservas): RLS link/unlink reserva↔evento (cupo, waitlist, aislamiento)"
```

---

## Phase 8 — Cierre (DoD)

### Task 11: Suite completa + smoke manual + docs

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: typecheck PASS · lint sin errores nuevos · tests verdes (los RLS nuevos `skip` si no hay Supabase local).

- [ ] **Step 2: Smoke manual (documentar en el PR con screenshots)**

1. `/eventos` → crear y publicar un evento `capacity=10`, waitlist on.
2. `/reservas/nuevo` → Tipo de servicio **Evento HUB** → aparece «Evento del calendario» → elegir el evento (la fecha de la reserva salta a la del evento). Nombre + 6 personas → guardar → toast **confirmada**.
3. Otra reserva «Evento HUB» al mismo evento, 6 personas → toast **lista de espera (puesto 1)**.
4. `/eventos`: el pill muestra `… 6/10` y `+6`. Entrar al evento: las 2 reservas aparecen por nombre con tag **Mesa** (una en Reservas, otra en Waitlist).
5. Cancelar la primera (libera 6) → la segunda se **promueve** a confirmada (recargar detalle/calendario).
6. Con un segundo tenant, su evento no aparece en el desplegable.

- [ ] **Step 3: README de la feature**

Actualizar/crear un breve README de la feature (p. ej. `docs/reservas-evento-hub.md`) con: qué hace, cómo se usa (Evento HUB → elegir evento), y el modelo (espejo en `event_attendees`).

```bash
git add docs/reservas-evento-hub.md
git commit -m "docs(reservas): README feature reservas↔eventos"
```

- [ ] **Step 4: Finalizar la branch**

Usar la skill `superpowers:finishing-a-development-branch` para abrir PR de `feat/reservas-evento-hub` → `main` con la descripción + smoke documentado (DoD §10).

---

## Self-Review (checklist contra el spec)

- **§3 modelo de datos** → Task 1 (columnas, índices). ✓
- **§4 RPCs** → Task 1 (link/unlink). ✓
- **§5 sincronización** → Task 5 (create/update/cancel). ✓
- **§6 estado en el espejo** → no hay write-back; el detalle lee del espejo (Task 3/9). ✓
- **§7 form** → Task 6 (bloque + fija fecha) + Task 7 (carga). ✓
- **§8 zod** → Task 2. ✓
- **§9 calendario + detalle** → Task 8 + Task 9. ✓
- **§10 query** → Task 3 (`listLinkableHubEvents`). ✓
- **§11 RLS/permisos** → RPCs con chequeo de rol; Task 10 valida aislamiento. ✓
- **§12 tipos** → Task 1 Step 3 + Task 3 Step 1. ✓
- **§13 tests** → Task 2 (unit) + Task 10 (RLS). ✓
- **§14 casos borde** → guests>capacity, relink (unlink+link), evento no publicado: cubiertos en RPC + Task 5/10. ✓

**Type consistency:** `HubEventOption` (definido Task 3, usado Task 6/7) · `ReservationRow.display_name`/`source` (Task 3, usado Task 9) · `hub_event_id` en schema (Task 2), type (Task 3), form (Task 6), páginas (Task 7), RPC params `p_reservation_id`/`p_event_id` (Task 1, usados Task 5/10). Coherentes.

**Placeholders:** ninguno — todo el código está completo salvo dos adiciones de campo mecánicas señaladas explícitamente (`RESERVATION_JOIN_SELECT`/`flattenReservation` en Task 3 Step 2, y `defaultValues` en Task 6 Step 3), que replican un campo hermano existente (`scheduled_event_id`).
