-- ============================================================
-- Punto de venta · revisiones de los socios del 22/11/2026
-- ============================================================
-- Qué trae:
--   1. Carta: lo que «sale primero» en cocina (una entrada) y cuándo se muestra cada rubro (el menú
--      del mediodía de lunes a viernes, el del fin de semana).
--   2. La cola de cocina trae, en cada renglón, el rubro de la carta y si sale primero: la comanda junta
--      «pizzas con pizzas» y pone las entradas arriba.
--   3. La carta del mozo trae el horario de cada rubro.
--   4. La caja: para qué salió la plata. Al sacar plata del cajón se elige el proveedor o el empleado
--      (adelanto, horas extra, pago de sueldo) y queda anotado para pasarlo a Administración.
--   5. La seña de una reserva guarda con qué medio se cobró.
--
-- Todo es aditivo: columnas nuevas (sin reescribir filas) y funciones nuevas. Las dos funciones que
-- cambian (`pos_kitchen_queue`, `pos_menu`) se parchan sobre su definición vigente: se les SUMAN claves
-- al JSON que devuelven, así una app que todavía no las conoce sigue andando igual.
-- No agrega ninguna clave foránea (una segunda relación entre dos tablas rompe los embebidos de PostgREST).

set local lock_timeout = '5s';

