-- Ventas: objetivo por día y «ventas contra caja» (pedido de los socios de HUB del 12/10/2026, puntos 4 y 5).
--   · acc_sales_targets: lo que se quiere vender cada día (el objetivo de su planilla de proyección) y una
--     nota del día («2x1 burger», «Día de la madre»). Una fila por día.
--   · acc_daily_cash_counts: lo que entró de verdad ese día en cada caja o banco, cargado a mano, para
--     compararlo con lo vendido en el salón. NO es contable: no genera asientos ni toca los saldos de las cajas.
-- Las dos se leen con la política de lectores y se escriben solo por RPC (definer, con assert de escritura,
-- lock del bar y auditoría). Parte 1 de 2: tablas y escrituras; la parte 2 (20261013120210) trae el reporte.

-- Las FK nuevas toman un lock corto sobre tenants, auth.users y acc_treasury_accounts: si algo está tomado,
-- mejor fallar rápido y reintentar que encolar tráfico detrás de esta migración.
set local lock_timeout = '5s';

-- ─── 1. Objetivo de venta por día ────────────────────────────────────────────
create table public.acc_sales_targets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  target_cents bigint,                               -- null: el día solo tiene nota
  note text,                                         -- «Evento y acciones» de la planilla
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint astg_pk primary key (tenant_id, day),
  constraint astg_target check (target_cents is null or target_cents between 0 and 999999999999),
  constraint astg_note_len check (note is null or char_length(btrim(note)) between 1 and 120),
  constraint astg_not_empty check (target_cents is not null or note is not null)
);
comment on table public.acc_sales_targets is
  'Objetivo de venta por día (proyección de ventas) y la nota del día. Una fila por día; se escribe con acc_save_sales_targets.';
comment on column public.acc_sales_targets.target_cents is 'Lo que se quiere vender ese día, en centavos. null = sin objetivo (la fila guarda solo la nota).';

-- ─── 2. Lo que entró por día en cada caja ────────────────────────────────────
create table public.acc_daily_cash_counts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  treasury_account_id uuid not null,
  amount_cents bigint not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint adcc_pk primary key (tenant_id, day, treasury_account_id),
  constraint adcc_amount check (amount_cents between 0 and 999999999999),
  -- Con cascade: si la caja se borra (reinicio antes del primer cierre), lo anotado para ella se va con ella.
  constraint adcc_treasury_same_tenant foreign key (treasury_account_id, tenant_id)
    references public.acc_treasury_accounts (id, tenant_id) on delete cascade
);
create index adcc_treasury_idx on public.acc_daily_cash_counts (treasury_account_id, tenant_id);
comment on table public.acc_daily_cash_counts is
  'Lo que entró de verdad cada día en cada caja o banco, cargado a mano, para comparar con las ventas de salón. No es contable: no mueve saldos.';

-- ─── 3. RLS y permisos: leen los lectores, nadie escribe directo ─────────────
do $$
declare
  r record;
begin
  for r in select * from (values ('acc_sales_targets', 'astg'), ('acc_daily_cash_counts', 'adcc')) as x(tbl, prefix)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon, authenticated', r.tbl);
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id in (select public.acc_reader_tenant_ids()))',
      r.prefix || '_select_readers', r.tbl);
  end loop;
end $$;

