-- ============================================================
-- Administración · Sueldos (en blanco / en negro, horas extra, período) y lo que sale de la caja del salón
-- ============================================================
-- Pedido de los socios (22/11/2026): «en sueldos, opción en blanco y en negro», «tiene que haber una
-- opción de "hora extra" […] se registra en SUELDOS como horas extra pagadas del mes», «agregar una
-- opción con fechas para el pago de sueldos» y «si pongo adelanto de sueldo [en la caja], debe dar la
-- apertura del personal para cargar el adelanto y que se cargue».
--
-- Qué trae:
--   1. El sueldo de cada mes se puede partir: cuánto va en blanco y cuánto en negro. El total sigue
--      siendo `salary_cents` (nada de lo que ya lo lee cambia); `off_books_cents` es la parte en negro.
--   2. Cada adelanto o pago dice si fue en blanco o en negro y qué fechas cubre (la quincena, la semana).
--   3. Un movimiento nuevo, «horas extra»: plata que se paga aparte del sueldo. No baja el saldo.
--   4. Los retiros de la caja del salón que dicen para qué fueron (un proveedor, un adelanto, horas
--      extra, un sueldo) se ven desde Administración hasta que tienen su comprobante. La planilla de
--      Sueldos ya los cuenta desde que salen de la caja, para que «cuánto le debo» esté al día.
--
-- Las horas extra van como una marca (`overtime`) sobre un movimiento de tipo pago: así no hay que
-- tocar el `check` que ya existe. Para afuera (el informe, la app) el tipo es `overtime`.
-- `acc_report_payroll` y `acc_save_employee_salary` se parchan sobre su definición vigente: al informe
-- se le suman claves; una app que no las conoce sigue leyendo lo mismo.
-- Depende de las dos anteriores (`pos_revisiones_socios`: las columnas de la caja; `acc_accesos_por_nivel`:
-- `acc_assert_buyer_writer`). No agrega claves foráneas.

set local lock_timeout = '5s';

