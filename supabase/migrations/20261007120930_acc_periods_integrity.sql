-- Parte 4 de 4 de la migración #10 (acc_periods): integridad (A.6, F.14) y el detector de privilegios.
-- Usa acc_compute_iva_position y acc_period_snapshot_hash (parte 1) y private.acc_reconcile_fiscal (#9).
-- Los revoke/grant de cada función viajan con ella; esta es la última parte (notify pgrst al final).
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #10 (acc_periods) · spec §A.6, §F.14, §B.9, §I.1
-- ============================================================
-- ─── 9. Integridad (A.6) ─────────────────────────────────────────────────────
-- Las ocho invariantes, una fila por chequeo: (check_key, ok, detail). SECURITY DEFINER de solo lectura
-- (desvío: la spec la quería INVOKER, pero necesita private.acc_reconcile_fiscal y
-- private.acc_period_snapshot_hash, y authenticated no tiene USAGE en private): empieza con
-- acc_assert_reader y filtra todo por p_tenant_id. Volatile porque concilia cada comprobante fiscal en su
-- propio bloque de excepción (un desvío no corta los demás chequeos).
--   entries_balanced          · asientos vigentes con 2+ líneas y Σ debe = Σ haber = total
--   documents_match_entries   · un asiento por comprobante con su estado; renglón ↔ línea 1:1 (cuenta, lado,
--                               importe, partícipe y vencimiento); ninguna línea de otro comprobante
--   allocations_valid         · Σ imputaciones vigentes ≤ importe; misma cuenta y partícipe; lados; asientos vigentes
--   fiscal_vouchers_reconcile · cada comprobante con libro IVA concilia (acc_reconcile_fiscal; las anulaciones
--                               de meses cerrados no: sus filas negative_row son copia de las del original);
--                               libro ↔ estado y mes del libro = mes contable
--   iva_books_match_ledger    · por mes, libros IVA = mayor salvo los asientos listados (acc_compute_iva_position)
--   closed_periods_intact     · numerados en los cerrados; 1..N sin huecos (con el N° 1 reservado) y en orden
--                               (entry_date, order_key, posting_seq); snapshot_hash recalculado = guardado
--   entries_within_dates      · nada antes de books_start_date (salvo la apertura espejo) ni fuera de su período
--   entries_period_kind       · los períodos especiales solo con sus tipos de asiento
create function public.acc_check_integrity(p_tenant_id uuid)
returns table (check_key text, ok boolean, detail jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_n integer;
  v_m integer;
  v_ids jsonb;
  v_more jsonb;
  v_fails jsonb := '[]';
  v_doc record;
  v_err text;
  v_det text;
begin
  perform public.acc_assert_reader(p_tenant_id);

  -- 1
  select count(*)::int, coalesce(jsonb_agg(x.id order by x.posting_seq) filter (where x.rn <= 20), '[]'::jsonb)
    into v_n, v_ids
    from (select e.id, e.posting_seq, row_number() over (order by e.posting_seq) as rn
            from public.acc_journal_entries e
            left join lateral (select count(*) as n,
                                      coalesce(sum(l.amount_cents) filter (where l.side = 'debit'), 0) as d,
                                      coalesce(sum(l.amount_cents) filter (where l.side = 'credit'), 0) as c
                                 from public.acc_journal_lines l where l.entry_id = e.id) s on true
           where e.tenant_id = p_tenant_id and e.status = 'posted'
             and (s.n < 2 or s.d <> s.c or s.d <> e.total_cents)) x;
  check_key := 'entries_balanced'; ok := v_n = 0;
  detail := jsonb_build_object('count', v_n, 'entry_ids', v_ids);
  return next;

  -- 2
  select count(*)::int, coalesce(jsonb_agg(x.id order by x.seq) filter (where x.rn <= 20), '[]'::jsonb)
    into v_n, v_ids
    from (select d.id, d.seq, row_number() over (order by d.seq) as rn
            from public.acc_documents d
           where d.tenant_id = p_tenant_id
             and ((select count(*) from public.acc_journal_entries e where e.document_id = d.id) <> 1
                  or exists (select 1 from public.acc_journal_entries e where e.document_id = d.id and e.status <> d.status)
                  or exists (select 1 from public.acc_document_lines dl
                              where dl.document_id = d.id
                                and not exists (select 1 from public.acc_journal_lines jl
                                                 where jl.document_line_id = dl.id and jl.document_id = d.id
                                                   and jl.account_id = dl.account_id and jl.side = dl.side
                                                   and jl.amount_cents = dl.amount_cents
                                                   and jl.party_id is not distinct from dl.party_id
                                                   and jl.due_date is not distinct from
                                                       (case when dl.party_id is null then null
                                                             else coalesce(dl.due_date, d.due_date) end)))
                  or exists (select 1 from public.acc_journal_lines jl
                               join public.acc_journal_entries e on e.id = jl.entry_id
                               left join public.acc_document_lines dl on dl.id = jl.document_line_id
                              where jl.document_id = d.id
                                and (e.document_id <> d.id or dl.document_id is distinct from d.id)))) x;
  check_key := 'documents_match_entries'; ok := v_n = 0;
  detail := jsonb_build_object('count', v_n, 'document_ids', v_ids);
  return next;

  -- 3
  with al as (
    select a.* from public.acc_allocations a where a.tenant_id = p_tenant_id
  ), ovr as (
    select x.line_id
      from (select al.debit_line_id as line_id, al.amount_cents from al where al.voided_on is null
            union all
            select al.credit_line_id, al.amount_cents from al where al.voided_on is null) x
      join public.acc_journal_lines l on l.id = x.line_id
     group by x.line_id, l.amount_cents
    having sum(x.amount_cents) > l.amount_cents
  ), bad as (
    select al.id
      from al
      join public.acc_journal_lines d on d.id = al.debit_line_id
      join public.acc_journal_lines c on c.id = al.credit_line_id
      join public.acc_journal_entries de on de.id = d.entry_id
      join public.acc_journal_entries ce on ce.id = c.entry_id
     where d.side <> 'debit' or c.side <> 'credit'
        or d.account_id <> al.account_id or c.account_id <> al.account_id
        or d.party_id is distinct from al.party_id or c.party_id is distinct from al.party_id
        or (al.voided_on is null and (de.status <> 'posted' or ce.status <> 'posted' or de.is_mirror or ce.is_mirror))
  )
  select (select count(*) from ovr)::int, (select count(*) from bad)::int,
         (select coalesce(jsonb_agg(o.line_id), '[]'::jsonb) from (select ovr.line_id from ovr limit 20) o),
         (select coalesce(jsonb_agg(b.id), '[]'::jsonb) from (select bad.id from bad limit 20) b)
    into v_n, v_m, v_ids, v_more;
  check_key := 'allocations_valid'; ok := v_n + v_m = 0;
  detail := jsonb_build_object('over_allocated_count', v_n, 'over_allocated_line_ids', v_ids,
                               'invalid_count', v_m, 'invalid_allocation_ids', v_more);
  return next;

  -- 4
  v_n := 0;
  for v_doc in
    select d.id, d.seq
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.status = 'posted' and d.kind <> 'reversal'
       and (d.kind = 'sales_close'
            or exists (select 1 from public.acc_fiscal_vouchers f where f.document_id = d.id and f.tenant_id = p_tenant_id))
     order by d.seq
  loop
    begin
      perform private.acc_reconcile_fiscal(p_tenant_id, v_doc.id);
    exception when others then
      v_n := v_n + 1;
      if v_n <= 20 then
        get stacked diagnostics v_err = message_text, v_det = pg_exception_detail;
        v_fails := v_fails || jsonb_build_object('document_id', v_doc.id, 'document_seq', v_doc.seq,
                                                 'error', v_err, 'detail', nullif(v_det, ''));
      end if;
    end;
  end loop;
  select count(*)::int into v_m
    from public.acc_fiscal_vouchers f
    join public.acc_documents d on d.id = f.document_id
   where f.tenant_id = p_tenant_id
     and ((d.status = 'voided') <> f.voided or f.period_month <> date_trunc('month', d.accounting_date)::date);
  check_key := 'fiscal_vouchers_reconcile'; ok := v_n + v_m = 0;
  detail := jsonb_build_object('count', v_n, 'documents', v_fails, 'voucher_status_mismatch_count', v_m);
  return next;

  -- 5
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object(
           'month', y.month,
           'unexplained_vat_credit_cents', y.r -> 'unexplained_vat_credit_cents',
           'unexplained_vat_debit_cents', y.r -> 'unexplained_vat_debit_cents') order by y.month), '[]'::jsonb)
    into v_n, v_ids
    from (select p.month, public.acc_compute_iva_position(p_tenant_id, p.month) -> 'reconciliation' as r
            from public.acc_periods p
           where p.tenant_id = p_tenant_id and p.kind = 'month'
             and exists (select 1 from public.acc_journal_entries e
                          where e.tenant_id = p_tenant_id and e.period_id = p.id)) y
   where not coalesce((y.r ->> 'fully_explained')::boolean, true);
  check_key := 'iva_books_match_ledger'; ok := v_n = 0;
  detail := jsonb_build_object('count', v_n, 'months', v_ids);
  return next;

  -- 6
  select count(*)::int into v_n
    from public.acc_journal_entries e
    join public.acc_periods p on p.id = e.period_id
   where e.tenant_id = p_tenant_id and p.status = 'closed' and e.status = 'posted' and e.number is null;
  select count(*)::int into v_m
    from (select f.id
            from public.acc_fiscal_years f
            join public.acc_journal_entries e on e.fiscal_year_id = f.id and e.number is not null
           where f.tenant_id = p_tenant_id
           group by f.id, f.opening_number_reserved
          having min(e.number) <> 1 + (case when f.opening_number_reserved
                                              and not exists (select 1 from public.acc_journal_entries o
                                                               where o.fiscal_year_id = f.id and o.status = 'posted'
                                                                 and o.kind in ('opening', 'fy_opening'))
                                            then 1 else 0 end)
              or max(e.number) - min(e.number) + 1 <> count(*)
          union all
          select z.fiscal_year_id
            from (select e.fiscal_year_id,
                         row_number() over (partition by e.fiscal_year_id order by e.number) as a,
                         row_number() over (partition by e.fiscal_year_id
                                            order by e.entry_date, e.order_key, e.posting_seq) as b
                    from public.acc_journal_entries e
                   where e.tenant_id = p_tenant_id and e.number is not null) z
           where z.a <> z.b) q;
  select coalesce(jsonb_agg(h.id order by h.starts_on), '[]'::jsonb) into v_ids
    from (select p.id, p.starts_on
            from public.acc_periods p
           where p.tenant_id = p_tenant_id and p.status = 'closed'
             and private.acc_period_snapshot_hash(p.id) is distinct from p.snapshot_hash) h;
  check_key := 'closed_periods_intact'; ok := v_n = 0 and v_m = 0 and jsonb_array_length(v_ids) = 0;
  detail := jsonb_build_object('unnumbered_count', v_n, 'numbering_issues', v_m, 'hash_mismatch_period_ids', v_ids);
  return next;

  -- 7
  select count(*)::int, coalesce(jsonb_agg(x.id) filter (where x.rn <= 20), '[]'::jsonb) into v_n, v_ids
    from (select e.id, row_number() over (order by e.posting_seq) as rn
            from public.acc_journal_entries e
            join public.acc_periods p on p.id = e.period_id
            join public.acc_settings s on s.tenant_id = e.tenant_id
           where e.tenant_id = p_tenant_id
             and ((e.entry_date < s.books_start_date and e.kind <> 'fy_opening')
                  or e.entry_date not between p.starts_on and p.ends_on
                  or e.fiscal_year_id <> p.fiscal_year_id)) x;
  check_key := 'entries_within_dates'; ok := v_n = 0;
  detail := jsonb_build_object('count', v_n, 'entry_ids', v_ids);
  return next;

  -- 8
  select count(*)::int, coalesce(jsonb_agg(x.id) filter (where x.rn <= 20), '[]'::jsonb) into v_n, v_ids
    from (select e.id, row_number() over (order by e.posting_seq) as rn
            from public.acc_journal_entries e
            join public.acc_periods p on p.id = e.period_id
           where e.tenant_id = p_tenant_id
             and ((p.kind = 'fy_adjustments' and e.kind not in ('fy_adjustment', 'fy_result', 'fy_closing'))
                  or (p.kind = 'fy_opening' and e.kind <> 'fy_opening')
                  or (p.kind = 'month' and e.kind in ('fy_adjustment', 'fy_result', 'fy_closing', 'fy_opening')))) x;
  check_key := 'entries_period_kind'; ok := v_n = 0;
  detail := jsonb_build_object('count', v_n, 'entry_ids', v_ids);
  return next;
