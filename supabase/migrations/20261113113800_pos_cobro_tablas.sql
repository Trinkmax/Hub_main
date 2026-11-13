-- Punto de venta, parte 2: cobrar la mesa y la caja por turno (docs/features/pos.md).
--
-- La mesa pide la cuenta y paga; la plata entra a una caja que se abre y se cierra por turno.
--   · la cuenta: consumo − descuentos − la seña de la reserva = lo que falta, siempre arriba;
--   · se paga en partes (iguales, por producto o por monto) y cada parte con su medio;
--   · el recargo de crédito va solo sobre la parte que se paga con crédito, y lo calcula la base;
--   · «facturar» se decide en cada cobro (el efectivo arranca en no); la venta cuenta igual;
--   · la propina se anota aparte: no es venta ni entra en el efectivo que tiene que haber en el cajón;
--   · cuando no queda nada por cobrar la mesa se cierra sola y el socio suma sus puntos sin que nadie
--     escriba un monto;
--   · descuentos y bajas: quien puede dar el OK los aplica directo; el resto los pide y alguien los
--     aprueba con un toque. Todo deja quién fue;
--   · la caja: se abre confirmando lo que dejó el turno anterior, anota lo que entra y lo que sale, y se
--     cierra contando los billetes. Un cobro mal cargado se corrige (no se borra) y queda escrito quién
--     y cuándo; con el turno cerrado solo lo corrige un dueño.
--
-- Qué toca de lo que ya existe: NADA de estructura. Son tablas y funciones nuevas. Lee `table_sessions`,
-- `tickets`, `ticket_items`, `salon_reservations` y `pos_settings`, y escribe donde ya escriben
-- `mark_session_paid` y `pos_cancel_item`: cierra la mesa (`table_sessions`), anota la visita y los puntos
-- (`visits`, `visit_items`, `points_transactions`), cierra la reserva sentada, deja el evento
-- `session_paid` y da de baja un renglón cuando se aprueba (`ticket_items`, `tickets`).
-- Las funciones `pos_*` de la parte 1 no se redefinen.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ayudas internas
-- ─────────────────────────────────────────────────────────────────────────────

