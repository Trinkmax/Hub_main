# Plan 3 — Cobro de mesa + puntos al cierre

> Plan TDD bite-sized. Implementación en seco hasta que Docker esté disponible.

**Goal:** Cerrar el ciclo monetario y de fidelidad: el mozo marca cobrada, el sistema materializa visits + visit_items por cada comensal registrado, calcula puntos via motor existente, escribe ledger inmutable, rota qr_token, y muestra pantalla de cierre con resumen al comensal.

**Architecture:** Una RPC atómica `mark_session_paid` que reutiliza el motor de puntos existente (`calculate_visit_points`, triggers `points_transactions → customers`). Crea una `visit` por cada `session_guest.customer_id` no nulo, con `visit_items` filtrados por `assigned_to_guest_id`. Items shared (assigned NULL) no generan puntos. Una página nueva del mozo "Cobrar mesa" con desglose por guest. La pantalla del comensal extiende `mesa-screen` para detectar `session_paid` por realtime y mostrar resumen.

**Spec referencia:** §6.1 paso 11, §7.5, §10.

---

## File Structure

### Migraciones
- `supabase/migrations/20260506120000_plan3_mark_session_paid.sql` — RPC `mark_session_paid` + función auxiliar para materializar visits desde session/tickets.

### Lib
- `lib/sessions-waiter/actions.ts` — Server Action `markSessionPaid`.
- `lib/sessions-waiter/queries.ts` extend con `getCobroBreakdown(sessionId)` que retorna desglose de tickets/items por guest, antes del cobro.

### Pages
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/cobrar-dialog.tsx` — Dialog del mozo con breakdown + confirmar.
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/session-detail.tsx` — agregar botón "Cobrar mesa" en header.
- `app/m/[qrToken]/_components/mesa-screen.tsx` — detectar `session.status='paid'` y mostrar `<ClosingScreen>`.
- `app/m/[qrToken]/_components/closing-screen.tsx` — pantalla de cierre con puntos sumados + balance + opt-in marketing nudge.

### Tests
- `tests/rls/cobro.test.ts` — RPC `mark_session_paid` (transitions, points calculation, qr_token rotation, idempotencia).

---

## Tasks

### Task 1: Migration `mark_session_paid` RPC

- [ ] Crear `supabase/migrations/20260506120000_plan3_mark_session_paid.sql` con la lógica atómica:

```sql
-- Plan 3: mark_session_paid — cobro atómico con puntos.
-- Materializa visits + visit_items desde tickets de la sesión.
-- Reutiliza calculate_visit_points y triggers de stats existentes.

create or replace function public.mark_session_paid(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_role text;
  v_new_qr text;
  v_guest record;
  v_visit_id uuid;
  v_total_for_guest bigint;
  v_calc record;
  v_total_points int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_visits_created int := 0;
begin
  -- Lock session
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  -- Idempotente: si ya está paid, devolver el resultado anterior
  if v_session.status = 'paid' then
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'paid',
      'idempotent', true,
      'total_cents', v_session.total_cents
    );
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  -- Verificar role del caller
  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Para cada guest registrado con al menos un item asignado, crear visit
  for v_guest in
    select sg.id as guest_id, sg.customer_id, sg.display_name
    from public.session_guests sg
    where sg.session_id = p_session_id
      and sg.customer_id is not null
  loop
    -- Sumar items asignados a este guest, no cancelados, de tickets no cancelados
    select coalesce(sum(ti.line_total_cents), 0) into v_total_for_guest
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    -- Si no consumió nada propio, saltar (no crear visita vacía)
    if v_total_for_guest = 0 then
      continue;
    end if;

    -- Crear visit. Trigger visits_apply_stats actualiza customer counts.
    insert into public.visits (
      tenant_id, customer_id, visited_at, total_amount_cents, source, created_by
    ) values (
      v_session.tenant_id, v_guest.customer_id, now(), 0, 'cashier', auth.uid()
    ) returning id into v_visit_id;

    -- Insertar visit_items copiando los ticket_items asignados
    insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
    select v_visit_id, ti.menu_item_id, ti.quantity, ti.unit_price_cents, ti.line_total_cents
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    -- Update total_amount_cents (dispara trigger visits_apply_stats)
    update public.visits set total_amount_cents = v_total_for_guest where id = v_visit_id;

    -- Calcular puntos via motor existente
    select * into v_calc from public.calculate_visit_points(v_visit_id);
    if v_calc.delta > 0 then
      insert into public.points_transactions (
        tenant_id, customer_id, visit_id, delta, reason, payload
      ) values (
        v_session.tenant_id, v_guest.customer_id, v_visit_id, v_calc.delta,
        'session_paid', v_calc.breakdown
      );
      v_total_points := v_total_points + v_calc.delta;
      v_breakdown := v_breakdown || jsonb_build_object(
        'guest_id', v_guest.guest_id,
        'customer_id', v_guest.customer_id,
        'display_name', v_guest.display_name,
        'visit_id', v_visit_id,
        'total_cents', v_total_for_guest,
        'points', v_calc.delta,
        'rules', v_calc.breakdown
      );
    end if;

    v_visits_created := v_visits_created + 1;
  end loop;

  -- Marcar sesión paid
  update public.table_sessions
    set status = 'paid',
        paid_at = now(),
        updated_at = now()
    where id = p_session_id;

  -- Rotar qr_token de la mesa física (si tiene una asignada)
  if v_session.physical_table_id is not null then
    v_new_qr := public.generate_qr_token();
    update public.physical_tables
      set qr_token = v_new_qr, updated_at = now()
      where id = v_session.physical_table_id;
  end if;

  -- Emitir evento
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_paid',
    auth.uid(),
    jsonb_build_object(
      'total_cents', v_session.total_cents,
      'visits_created', v_visits_created,
      'total_points', v_total_points,
      'breakdown', v_breakdown
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'paid',
    'idempotent', false,
    'total_cents', v_session.total_cents,
    'visits_created', v_visits_created,
    'total_points', v_total_points,
    'breakdown', v_breakdown
  );
end $$;

revoke all on function public.mark_session_paid(uuid) from public;
grant execute on function public.mark_session_paid(uuid) to authenticated;
```