-- Reemplaza un fragmento de una función, que tiene que aparecer exactamente una vez.
create function pg_temp.pos_rev_patch(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_hits integer := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
begin
  if v_hits <> 1 then
    raise exception 'pos_rev_patch: el fragmento aparece % veces en % (tenía que ser una)', v_hits, p_fn;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Carta: lo que sale primero y cuándo se muestra cada rubro
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.menu_categories
  add column kitchen_first boolean not null default false,
  add column availability jsonb,
  add constraint menu_categories_availability_shape
    check (availability is null or jsonb_typeof(availability) = 'object');
alter table public.menu_items
  add column kitchen_first boolean;

comment on column public.menu_categories.kitchen_first is
  'Cocina: lo de este rubro sale primero (entradas). Lo heredan sus subrubros y sus productos.';
comment on column public.menu_items.kitchen_first is
  'Cocina: este producto sale primero. Vacío = lo que diga su rubro.';
comment on column public.menu_categories.availability is
  'Cuándo se muestra el rubro en la carta: {"windows":[{"days":[1,2,3,4,5],"from":"12:00","to":"16:00"}]} (días 0=domingo…6=sábado, hora del bar; sin "from"/"to" = todo el día). Vacío = siempre. Lo heredan sus subrubros.';

-- ¿Sale primero? Lo que diga el producto; si no dice nada, que algún rubro de su rama lo tenga marcado.
create function private.pos_item_first(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select c.kitchen_first, c.parent_id as next_id, 0 as depth
      from public.menu_items i
      join public.menu_categories c on c.id = i.category_id
     where i.id = p_item_id
    union all
    select c.kitchen_first, c.parent_id, ch.depth + 1
      from chain ch
      join public.menu_categories c on c.id = ch.next_id
     where ch.depth < 12
  )
  select coalesce(
    (select i.kitchen_first from public.menu_items i where i.id = p_item_id),
    (select bool_or(chain.kitchen_first) from chain),
    false
  );
$$;

-- El lugar de un rubro en la carta, en un número: el de su raíz, después el suyo (hasta tres niveles).
-- Sirve para que la comanda liste los rubros en el mismo orden que la carta.
create function private.pos_category_order(p_category_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select c.position, c.parent_id as next_id, 0 as depth
      from public.menu_categories c
     where c.id = p_category_id
    union all
    select c.position, c.parent_id, ch.depth + 1
      from chain ch
      join public.menu_categories c on c.id = ch.next_id
     where ch.depth < 12
  ),
  path as (
    -- nivel 1 = la raíz
    select least(greatest(position, 0), 998)::bigint as position,
           row_number() over (order by depth desc) as level
      from chain
  )
  -- Los niveles de abajo suman uno: lo que cuelga directo de un rubro va antes que sus subrubros.
  select coalesce(sum(case level when 1 then position * 1000000 when 2 then (position + 1) * 1000
                               when 3 then position + 1 else 0 end), 0)::bigint
    from path;
$$;

revoke all on function private.pos_item_first(uuid) from public, anon, authenticated;
revoke all on function private.pos_category_order(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La cola de cocina: cada renglón con su rubro y si sale primero
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.pos_rev_patch(
  'public.pos_kitchen_queue(uuid)'::regprocedure,
  $old$'prep_status', ti.prep_status, 'started_at', ti.started_at, 'ready_at', ti.ready_at$old$,
  $new$'prep_status', ti.prep_status, 'started_at', ti.started_at, 'ready_at', ti.ready_at,
            'category_id', mi.category_id,
            'category', (select mc.name from public.menu_categories mc where mc.id = mi.category_id),
            'category_order', private.pos_category_order(mi.category_id),
            'priority', private.pos_item_first(mi.id)$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La carta del mozo: cada rubro con su horario
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.pos_rev_patch(
  'public.pos_menu(uuid)'::regprocedure,
  $old$'position', c.position, 'station_id', c.station_id$old$,
  $new$'position', c.position, 'station_id', c.station_id,
        'availability', c.availability, 'kitchen_first', c.kitchen_first$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La caja: para qué salió la plata
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin claves foráneas a Administración a propósito: el nombre queda copiado en el renglón (un retiro
-- anotado no cambia porque después se renombre o se borre el proveedor) y el id se valida al anotar.
alter table public.pos_cash_movements
  add column purpose text
    check (purpose is null or purpose in ('supplier', 'advance', 'overtime', 'salary')),
  add column party_id uuid,
  add column party_name text check (party_name is null or char_length(party_name) <= 160),
  add column employee_id uuid,
  add column employee_name text check (employee_name is null or char_length(employee_name) <= 120),
  add column period_from date,
  add column period_to date,
  add column acc_client_ref uuid,
  add column acc_dismissed_at timestamptz,
  add column acc_dismissed_by uuid,
  add constraint pos_cash_movements_purpose_who check (
    purpose is null
    or (purpose = 'supplier' and employee_id is null)
    or (purpose in ('advance', 'overtime', 'salary') and employee_id is not null and party_id is null)
  ),
  add constraint pos_cash_movements_period check (
    period_from is null or period_to is null or period_to >= period_from
  );
create index pos_cash_movements_acc_pending_idx
  on public.pos_cash_movements (tenant_id, created_at)
  where purpose is not null and acc_dismissed_at is null and voided_at is null;

comment on column public.pos_cash_movements.purpose is
  'Para qué salió la plata: supplier (pago a un proveedor), advance (adelanto de sueldo), overtime (horas extra), salary (pago de sueldo). Vacío = texto libre.';
comment on column public.pos_cash_movements.acc_client_ref is
  'La referencia del comprobante de Administración que registra este retiro. «Ya pasó» = existe un comprobante vigente con esa referencia; si se anula, vuelve a esperar.';
comment on column public.pos_cash_movements.acc_dismissed_at is
  'Cuándo alguien de Administración dijo que este retiro no va a los libros. Vacío = espera (si tiene purpose y no pasó).';

-- A quién se le puede pagar desde el cajón: proveedores y empleados, SOLO nombres. Lo lee quien
-- atiende la caja (no hace falta acceso a Administración: no hay montos, sueldos ni saldos).
-- Si el bar no usa Administración, las listas vienen vacías y la caja sigue con texto libre.
create function public.pos_cash_targets(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_on boolean;
begin
  select * into v_branch from public.branches b where b.id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier');
  select (t.feature_flags -> 'accounting') = 'true'::jsonb
         and exists (select 1 from public.acc_settings s where s.tenant_id = t.id)
    into v_on
    from public.tenants t where t.id = v_branch.tenant_id;
  if not coalesce(v_on, false) then
    return jsonb_build_object('suppliers', '[]'::jsonb, 'employees', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'suppliers', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(btrim(p.trade_name), ''), p.name))
                                order by lower(coalesce(nullif(btrim(p.trade_name), ''), p.name))), '[]'::jsonb)
        from public.acc_parties p
       where p.tenant_id = v_branch.tenant_id and p.kind = 'supplier' and p.active and p.system_key is null
    ),
    'employees', (
      -- Primero los de esta sucursal; los de las otras también se pueden elegir (cubren turnos).
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'here', e.branch_id = v_branch.id)
                                order by (e.branch_id = v_branch.id) desc, e.sort, lower(e.name)), '[]'::jsonb)
        from public.acc_employees e
       where e.tenant_id = v_branch.tenant_id and e.active
    )
  );