end;
$$;

-- F.14: la pantalla Ajustes › Integridad (INVOKER: lee lo mismo que acc_check_integrity).
create function public.acc_report_integrity(p_tenant_id uuid)
returns table (check_key text, ok boolean, detail jsonb)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  return query select c.check_key, c.ok, c.detail from public.acc_check_integrity(p_tenant_id) c;
end;
$$;

-- F.14: recalcula el hash de cada período cerrado (Libros › Cierres lo muestra en rojo si no da).
-- SECURITY DEFINER de solo lectura por la misma razón que acc_check_integrity.
create function public.acc_report_verify_closed_periods(p_tenant_id uuid)
returns table (period_id uuid, label text, ok boolean, stored_hash text, current_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  return query
  select x.id, x.label, x.cur = x.snapshot_hash, x.snapshot_hash, x.cur
    from (select p.id, p.snapshot_hash, p.kind, p.month, p.starts_on,
                 case p.kind
                   when 'month' then initcap((array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                                                    'agosto', 'septiembre', 'octubre', 'noviembre',
                                                    'diciembre'])[extract(month from p.month)::int])
                                     || ' ' || extract(year from p.month)::int::text
                   when 'fy_adjustments' then 'Ajustes de cierre ' || extract(year from p.ends_on)::int::text
                   else 'Apertura ' || extract(year from p.starts_on)::int::text end as label,
                 private.acc_period_snapshot_hash(p.id) as cur
            from public.acc_periods p
           where p.tenant_id = p_tenant_id and p.status = 'closed') x
   order by x.starts_on, (x.kind <> 'fy_opening'), x.month;