Commit `feat(plan3): RPC mark_session_paid atómico con puntos via motor existente`.

---

### Task 2: Lib sessions-waiter — `getCobroBreakdown` + `markSessionPaid` action

Append a `lib/sessions-waiter/queries.ts`:

```typescript
export type CobroBreakdownGuest = {
  guest_id: string
  customer_id: string | null
  display_name: string | null
  total_cents: number
  items: Array<{
    name: string
    quantity: number
    line_total_cents: number
  }>
}

export type CobroBreakdown = {
  session_id: string
  total_cents: number
  guests: CobroBreakdownGuest[]
  shared_total_cents: number
  shared_items: Array<{ name: string; quantity: number; line_total_cents: number }>
}

export async function getCobroBreakdown(sessionId: string): Promise<CobroBreakdown | null> {
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, total_cents')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const { data: guests } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  const { data: items } = await supabase
    .from('ticket_items')
    .select('quantity, line_total_cents, assigned_to_guest_id, cancelled_at, menu_items(name), tickets!inner(session_id, status)')
    .eq('tickets.session_id', sessionId)
    .neq('tickets.status', 'cancelled')
    .is('cancelled_at', null)

  type Joined = {
    quantity: number
    line_total_cents: number
    assigned_to_guest_id: string | null
    cancelled_at: string | null
    menu_items: { name: string } | { name: string }[] | null
  }

  const byGuest = new Map<string, CobroBreakdownGuest>()
  for (const g of guests ?? []) {
    byGuest.set(g.id, {
      guest_id: g.id,
      customer_id: g.customer_id,
      display_name: g.display_name,
      total_cents: 0,
      items: [],
    })
  }

  let sharedTotal = 0
  const sharedItems: CobroBreakdown['shared_items'] = []

  for (const raw of items ?? []) {
    const r = raw as unknown as Joined
    const mi = Array.isArray(r.menu_items) ? r.menu_items[0] : r.menu_items
    const name = mi?.name ?? 'Ítem'
    const line = { name, quantity: r.quantity, line_total_cents: r.line_total_cents }
    if (r.assigned_to_guest_id && byGuest.has(r.assigned_to_guest_id)) {
      const g = byGuest.get(r.assigned_to_guest_id)
      if (g) {
        g.items.push(line)
        g.total_cents += r.line_total_cents
      }
    } else {
      sharedItems.push(line)
      sharedTotal += r.line_total_cents
    }
  }

  return {
    session_id: session.id,
    total_cents: session.total_cents,
    guests: Array.from(byGuest.values()),
    shared_total_cents: sharedTotal,
    shared_items: sharedItems,
  }
}
```

Crear `lib/sessions-waiter/actions.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export type MarkPaidResult =
  | {
      ok: true
      sessionId: string
      idempotent: boolean
      totalCents: number
      visitsCreated: number
      totalPoints: number
    }
  | { ok: false; message: string }

async function authorize(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['waiter', 'cashier', 'owner'])
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

export async function markSessionPaid(slug: string, sessionId: string): Promise<MarkPaidResult> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('mark_session_paid', { p_session_id: sessionId })
  if (error) {
    if (error.message.includes('session_not_open')) return { ok: false, message: 'La sesión no está abierta.' }
    if (error.message.includes('session_not_found')) return { ok: false, message: 'Sesión no encontrada.' }
    console.error('[sessions.markPaid]', error.message)
    return { ok: false, message: 'No se pudo cobrar la mesa.' }
  }

  const result = data as {
    session_id: string
    idempotent: boolean
    total_cents: number
    visits_created: number
    total_points: number
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'mark_paid',
    entity: 'table_session',
    entityId: sessionId,
    payload: {
      total_cents: result.total_cents,
      visits_created: result.visits_created,
      total_points: result.total_points,
    },
  })

  revalidatePath(`/${slug}/sesiones`)
  revalidatePath(`/${slug}/sesiones/${sessionId}`)
  return {
    ok: true,
    sessionId: result.session_id,
    idempotent: result.idempotent,
    totalCents: result.total_cents,
    visitsCreated: result.visits_created,
    totalPoints: result.total_points,
  }
}
```

Commit.

---

### Task 3: UI mozo — botón "Cobrar mesa" + dialog de confirmación

Crear `cobrar-dialog.tsx` (client) que muestra el breakdown + botón confirmar.
Modificar `session-detail.tsx` para agregar el botón en el header cuando `session.status === 'open'`.

Commit.

---

### Task 4: UI comensal — pantalla de cierre con resumen

Crear `closing-screen.tsx` que se muestra cuando `state` indica sesión paid (vía realtime).
Modificar `mesa-screen.tsx` para detectar paid y renderizar `ClosingScreen` en lugar de tabs.

Commit.

---

### Task 5: RLS test `mark_session_paid`

Crear `tests/rls/cobro.test.ts`. Cubre: idempotencia, gating por rol, qr_token rotation, points calculation correcta para guests registrados, items shared no generan puntos.

Commit.

---

### Task 6: Smoke doc Plan 3

Crear `docs/superpowers/plans/2026-05-06-plan-3-smoke.md`. Final commit.