-- El nombre con el que se muestra a alguien del equipo («Corregido por Juan»). Misma regla que usa
-- Administración: el nombre de gestor, el del usuario o lo que va antes de la arroba.
create function private.pos_actor_name(p_tenant_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then 'Sistema'
    else left(coalesce(
      (select nullif(btrim(rm.display_name), '')
         from public.reservation_managers rm
        where rm.tenant_id = p_tenant_id and rm.user_id = p_user_id
        order by rm.active desc, rm.created_at asc
        limit 1),
      (select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
         from auth.users u where u.id = p_user_id),
      (select nullif(split_part(coalesce(u.email::text, ''), '@', 1), '')
         from auth.users u where u.id = p_user_id),
      'Sin nombre'), 60)
  end;
$$;

-- Los ajustes del bar; si todavía no los cargó, los de fábrica (los mismos valores por defecto de la tabla).
create function private.pos_settings_for(p_tenant_id uuid)
returns public.pos_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.pos_settings%rowtype;
begin
  select * into v from public.pos_settings s where s.tenant_id = p_tenant_id;
  if not found then
    v.tenant_id := p_tenant_id;
    v.credit_surcharge_bp := 0;
    v.invoice_by_method :=
      '{"cash": false, "transfer": true, "qr": true, "debit": true, "credit": true, "other": false}'::jsonb;
    v.tip_presets_pct := '{10}';
    v.approver_roles := '{owner,cashier}';
    v.discount_needs_approval := true;
    v.void_needs_approval := true;
    v.bill_denominations := '{20000,10000,2000,1000,500,200,100}';
  end if;
  return v;
end;
$$;

-- Quién da el OK a descuentos y bajas: el dueño siempre, y los roles que el bar eligió. Quien puede
-- aprobar no necesita pedir: aplica directo.
create function private.pos_is_approver(p_tenant_id uuid, p_role public.tenant_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_role = 'owner' or p_role::text = any ((private.pos_settings_for(p_tenant_id)).approver_roles);
$$;

-- «$ 12.500», para los textos que arma la base (el pedido de aprobación).
create function private.pos_money(p_cents bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select '$ ' || replace(to_char(round(p_cents / 100.0), 'FM999,999,999,990'), ',', '.');
$$;

-- «Descuento 10 %» / «Descuento $ 5.000». El porcentaje va en puntos básicos (1000 = 10 %).
create function private.pos_discount_label(p_kind text, p_value bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select 'Descuento ' || case
    when p_kind = 'percent' and p_value % 100 = 0 then (p_value / 100)::text || ' %'
    when p_kind = 'percent' then replace(rtrim(to_char(p_value / 100.0, 'FM990.00'), '0'), '.', ',') || ' %'
    else private.pos_money(p_value)
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cajas y turnos
-- ─────────────────────────────────────────────────────────────────────────────
-- Una caja es un cajón con plata en una sucursal. Casi todos los bares tienen una sola: se crea sola
-- («Caja») la primera vez que se abre un turno.
create table public.pos_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 30), -- «Caja», «Caja barra»
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_registers_id_tenant_uq unique (id, tenant_id),
  constraint pos_registers_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict
);
create unique index pos_registers_name_uq on public.pos_registers (branch_id, lower(btrim(name)));
create index pos_registers_tenant_idx on public.pos_registers (tenant_id);
create trigger pos_registers_updated_at before update on public.pos_registers
  for each row execute function public.set_updated_at();
comment on table public.pos_registers is
  'Punto de venta: cajas (cajones con plata) de cada sucursal. La primera se crea sola al abrir el primer turno.';

create table public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  -- El día de servicio en que se abrió (hasta las 5 sigue siendo la noche anterior).
  service_day date not null,
  label text check (label is null or char_length(btrim(label)) between 1 and 30), -- «Mediodía», «Noche»
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Turno de práctica: para aprender a abrir, cobrar y cerrar. No entra en ningún número ni encadena
  -- su cambio con los turnos de verdad.
  is_practice boolean not null default false,
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete set null,
  opened_by_name text not null,
  -- Lo que quien abre dice que hay en el cajón…
  opening_float_cents bigint not null check (opening_float_cents between 0 and 100000000000),
  -- …y lo que el turno anterior dijo que dejaba (vacío si es el primero de esa caja).
  opening_expected_cents bigint,
  opening_note text check (opening_note is null or char_length(opening_note) <= 300),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_name text,
  -- El arqueo: lo contado billete por billete, y contra qué se comparó en ese momento.
  counted_cash_cents bigint check (counted_cash_cents is null or counted_cash_cents between 0 and 100000000000),
  -- { "bills": [{ "value": 20000, "count": 3 }, …], "other_cents": 0 } — `value` en pesos.
  count_breakdown jsonb check (count_breakdown is null or jsonb_typeof(count_breakdown) = 'object'),
  expected_cash_cents bigint,
  difference_cents bigint,
  -- Lo que queda de cambio para el turno que sigue; el resto se retira.
  leave_float_cents bigint check (leave_float_cents is null or leave_float_cents >= 0),
  closing_note text check (closing_note is null or char_length(closing_note) <= 300),
  -- La foto del turno al cerrar: por medio, propinas, descuentos, bajas y correcciones, con quién hizo cada cosa.
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_shifts_id_tenant_uq unique (id, tenant_id),
  constraint pos_shifts_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_shifts_register_fk foreign key (register_id, tenant_id)
    references public.pos_registers (id, tenant_id) on delete restrict,
  constraint pos_shifts_closed_chk check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null and counted_cash_cents is not null
        and expected_cash_cents is not null and difference_cents is not null and leave_float_cents is not null)
  )
);
-- Un turno abierto por caja (el de práctica va por su carril).
create unique index pos_shifts_one_open_uq on public.pos_shifts (register_id, is_practice) where status = 'open';
create index pos_shifts_branch_idx on public.pos_shifts (branch_id, opened_at desc);
create index pos_shifts_tenant_idx on public.pos_shifts (tenant_id);
create trigger pos_shifts_updated_at before update on public.pos_shifts
  for each row execute function public.set_updated_at();
comment on table public.pos_shifts is
  'Punto de venta: turnos de caja. Se abre con el cambio que dejó el anterior y se cierra con el arqueo y el resumen.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cobros