create function pg_temp.acc_pay_patch(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_hits integer := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
begin
  if v_hits <> 1 then
    raise exception 'acc_pay_patch: el fragmento aparece % veces en % (tenía que ser una)', v_hits, p_fn;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.acc_employee_salaries
  add column off_books_cents bigint not null default 0,
  add constraint aes_off_books check (off_books_cents >= 0 and off_books_cents <= salary_cents);
comment on column public.acc_employee_salaries.off_books_cents is
  'La parte del sueldo que va en negro. La parte en blanco es salary_cents - off_books_cents.';

alter table public.acc_payroll_movements
  add column off_books boolean not null default false,
  add column overtime boolean not null default false,
  add column period_from date,
  add column period_to date,
  add constraint apm_period check (period_from is null or period_to is null or period_to >= period_from),
  add constraint apm_overtime_kind check (not overtime or kind = 'payment');
comment on column public.acc_payroll_movements.off_books is 'El adelanto, el pago o las horas extra fueron en negro.';
comment on column public.acc_payroll_movements.overtime is
  'Horas extra: plata que se paga aparte del sueldo (no baja el saldo). Se guarda como un pago con esta marca; el informe lo muestra como tipo overtime.';
comment on column public.acc_payroll_movements.period_from is 'Desde qué día cubre el pago (la quincena, la semana). Vacío = el mes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guardar el sueldo en dos partes
-- ─────────────────────────────────────────────────────────────────────────────
-- Función nueva (la anterior, de un solo importe, queda para la app que todavía la usa: guarda el
-- total y deja la parte en negro como estaba, recortada si el total bajó).
create function public.acc_save_employee_salary_parts(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_month date,
  p_declared_cents bigint,
  p_off_books_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_month date := date_trunc('month', p_month)::date;
  v_declared bigint := coalesce(p_declared_cents, 0);
  v_off bigint := coalesce(p_off_books_cents, 0);
begin
  perform public.acc_assert_writer(p_tenant_id);
  if v_declared not between 0 and 1000000000000000 then
    perform private.acc_raise('invalid_payload', '{"field":"declared_cents"}');
  end if;
  if v_off not between 0 and 1000000000000000 or v_declared + v_off > 1000000000000000 then
    perform private.acc_raise('invalid_payload', '{"field":"off_books_cents"}');
  end if;
  if not exists (select 1 from public.acc_employees e where e.id = p_employee_id and e.tenant_id = p_tenant_id) then
    perform private.acc_raise('invalid_payload', '{"field":"employee_id"}');
  end if;
  insert into public.acc_employee_salaries (tenant_id, employee_id, month, salary_cents, off_books_cents, updated_by)
  values (p_tenant_id, p_employee_id, v_month, v_declared + v_off, v_off, v_uid)
  on conflict (tenant_id, employee_id, month) do update
    set salary_cents = excluded.salary_cents, off_books_cents = excluded.off_books_cents,
        updated_by = excluded.updated_by, updated_at = now();
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_employee.salary_saved', 'acc_employees', p_employee_id,
    jsonb_build_object('month', v_month, 'parts', true));
  return jsonb_build_object('month', v_month);
end;
$$;

-- La de siempre: si el total baja por debajo de la parte en negro, la parte en negro se recorta.
select pg_temp.acc_pay_patch(
  'public.acc_save_employee_salary(uuid, uuid, date, bigint)'::regprocedure,
  $old$set salary_cents = excluded.salary_cents, updated_by = excluded.updated_by, updated_at = now();$old$,
  $new$set salary_cents = excluded.salary_cents,
        off_books_cents = least(public.acc_employee_salaries.off_books_cents, excluded.salary_cents),
        updated_by = excluded.updated_by, updated_at = now();$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Anotar a quién corresponde un movimiento de sueldos (ahora con horas extra, parte y período)
-- ─────────────────────────────────────────────────────────────────────────────
-- Función nueva; `acc_payroll_prepare_movement` (adelanto o pago, sin más datos) queda igual.
create function public.acc_payroll_prepare(
  p_tenant_id uuid,
  p_client_ref uuid,
  p_employee_id uuid,
  p_month date,
  p_kind text,
  p_off_books boolean default false,
  p_period_from date default null,
  p_period_to date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_kind is null or p_kind not in ('advance', 'payment', 'overtime') or p_client_ref is null then
    perform private.acc_raise('invalid_payload', '{"field":"kind"}');
  end if;
  if p_period_from is not null and p_period_to is not null and p_period_to < p_period_from then
    perform private.acc_raise('invalid_payload', '{"field":"period_to"}');
  end if;
  if not exists (select 1 from public.acc_employees e where e.id = p_employee_id and e.tenant_id = p_tenant_id) then
    perform private.acc_raise('invalid_payload', '{"field":"employee_id"}');
  end if;
  insert into public.acc_payroll_movements (tenant_id, employee_id, month, kind, overtime, client_ref, created_by,
                                            off_books, period_from, period_to)
  values (p_tenant_id, p_employee_id, date_trunc('month', p_month)::date,
          case when p_kind = 'overtime' then 'payment' else p_kind end, p_kind = 'overtime',
          p_client_ref, (select auth.uid()), coalesce(p_off_books, false), p_period_from, p_period_to)
  on conflict (tenant_id, client_ref) do nothing;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La planilla: la parte en negro, las horas extra, el período y lo que salió de la caja del salón
-- ─────────────────────────────────────────────────────────────────────────────
-- 4.1 Cada movimiento trae si fue en negro y qué fechas cubre; las horas extra salen con su propio tipo
--     (así «adelantos» y «pagado», que filtran por tipo, no las cuentan).
select pg_temp.acc_pay_patch(
  'public.acc_report_payroll(uuid, date, uuid)'::regprocedure,
  $old$select m.employee_id, m.kind, d.id as document_id, d.accounting_date, d.total_cents, d.seq,$old$,
  $new$select m.employee_id, case when m.overtime then 'overtime' else m.kind end as kind,
           m.off_books, m.period_from, m.period_to,
           d.id as document_id, d.accounting_date, d.total_cents, d.seq,$new$
);
-- 4.2 El sueldo trae su parte en negro (la del mismo renglón que da el total).
select pg_temp.acc_pay_patch(
  'public.acc_report_payroll(uuid, date, uuid)'::regprocedure,
  $old$order by s.month desc limit 1), 0)::bigint as salary_cents$old$,
  $new$order by s.month desc limit 1), 0)::bigint as salary_cents,
           coalesce((select s.off_books_cents from public.acc_employee_salaries s
                      where s.tenant_id = e.tenant_id and s.employee_id = e.id and s.month <= v_month
                      order by s.month desc limit 1), 0)::bigint as off_books_cents$new$
);
-- 4.3 Por empleado: la parte en negro del sueldo, lo pagado en negro, las horas extra del mes y lo
--     que salió de la caja del salón para él y todavía no tiene comprobante. La contadora no lee la
--     caja del salón (está aislada de todo lo que no es Administración): para ella esa lista va vacía.
select pg_temp.acc_pay_patch(
  'public.acc_report_payroll(uuid, date, uuid)'::regprocedure,
  $old$'salary_cents', sal.salary_cents,$old$,
  $new$'salary_cents', sal.salary_cents,
           'salary_off_books_cents', sal.off_books_cents,
           'overtime_cents', coalesce((select sum(mov.total_cents) from mov
                                        where mov.employee_id = e.id and mov.kind = 'overtime'), 0),
           'settled_off_books_cents', coalesce((select sum(mov.total_cents) from mov
                                                 where mov.employee_id = e.id and mov.off_books
                                                   and mov.kind in ('advance', 'payment')), 0),
           'pending_cash', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', pm.id, 'purpose', pm.purpose, 'amount_cents', pm.amount_cents, 'date', sh.service_day,
                      'branch_id', pm.branch_id, 'by_name', pm.created_by_name,
                      'period_from', pm.period_from, 'period_to', pm.period_to) order by pm.created_at)
               from public.pos_cash_movements pm
               join public.pos_shifts sh on sh.id = pm.shift_id
              where pm.tenant_id = e.tenant_id and pm.employee_id = e.id and pm.kind = 'out'
                and pm.purpose in ('advance', 'overtime', 'salary')
                and pm.voided_at is null and pm.acc_dismissed_at is null and not sh.is_practice
                and date_trunc('month', sh.service_day)::date = v_month
                and not exists (select 1 from public.acc_bundles b2
                                  join public.acc_documents d2 on d2.bundle_id = b2.id and d2.tenant_id = b2.tenant_id
                                                               and d2.status = 'posted'
                                 where b2.tenant_id = pm.tenant_id and b2.client_ref = pm.acc_client_ref)), '[]'::jsonb),$new$
);
-- 4.4 Cada movimiento de la lista, con su parte y su período.
select pg_temp.acc_pay_patch(
  'public.acc_report_payroll(uuid, date, uuid)'::regprocedure,
  $old$'amount_cents', mov.total_cents, 'treasury', mov.treasury_name)$old$,
  $new$'amount_cents', mov.total_cents, 'treasury', mov.treasury_name,
                                     'off_books', mov.off_books, 'period_from', mov.period_from,
                                     'period_to', mov.period_to)$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Lo que salió de la caja del salón y espera su comprobante