end;
$$;

-- Plata que entra o sale del cajón, diciendo para qué. Es `pos_cash_movement` con tres datos más; la
-- anterior queda como está (la app vieja la sigue usando mientras se despliega la nueva).
create function public.pos_cash_move(
  p_shift_id uuid,
  p_kind text,
  p_amount_cents bigint,
  p_reason text default null,
  p_purpose text default null,
  p_party_id uuid default null,
  p_employee_id uuid default null,
  p_period_from date default null,
  p_period_to date default null,
  p_photo_path text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts%rowtype;
  v_uid uuid := (select auth.uid());
  v_note text := nullif(left(btrim(coalesce(p_reason, '')), 160), '');
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_party_name text;
  v_employee_name text;
  v_reason text;
  v_id uuid;
begin
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id;
  if not found then
    raise exception 'shift_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_shift.tenant_id, 'owner', 'cashier');
  if p_kind is null or p_kind not in ('in', 'out') then
    raise exception 'movement_kind_invalid' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000000 then
    raise exception 'amount_invalid' using errcode = '22023';
  end if;
  if v_purpose is not null and (p_kind <> 'out' or v_purpose not in ('supplier', 'advance', 'overtime', 'salary')) then
    raise exception 'purpose_invalid' using errcode = '22023';
  end if;
  if v_photo is not null and (
    char_length(v_photo) > 300 or v_photo like '%..%' or v_photo not like v_shift.tenant_id::text || '/%'
  ) then
    raise exception 'photo_path_invalid' using errcode = '22023';
  end if;
  if v_key is not null and char_length(v_key) not between 8 and 80 then
    raise exception 'idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_period_from is not null and p_period_to is not null and p_period_to < p_period_from then
    raise exception 'period_invalid' using errcode = '22023';
  end if;

  -- A quién: tiene que ser del mismo bar. El nombre se copia al renglón.
  if v_purpose = 'supplier' then
    if p_employee_id is not null then
      raise exception 'purpose_invalid' using errcode = '22023';
    end if;
    if p_party_id is not null then
      select coalesce(nullif(btrim(p.trade_name), ''), p.name) into v_party_name
        from public.acc_parties p
       where p.id = p_party_id and p.tenant_id = v_shift.tenant_id and p.kind = 'supplier';
      if v_party_name is null then
        raise exception 'party_not_found' using errcode = 'P0002';
      end if;
    end if;
    -- Un proveedor que no está en la lista se anota por su nombre (el texto), y se resuelve al pasarlo.
    if p_party_id is null and v_note is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    v_reason := 'Proveedor · ' || coalesce(v_party_name, v_note)
                || case when v_party_name is not null and v_note is not null then ' · ' || v_note else '' end;
  elsif v_purpose in ('advance', 'overtime', 'salary') then
    if p_party_id is not null or p_employee_id is null then
      raise exception 'employee_required' using errcode = '22023';
    end if;
    select e.name into v_employee_name
      from public.acc_employees e
     where e.id = p_employee_id and e.tenant_id = v_shift.tenant_id;
    if v_employee_name is null then
      raise exception 'employee_not_found' using errcode = 'P0002';
    end if;
    v_reason := case v_purpose when 'advance' then 'Adelanto de sueldo' when 'overtime' then 'Horas extra'
                               else 'Pago de sueldo' end
                || ' · ' || v_employee_name
                || case when v_note is not null then ' · ' || v_note else '' end;
  else
    if p_party_id is not null or p_employee_id is not null then
      raise exception 'purpose_invalid' using errcode = '22023';
    end if;
    v_reason := v_note;
  end if;
  v_reason := nullif(left(coalesce(v_reason, ''), 200), '');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  -- Bloqueado contra un cierre simultáneo: lo que se anota entra en el arqueo o no se anota.
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id for share;
  if v_key is not null then
    select m.id into v_id
      from public.pos_cash_movements m
     where m.shift_id = p_shift_id and m.idempotency_key = v_key;
    if v_id is not null then
      return jsonb_build_object('movement_id', v_id, 'duplicate', true);
    end if;
  end if;
  if v_shift.status <> 'open' then
    raise exception 'shift_not_open' using errcode = '55000';
  end if;

  insert into public.pos_cash_movements (
    tenant_id, branch_id, shift_id, kind, amount_cents, reason, photo_path, idempotency_key, created_by,
    created_by_name, purpose, party_id, party_name, employee_id, employee_name, period_from, period_to
  ) values (
    v_shift.tenant_id, v_shift.branch_id, p_shift_id, p_kind, p_amount_cents, v_reason, v_photo, v_key, v_uid,
    private.pos_actor_name(v_shift.tenant_id, v_uid), v_purpose, p_party_id,
    case when v_purpose = 'supplier' then coalesce(v_party_name, v_note) end,
    p_employee_id, v_employee_name,
    case when v_purpose in ('advance', 'overtime', 'salary') then p_period_from end,
    case when v_purpose in ('advance', 'overtime', 'salary') then p_period_to end
  )
  on conflict (shift_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    -- Dos reintentos a la vez con la misma clave: entró el otro.
    select m.id into v_id
      from public.pos_cash_movements m
     where m.shift_id = p_shift_id and m.idempotency_key = v_key;
    return jsonb_build_object('movement_id', v_id, 'duplicate', true);
  end if;

  perform private.pos_poke(v_shift.branch_id, 'cash', null);
  return jsonb_build_object('movement_id', v_id, 'duplicate', false);
end;
$$;

revoke all on function public.pos_cash_targets(uuid) from public, anon;
revoke all on function public.pos_cash_move(uuid, text, bigint, text, text, uuid, uuid, date, date, text, text)
  from public, anon;
grant execute on function public.pos_cash_targets(uuid) to authenticated;
grant execute on function public.pos_cash_move(uuid, text, bigint, text, text, uuid, uuid, date, date, text, text)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La seña de una reserva: con qué medio se cobró
-- ─────────────────────────────────────────────────────────────────────────────
-- Columna nueva sin valor por defecto: no reescribe la tabla ni inunda el tiempo real.
alter table public.salon_reservations
  add column deposit_method text
    check (deposit_method is null or deposit_method in ('cash', 'transfer', 'qr', 'debit', 'credit', 'other'));
comment on column public.salon_reservations.deposit_method is
  'Con qué se cobró la seña (los mismos medios que el punto de venta). Vacío = no se anotó; una seña de una compra online queda vacía (se sabe por la compra).';

-- La cuenta de la mesa dice con qué se cobró la seña que se le descuenta.
select pg_temp.pos_rev_patch(
  'public.pos_bill(uuid)'::regprocedure,
  $old$'deposit_cents', r.deposit_cents,$old$,
  $new$'deposit_cents', r.deposit_cents, 'deposit_method', r.deposit_method,$new$
);

notify pgrst, 'reload schema';