-- ─────────────────────────────────────────────────────────────────────────────
-- Una mesa tiene N cobros: cada parte con su medio. Nada se borra: un cobro se anula (con motivo) mientras
-- la mesa sigue abierta, o se corrige el medio después (queda en pos_payment_edits).
create table public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  -- El turno al que entró. Solo un cobro de práctica puede no tener turno.
  shift_id uuid,
  service_day date not null,
  method text not null check (method in ('cash', 'transfer', 'qr', 'debit', 'credit', 'other')),
  -- Lo que este cobro baja de la cuenta. El recargo y la propina van aparte: no son venta.
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  surcharge_cents bigint not null default 0 check (surcharge_cents >= 0),
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  -- Efectivo: con cuánto pagó y el vuelto. Vacío = pagó justo.
  tendered_cents bigint check (tendered_cents is null or tendered_cents >= 0),
  change_cents bigint not null default 0 check (change_cents >= 0),
  invoice boolean not null,
  payer_label text check (payer_label is null or char_length(payer_label) <= 60), -- «Juan», «Parte 2 de 4»
  -- División por producto: los renglones que cubre. Un renglón repetido = varias unidades de ese renglón.
  item_ids uuid[] not null default '{}',
  reference text check (reference is null or char_length(reference) <= 80), -- cupón, últimos 4, n.º de operación
  status text not null default 'ok' check (status in ('ok', 'voided')),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_by_name text,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  is_practice boolean not null default false,
  -- Reintentar sin señal nunca cobra dos veces.
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_payments_id_tenant_uq unique (id, tenant_id),
  constraint pos_payments_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_payments_shift_fk foreign key (shift_id, tenant_id)
    references public.pos_shifts (id, tenant_id) on delete restrict,
  constraint pos_payments_shift_chk check (shift_id is not null or is_practice),
  constraint pos_payments_void_chk check (
    (status = 'ok' and voided_at is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)
  ),
  constraint pos_payments_surcharge_chk check (surcharge_cents = 0 or method = 'credit'),
  constraint pos_payments_cash_chk check (method = 'cash' or (tendered_cents is null and change_cents = 0))
);
create unique index pos_payments_idem_uq on public.pos_payments (session_id, idempotency_key)
  where idempotency_key is not null;
create index pos_payments_session_idx on public.pos_payments (session_id, created_at);
create index pos_payments_shift_idx on public.pos_payments (shift_id, created_at) where shift_id is not null;
create index pos_payments_branch_day_idx on public.pos_payments (branch_id, service_day, created_at desc);
create index pos_payments_tenant_idx on public.pos_payments (tenant_id);
create trigger pos_payments_updated_at before update on public.pos_payments
  for each row execute function public.set_updated_at();
comment on table public.pos_payments is
  'Punto de venta: cobros de una mesa. amount_cents es lo que baja de la cuenta; recargo y propina van aparte.';
comment on column public.pos_payments.item_ids is
  'División por producto: renglones (ticket_items) que cubre el cobro. Repetido = varias unidades.';

-- Historial de correcciones de un cobro. No se edita ni se borra: «Corregido por Juan 23:41: Transferencia → Efectivo».
create table public.pos_payment_edits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null,
  field text not null check (field in ('method', 'invoice', 'surcharge_cents')),
  old_value text not null,
  new_value text not null,
  note text check (note is null or char_length(note) <= 200),
  -- Se corrigió con el turno ya cerrado (solo un dueño).
  shift_closed boolean not null default false,
  edited_by uuid references auth.users(id) on delete set null,
  edited_by_name text not null,
  created_at timestamptz not null default now(),
  constraint pos_payment_edits_payment_fk foreign key (payment_id, tenant_id)
    references public.pos_payments (id, tenant_id) on delete cascade
);
create index pos_payment_edits_payment_idx on public.pos_payment_edits (payment_id, created_at);
create index pos_payment_edits_tenant_idx on public.pos_payment_edits (tenant_id);
comment on table public.pos_payment_edits is
  'Punto de venta: cada corrección de un cobro (medio, facturar, recargo) con quién y cuándo. Solo se agrega.';