-- ─── 4. Guardar objetivos (uno o un mes entero) ──────────────────────────────
-- p_items: hasta 62 {day, target_cents?, note?}. Viaja solo lo que cambia: sin la clave `note` la nota queda
-- como estaba (pegar la lista de objetivos de un mes no borra las notas) y sin `target_cents`, el objetivo.
-- target_cents null saca el objetivo; si el día queda sin objetivo y sin nota, la fila se borra.
create function public.acc_save_sales_targets(p_tenant_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_day date;
  v_days date[] := '{}';
  v_old public.acc_sales_targets;
  v_target bigint;
  v_note text;
  v_saved int := 0;
  v_deleted int := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 62 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
  end if;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item) k where k not in ('day', 'target_cents', 'note')) > 0
       or not (v_item ? 'target_cents' or v_item ? 'note') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
    end if;
    v_day := private.acc_to_date(v_item ->> 'day');
    if v_day is null or v_day not between date '2000-01-01' and date '2100-12-31' or v_day = any (v_days) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'day';
    end if;
    v_days := v_days || v_day;

    v_old := null;
    select * into v_old from public.acc_sales_targets t where t.tenant_id = p_tenant_id and t.day = v_day;
    v_target := v_old.target_cents;
    v_note := v_old.note;
    if v_item ? 'target_cents' then
      if jsonb_typeof(v_item -> 'target_cents') = 'null' then
        v_target := null;
      else
        v_target := private.acc_to_bigint(v_item -> 'target_cents');
        if v_target is null or v_target not between 0 and 999999999999 then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = 'target_cents';
        end if;
      end if;
    end if;
    if v_item ? 'note' then
      if jsonb_typeof(v_item -> 'note') not in ('string', 'null') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'note';
      end if;
      v_note := nullif(btrim(regexp_replace(coalesce(v_item ->> 'note', ''), '\s+', ' ', 'g')), '');
      if char_length(v_note) > 120 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'note';
      end if;
    end if;

    if v_target is null and v_note is null then
      delete from public.acc_sales_targets t where t.tenant_id = p_tenant_id and t.day = v_day;
      if found then
        v_deleted := v_deleted + 1;
      end if;
    else
      insert into public.acc_sales_targets (tenant_id, day, target_cents, note, updated_by, updated_at)
      values (p_tenant_id, v_day, v_target, v_note, v_uid, now())
      on conflict (tenant_id, day) do update
        set target_cents = excluded.target_cents, note = excluded.note,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      v_saved := v_saved + 1;
    end if;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_sales_target.saved', 'acc_sales_target', null,
    jsonb_build_object('from', (select min(d) from unnest(v_days) d), 'to', (select max(d) from unnest(v_days) d),
                       'saved', v_saved, 'deleted', v_deleted));
  return jsonb_build_object('saved', v_saved, 'deleted', v_deleted);
end;
$$;

-- ─── 5. Guardar lo que entró un día (reemplaza lo de ese día) ────────────────
-- p_items: hasta 50 {treasury_account_id, amount_cents}; amount_cents null (o sin la clave) deja esa caja sin
-- cargar. Lo que había para ese día se reemplaza entero. No se anota la tarjeta de la empresa (no es plata que
-- entra) ni un día futuro.
create function public.acc_save_daily_cash(p_tenant_id uuid, p_day date, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_kind text;
  v_amount bigint;
  v_count int := 0;
  v_total bigint := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_day is null or p_day < date '2000-01-01' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'day';
  end if;
  if p_day > public.acc_today(p_tenant_id) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
  end if;

  delete from public.acc_daily_cash_counts c where c.tenant_id = p_tenant_id and c.day = p_day;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item) k where k not in ('treasury_account_id', 'amount_cents')) > 0 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
    end if;
    v_id := private.acc_to_uuid(v_item ->> 'treasury_account_id');
    if v_id is null or v_id = any (v_ids) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
    end if;
    v_ids := v_ids || v_id;
    select t.kind into v_kind from public.acc_treasury_accounts t where t.id = v_id and t.tenant_id = p_tenant_id;
    if not found then
      raise exception 'treasury_not_found' using errcode = 'P0001';
    end if;
    if v_kind = 'credit_card' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
    end if;
    continue when jsonb_typeof(coalesce(v_item -> 'amount_cents', 'null'::jsonb)) = 'null';
    v_amount := private.acc_to_bigint(v_item -> 'amount_cents');
    if v_amount is null or v_amount not between 0 and 999999999999 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'amount_cents';
    end if;
    insert into public.acc_daily_cash_counts (tenant_id, day, treasury_account_id, amount_cents, updated_by, updated_at)
    values (p_tenant_id, p_day, v_id, v_amount, v_uid, now());
    v_count := v_count + 1;
    v_total := v_total + v_amount;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_daily_cash.saved', 'acc_daily_cash', null,
    jsonb_build_object('day', p_day, 'count', v_count, 'total_cents', v_total));
  return jsonb_build_object('day', p_day, 'count', v_count, 'total_cents', v_total);
end;
$$;

-- ─── 6. Comentarios y permisos ───────────────────────────────────────────────
comment on function public.acc_save_sales_targets(uuid, jsonb) is
  'Guarda objetivos de venta por día (hasta 62 {day, target_cents?, note?}; solo cambia las claves que llegan). Devuelve {saved, deleted}.';
comment on function public.acc_save_daily_cash(uuid, date, jsonb) is
  'Reemplaza lo que entró ese día en cada caja ({treasury_account_id, amount_cents}). No es contable. Devuelve {day, count, total_cents}.';

revoke all on function public.acc_save_sales_targets(uuid, jsonb) from public, anon;
grant execute on function public.acc_save_sales_targets(uuid, jsonb) to authenticated;
revoke all on function public.acc_save_daily_cash(uuid, date, jsonb) from public, anon;
grant execute on function public.acc_save_daily_cash(uuid, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