-- ─────────────────────────────────────────────────────────────────────────────
-- Un retiro «espera» mientras no esté descartado ni exista un comprobante vigente con su referencia.
-- Si el comprobante después se anula, vuelve a esperar: la plata salió igual del cajón.
create function private.acc_pos_cash_waits(p_movement public.pos_cash_movements)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_movement.purpose is not null and p_movement.kind = 'out'
     and p_movement.voided_at is null and p_movement.acc_dismissed_at is null
     and not exists (select 1 from public.acc_bundles b
                       join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id and d.status = 'posted'
                      where b.tenant_id = p_movement.tenant_id and b.client_ref = p_movement.acc_client_ref);
$$;

-- La bandeja. La ve quien carga en Administración: con «solo compras y pagos», los de proveedores;
-- con acceso completo, también los del personal. (La contadora no: es plata del salón.)
create function public.acc_pos_cash_pending(p_tenant_id uuid, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full boolean;
begin
  perform public.acc_assert_buyer_writer(p_tenant_id);
  v_full := p_tenant_id in (select public.acc_writer_tenant_ids());
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'at', m.created_at, 'date', sh.service_day, 'shift_label', sh.label,
             'branch_id', m.branch_id, 'branch', b.name,
             'purpose', m.purpose, 'amount_cents', m.amount_cents, 'reason', m.reason,
             'party_id', m.party_id, 'party_name', m.party_name,
             'employee_id', m.employee_id, 'employee_name', m.employee_name,
             'period_from', m.period_from, 'period_to', m.period_to,
             'by_name', m.created_by_name, 'has_photo', m.photo_path is not null
           ) order by m.created_at), '[]'::jsonb)
      from public.pos_cash_movements m
      join public.branches b on b.id = m.branch_id
      join public.pos_shifts sh on sh.id = m.shift_id
     where m.tenant_id = p_tenant_id
       and (v_full or m.purpose = 'supplier')
       and not sh.is_practice
       and (p_branch_id is null or m.branch_id = p_branch_id)
       and private.acc_pos_cash_waits(m)
  );