-- Plata que entra o sale del cajón sin ser un cobro: sacar para pagar el hielo, sumar cambio.
create table public.pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  shift_id uuid not null,
  kind text not null check (kind in ('in', 'out')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  -- Foto del comprobante: ruta dentro del bucket, siempre bajo la carpeta del bar.
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  -- Con fecha = se anotó por error. No se borra.
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_by_name text,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  constraint pos_cash_movements_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_cash_movements_shift_fk foreign key (shift_id, tenant_id)
    references public.pos_shifts (id, tenant_id) on delete restrict
);
create unique index pos_cash_movements_idem_uq on public.pos_cash_movements (shift_id, idempotency_key)
  where idempotency_key is not null;
create index pos_cash_movements_shift_idx on public.pos_cash_movements (shift_id, created_at);
create index pos_cash_movements_tenant_idx on public.pos_cash_movements (tenant_id);
comment on table public.pos_cash_movements is
  'Punto de venta: plata que entra o sale del cajón sin ser un cobro (con motivo y, si hay, foto).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Aprobaciones y descuentos
-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que alguien del salón pidió y espera el OK de quien puede darlo (pos_settings.approver_roles).
create table public.pos_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  -- discount = un descuento a la mesa · void_item = dar de baja un renglón que cocina ya empezó.
  kind text not null check (kind in ('discount', 'void_item')),
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  -- discount: { kind, value, reason } · void_item: { item_id, reason, name, quantity, amount_cents }
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  summary text not null check (char_length(btrim(summary)) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text not null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 200),
  constraint pos_approvals_id_tenant_uq unique (id, tenant_id),
  constraint pos_approvals_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_approvals_decided_chk check ((status = 'pending') = (decided_at is null))
);
create index pos_approvals_pending_idx on public.pos_approvals (branch_id, requested_at) where status = 'pending';
create index pos_approvals_session_idx on public.pos_approvals (session_id);
create index pos_approvals_branch_idx on public.pos_approvals (branch_id, requested_at desc);
create index pos_approvals_tenant_idx on public.pos_approvals (tenant_id);
comment on table public.pos_approvals is
  'Punto de venta: pedidos de descuento o de baja que esperan el OK de un encargado, con quién pidió y quién decidió.';