end;
$$;

-- ─── 10. Detector de privilegios (I.1 #10; deben ser 0 filas; solo service_role) ───
-- Tablas/vistas/secuencias acc_* con permisos para anon o de escritura para authenticated; funciones acc_* de
-- public ejecutables por anon; funciones de private ejecutables por anon o authenticated; y
-- private.acc_reset_tenant ejecutable por alguien que no sea postgres (o con otro dueño).
create function public.acc_privilege_gaps()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select format('table:%s:%s', c.relname, r.rolname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'::name), ('authenticated'::name)) as r(rolname)
   where n.nspname = 'public' and c.relname like 'acc\_%' escape '\' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (case when r.rolname = 'anon'
               then pg_catalog.has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    or pg_catalog.has_any_column_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
               else pg_catalog.has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    or pg_catalog.has_any_column_privilege(r.rolname, c.oid, 'INSERT, UPDATE, REFERENCES') end)
  union all
  select format('sequence:%s:%s', c.relname, r.rolname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'::name), ('authenticated'::name)) as r(rolname)
   where n.nspname = 'public' and c.relname like 'acc\_%' escape '\' and c.relkind = 'S'
     and pg_catalog.has_sequence_privilege(r.rolname, c.oid, 'USAGE, SELECT, UPDATE')
  union all
  select format('function:%s(%s):anon', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'acc\_%' escape '\'
     and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  union all
  select format('private:%s(%s):%s', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), r.rolname)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'::name), ('authenticated'::name)) as r(rolname)
   where n.nspname = 'private' and pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  union all
  select format('reset:%s', coalesce(g.rolname::text, 'PUBLIC'))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as a
    left join pg_catalog.pg_roles g on g.oid = a.grantee
   where n.nspname = 'private' and p.proname = 'acc_reset_tenant' and a.privilege_type = 'EXECUTE'
     and a.grantee is distinct from (select o.oid from pg_catalog.pg_roles o where o.rolname = 'postgres')
  union all
  select format('reset-owner:%s', pg_catalog.pg_get_userbyid(p.proowner))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'acc_reset_tenant'
     and pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
$$;

comment on function public.acc_check_integrity(uuid) is
  'Las ocho invariantes de A.6 (check_key, ok, detail). Definer de solo lectura: acc_assert_reader y filtro por bar.';
comment on function public.acc_report_integrity(uuid) is
  'Ajustes › Integridad (F.14): acc_check_integrity para quien lee Administración. INVOKER.';
comment on function public.acc_report_verify_closed_periods(uuid) is
  'Recalcula el snapshot_hash de cada período cerrado (F.14). Definer de solo lectura: acc_assert_reader y filtro por bar.';
comment on function public.acc_privilege_gaps() is
  'Detector (solo service_role): permisos de más sobre tablas y funciones acc_* y private.*. Debe devolver 0 filas.';

revoke all on function public.acc_check_integrity(uuid) from public, anon;
grant execute on function public.acc_check_integrity(uuid) to authenticated;
revoke all on function public.acc_report_integrity(uuid) from public, anon;
grant execute on function public.acc_report_integrity(uuid) to authenticated;
revoke all on function public.acc_report_verify_closed_periods(uuid) from public, anon;
grant execute on function public.acc_report_verify_closed_periods(uuid) to authenticated;
revoke all on function public.acc_privilege_gaps() from public, anon, authenticated;
grant execute on function public.acc_privilege_gaps() to service_role;

notify pgrst, 'reload schema';