end;
$$;

-- Quién puede tocar un retiro: los de proveedores, quien carga compras; los del personal, solo quien
-- tiene acceso completo. Devuelve el renglón bloqueado.
create function private.acc_pos_cash_for_update(p_tenant_id uuid, p_movement_id uuid)
returns public.pos_cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pos_cash_movements;
begin
  perform public.acc_assert_buyer_writer(p_tenant_id);
  select * into v_row
    from public.pos_cash_movements m
   where m.id = p_movement_id and m.tenant_id = p_tenant_id
     and m.purpose is not null and m.kind = 'out' and m.voided_at is null
     for update;
  if not found then
    perform private.acc_raise('invalid_payload', '{"field":"movement_id"}');
  end if;
  if v_row.purpose <> 'supplier' then
    perform public.acc_assert_writer(p_tenant_id);
  end if;
  return v_row;
end;
$$;

-- Atar un retiro al comprobante que se está por guardar. Se llama ANTES de guardar: si el comprobante
-- no se guarda, el retiro sigue esperando; si se guarda, deja de esperar solo.
create function public.acc_pos_cash_link(p_tenant_id uuid, p_movement_id uuid, p_client_ref uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pos_cash_movements;
begin
  if p_client_ref is null then
    perform private.acc_raise('invalid_payload', '{"field":"client_ref"}');
  end if;
  v_row := private.acc_pos_cash_for_update(p_tenant_id, p_movement_id);
  if v_row.acc_client_ref is distinct from p_client_ref and v_row.acc_dismissed_at is null
     and not private.acc_pos_cash_waits(v_row) then
    perform private.acc_raise('pos_cash_already_passed', null);
  end if;
  update public.pos_cash_movements m
     set acc_client_ref = p_client_ref, acc_dismissed_at = null, acc_dismissed_by = null
   where m.id = v_row.id;
end;
$$;

-- «Esto no va a los libros» (se anotó mal, ya estaba cargado por otro lado).
create function public.acc_pos_cash_dismiss(p_tenant_id uuid, p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.pos_cash_movements;
begin
  v_row := private.acc_pos_cash_for_update(p_tenant_id, p_movement_id);
  if not private.acc_pos_cash_waits(v_row) then
    return;
  end if;
  update public.pos_cash_movements m
     set acc_dismissed_at = now(), acc_dismissed_by = v_uid
   where m.id = v_row.id;
  perform private.acc_audit(p_tenant_id, v_uid, 'pos_cash.dismissed', 'pos_cash_movements', v_row.id,
    jsonb_build_object('purpose', v_row.purpose));
end;
$$;

revoke all on function private.acc_pos_cash_waits(public.pos_cash_movements) from public, anon, authenticated;
revoke all on function private.acc_pos_cash_for_update(uuid, uuid) from public, anon, authenticated;
revoke all on function public.acc_save_employee_salary_parts(uuid, uuid, date, bigint, bigint) from public, anon;
revoke all on function public.acc_payroll_prepare(uuid, uuid, uuid, date, text, boolean, date, date) from public, anon;
revoke all on function public.acc_pos_cash_pending(uuid, uuid) from public, anon;
revoke all on function public.acc_pos_cash_link(uuid, uuid, uuid) from public, anon;
revoke all on function public.acc_pos_cash_dismiss(uuid, uuid) from public, anon;
grant execute on function public.acc_save_employee_salary_parts(uuid, uuid, date, bigint, bigint) to authenticated;
grant execute on function public.acc_payroll_prepare(uuid, uuid, uuid, date, text, boolean, date, date) to authenticated;
grant execute on function public.acc_pos_cash_pending(uuid, uuid) to authenticated;
grant execute on function public.acc_pos_cash_link(uuid, uuid, uuid) to authenticated;
grant execute on function public.acc_pos_cash_dismiss(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