create table public.pos_discounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  kind text not null check (kind in ('percent', 'amount')),
  -- percent: puntos básicos (1000 = 10 %) · amount: centavos.
  value bigint not null check (value between 1 and 100000000000),
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  -- No se borra: se quita, y queda quién.
  status text not null default 'active' check (status in ('active', 'removed')),
  -- El pedido que lo originó, si lo pidió alguien que no podía aplicarlo solo.
  approval_id uuid,
  created_by uuid references auth.users(id) on delete set null, -- quien lo aplicó o lo pidió
  created_by_name text not null,
  approved_by_name text, -- quien dio el OK, si hizo falta
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  removed_by_name text,
  constraint pos_discounts_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_discounts_approval_fk foreign key (approval_id, tenant_id)
    references public.pos_approvals (id, tenant_id) on delete set null (approval_id),
  constraint pos_discounts_percent_chk check (kind <> 'percent' or value <= 10000),
  constraint pos_discounts_removed_chk check ((status = 'removed') = (removed_at is not null))
);
create index pos_discounts_session_idx on public.pos_discounts (session_id) where status = 'active';
create index pos_discounts_tenant_idx on public.pos_discounts (tenant_id);
comment on table public.pos_discounts is
  'Punto de venta: descuentos de una mesa (porcentaje en puntos básicos o monto en centavos), con motivo y quién.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La cuenta cerrada
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por mesa cobrada, con los números como quedaron ese día. Hace falta por tres cosas:
--   · la seña de una reserva no se descuenta dos veces si la reserva se vuelve a sentar;
--   · la cuenta de una mesa cerrada no cambia aunque después alguien edite la seña o un descuento;
--   · el per cápita y los reportes leen una fila por mesa, sin rearmar la cuenta desde las comandas.
create table public.pos_closed_bills (
  session_id uuid primary key references public.table_sessions(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  -- El turno en el que se cerró (vacío si no había ninguno abierto: seña que cubre todo, o práctica).
  shift_id uuid,
  reservation_id uuid references public.salon_reservations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  service_day date not null,
  party_size integer,
  subtotal_cents bigint not null check (subtotal_cents >= 0), -- consumo
  discount_cents bigint not null check (discount_cents >= 0),
  deposit_cents bigint not null check (deposit_cents >= 0),   -- lo que se usó de la seña
  due_cents bigint not null check (due_cents >= 0),           -- consumo − descuentos − seña
  -- Los puntos que sumó el socio de la mesa.
  visit_id uuid references public.visits(id) on delete set null,
  points_awarded integer not null default 0,
  points_failed boolean not null default false,
  is_practice boolean not null default false,
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_name text not null,
  closed_at timestamptz not null default now(),
  constraint pos_closed_bills_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint pos_closed_bills_shift_fk foreign key (shift_id, tenant_id)
    references public.pos_shifts (id, tenant_id) on delete restrict
);
create index pos_closed_bills_branch_day_idx on public.pos_closed_bills (branch_id, service_day);
create index pos_closed_bills_shift_idx on public.pos_closed_bills (shift_id) where shift_id is not null;
create index pos_closed_bills_reservation_idx on public.pos_closed_bills (reservation_id)
  where reservation_id is not null;
create index pos_closed_bills_customer_idx on public.pos_closed_bills (customer_id)
  where customer_id is not null;
create index pos_closed_bills_visit_idx on public.pos_closed_bills (visit_id)
  where visit_id is not null;
create index pos_closed_bills_tenant_idx on public.pos_closed_bills (tenant_id);
comment on table public.pos_closed_bills is
  'Punto de venta: la cuenta de cada mesa cobrada, como quedó al cerrar (consumo, descuentos, seña usada, puntos).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: la plata la lee dueño y caja; nadie escribe directo (todo entra por las funciones)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pos_registers enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_payments enable row level security;
alter table public.pos_payment_edits enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_approvals enable row level security;
alter table public.pos_discounts enable row level security;
alter table public.pos_closed_bills enable row level security;

-- Las cajas son configuración: las ve el salón y las arma el dueño (se desactivan, no se borran).
create policy pos_registers_read on public.pos_registers for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'host'));
create policy pos_registers_owner_insert on public.pos_registers for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy pos_registers_owner_update on public.pos_registers for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pos_shifts_read on public.pos_shifts for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
create policy pos_payments_read on public.pos_payments for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
create policy pos_payment_edits_read on public.pos_payment_edits for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
create policy pos_cash_movements_read on public.pos_cash_movements for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
create policy pos_closed_bills_read on public.pos_closed_bills for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
-- Descuentos y pedidos los ve todo el salón: el mozo sigue el suyo.
create policy pos_approvals_read on public.pos_approvals for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'host'));
create policy pos_discounts_read on public.pos_discounts for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'host'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'pos_registers', 'pos_shifts', 'pos_payments', 'pos_payment_edits', 'pos_cash_movements',
    'pos_approvals', 'pos_discounts', 'pos_closed_bills'
  ]
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
         with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))',
      t || '_no_accountant', t);
  end loop;
end $$;

-- Las tablas nuevas nacen con permisos de escritura por defecto: se sacan, y se da solo lo que hace falta.
revoke all on
  public.pos_registers, public.pos_shifts, public.pos_payments, public.pos_payment_edits,
  public.pos_cash_movements, public.pos_approvals, public.pos_discounts, public.pos_closed_bills
  from anon, authenticated;
-- De una caja se cambia el nombre, el orden y si está activa: no se muda de sucursal (sus turnos quedarían
-- colgando de otra).
grant select, insert on public.pos_registers to authenticated;
grant update (name, position, active) on public.pos_registers to authenticated;
grant select on
  public.pos_shifts, public.pos_payments, public.pos_payment_edits, public.pos_cash_movements,
  public.pos_approvals, public.pos_discounts, public.pos_closed_bills
  to authenticated;
grant select, insert, update, delete on
  public.pos_registers, public.pos_shifts, public.pos_payments, public.pos_payment_edits,
  public.pos_cash_movements, public.pos_approvals, public.pos_discounts, public.pos_closed_bills
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de las funciones de este tramo
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function private.pos_actor_name(uuid, uuid) from public, anon, authenticated;
revoke all on function private.pos_settings_for(uuid) from public, anon, authenticated;
revoke all on function private.pos_is_approver(uuid, public.tenant_role) from public, anon, authenticated;
revoke all on function private.pos_money(bigint) from public, anon, authenticated;
revoke all on function private.pos_discount_label(text, bigint) from public, anon, authenticated;
