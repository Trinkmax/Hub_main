-- Parte 4 de 4 de la migración #16 (acc_chart_flex): importar un plan de cuentas (acc_import_accounts).
-- Claves de error nuevas (con texto en lib/accounting/errors.ts): import_empty, import_too_many_rows,
-- import_has_errors, import_failed; por fila: account_name_invalid, account_description_invalid,
-- import_duplicate_code, import_parent_not_found, import_parent_has_errors, import_type_required,
-- import_treasury_conflict (más code_invalid, account_move_cycle, account_level_too_deep,
-- account_type_mismatch, account_root_must_be_group, parent_is_postable, account_has_movements,
-- system_account_locked, account_in_use y account_has_children).
--
-- acc_import_accounts(p_tenant_id, p_rows, p_dry_run) → jsonb. Escritor + administrador, bajo el lock del
-- bar, auditado. p_rows = [{code, name, type?, postable?, contra?, parent_code?, description?}] (1..2000;
-- por ejemplo las líneas pegadas «1.1.01.01.001 CAJA»).
--   · Madre: parent_code, o la inferida: el código más largo (del plan o de lo importado) cuyo código
--     significativo (sin los segmentos finales en cero) es prefijo del de la fila: 1.1.01.01.001 →
--     1.1.01.01.000; 1.1.01.01.000 → 1.1.01.00.000; 1.1.01.04 → 1.1.01. Sin madre: raíz (grupo, con tipo).
--   · Tipo: el pedido; si no, el de la madre (una raíz lo necesita). Bajo un grupo de resultados la fila
--     puede ser ingreso o egreso. Lado normal: el del tipo (invertido con contra: true).
--   · Imputable: el pedido; si no, la que no tiene hijas en lo importado (una existente conserva el suyo
--     salvo que lo importado le cuelgue hijas). Las raíces son grupos.
--   · Código que ya existe → se actualiza (nombre, «Para qué se usa» si viene, madre, tipo, imputable);
--     código nuevo → se crea (imputable de egreso: aparece en «¿En qué?»). Nunca borra ni desactiva.
--   · p_dry_run (null = ensayo): devuelve el plan sin escribir; si no hay errores por fila, además lo
--     ensaya entero adentro de un subbloque que se deshace (mismos triggers que el real). Real: con algún
--     error por fila no escribe nada (import_has_errors); si no, aplica y devuelve el mismo resumen.
create function public.acc_import_accounts(p_tenant_id uuid, p_rows jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_dry boolean := coalesce(p_dry_run, true);
  v_n integer;
  v_e jsonb;
  v_key text;
  v_level integer;
  v_errors integer;
  v_cur integer;
  v_cur_code text;
  v_msg text;
  v_state text;
  v_det text;
  v_applied boolean := false;
  v_summary jsonb;
  r record;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform public.acc_assert_admin(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  -- 1. Forma del pedido (un error de forma es del servidor: invalid_payload con el lugar).
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rows';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    raise exception 'import_empty' using errcode = 'P0001';
  end if;
  if v_n > 2000 then
    raise exception 'import_too_many_rows' using errcode = 'P0001',
      detail = jsonb_build_object('max', 2000, 'rows', v_n)::text;
  end if;
  for i in 0 .. v_n - 1 loop
    v_e := p_rows -> i;
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = format('rows[%s]', i + 1);
    end if;
    for v_key in select jsonb_object_keys(v_e) loop
      if v_key not in ('code', 'name', 'type', 'postable', 'contra', 'parent_code', 'description') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = format('rows[%s].%s', i + 1, v_key);
      end if;
    end loop;
    v_key := case
      when jsonb_typeof(v_e -> 'code') is distinct from 'string' then 'code'
      when jsonb_typeof(v_e -> 'name') is distinct from 'string' then 'name'
      when coalesce(jsonb_typeof(v_e -> 'type'), 'null') not in ('null', 'string')
           or (jsonb_typeof(v_e -> 'type') = 'string'
               and (v_e ->> 'type') not in ('asset', 'liability', 'equity', 'income', 'expense')) then 'type'
      when coalesce(jsonb_typeof(v_e -> 'postable'), 'null') not in ('null', 'boolean') then 'postable'
      when coalesce(jsonb_typeof(v_e -> 'contra'), 'null') not in ('null', 'boolean') then 'contra'
      when coalesce(jsonb_typeof(v_e -> 'parent_code'), 'null') not in ('null', 'string') then 'parent_code'
      when coalesce(jsonb_typeof(v_e -> 'description'), 'null') not in ('null', 'string') then 'description'
    end;
    if v_key is not null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = format('rows[%s].%s', i + 1, v_key);
    end if;
  end loop;

  -- 2. El plan: una fila por línea, con la cuenta que ya existe con ese código.
  drop table if exists pg_temp.acc_import_plan;
  drop table if exists pg_temp.acc_import_cand;
  create temporary table acc_import_plan (
    row_no integer primary key,
    code text not null,
    name text not null,
    type_in public.acc_account_type,
    postable_in boolean,
    contra_in boolean,
    parent_code_in text,
    has_desc boolean not null,
    description text,
    node_id uuid not null,
    ex_id uuid,
    ex_name text,
    ex_description text,
    ex_type public.acc_account_type,
    ex_side public.acc_side,
    ex_parent_id uuid,
    ex_parent_code text,
    ex_postable boolean,
    ex_system_key text,
    ex_is_treasury boolean,
    ex_moves boolean,
    ex_in_use boolean,
    parent_node uuid,
    parent_code text,
    level integer,
    type public.acc_account_type,
    side public.acc_side,
    postable boolean,
    action text,
    changes text[] not null default '{}',
    error text,
    error_detail jsonb
  ) on commit drop;
  insert into pg_temp.acc_import_plan (row_no, code, name, type_in, postable_in, contra_in, parent_code_in,
                                       has_desc, description, node_id)
  select e.ord::integer, btrim(e.v ->> 'code'), btrim(regexp_replace(e.v ->> 'name', '\s+', ' ', 'g')),
         (e.v ->> 'type')::public.acc_account_type,
         private.acc_to_bool(e.v -> 'postable'), private.acc_to_bool(e.v -> 'contra'),
         nullif(btrim(coalesce(e.v ->> 'parent_code', '')), ''),
         e.v ? 'description', nullif(btrim(coalesce(e.v ->> 'description', '')), ''),
         gen_random_uuid()
    from jsonb_array_elements(p_rows) with ordinality as e(v, ord);
  update pg_temp.acc_import_plan p
     set ex_id = a.id, node_id = a.id, ex_name = a.name, ex_description = a.description, ex_type = a.type,
         ex_side = a.normal_side, ex_parent_id = a.parent_id,
         ex_parent_code = (select pa.code from public.acc_accounts pa where pa.id = a.parent_id),
         ex_postable = a.postable, ex_system_key = a.system_key, ex_is_treasury = a.is_treasury,
         ex_moves = exists (select 1 from public.acc_journal_lines l where l.account_id = a.id and l.tenant_id = p_tenant_id),
         ex_in_use = a.is_treasury or a.requires_party or a.system_key is not null
                  or exists (select 1 from public.acc_parties pa where pa.tenant_id = p_tenant_id
                               and a.id in (pa.default_account_id, pa.payable_account_id, pa.receivable_account_id))
                  or exists (select 1 from public.acc_recurring_expenses rx
                              where rx.tenant_id = p_tenant_id and rx.account_id = a.id)
    from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.code = p.code;

  -- 3. Errores de cada línea.
  update pg_temp.acc_import_plan set error = 'code_invalid'
   where code !~ '^[0-9]+(\.[0-9]+)*$' or char_length(code) > 24;
  update pg_temp.acc_import_plan set error = 'account_name_invalid'
   where error is null and char_length(name) not between 2 and 80;
  update pg_temp.acc_import_plan set error = 'account_description_invalid'
   where error is null and char_length(description) > 280;
  update pg_temp.acc_import_plan p
     set error = 'import_duplicate_code', error_detail = jsonb_build_object('row', d.first_row), node_id = gen_random_uuid()
    from (select q.code, min(q.row_no) as first_row from pg_temp.acc_import_plan q group by q.code having count(*) > 1) d
   where p.code = d.code and p.row_no > d.first_row and p.error is null;
  -- La cuenta de una caja no se renombra desde acá (su nombre es el de la caja): solo mayúsculas/minúsculas.
  update pg_temp.acc_import_plan p
     set error = 'import_treasury_conflict', error_detail = jsonb_build_object('account_code', p.code, 'account_name', p.ex_name)
   where p.error is null and p.ex_is_treasury and lower(p.name) <> lower(p.ex_name);
  update pg_temp.acc_import_plan p set name = p.ex_name where p.error is null and p.ex_is_treasury;

  -- 4. Madres: candidatas = líneas sin error + cuentas del plan que no están en lo importado.
  create temporary table acc_import_cand (
    code text primary key,
    sig text not null,
    nseg integer not null,
    node uuid not null,
    row_no integer
  ) on commit drop;
  insert into pg_temp.acc_import_cand (code, sig, nseg, node, row_no)
  select p.code, private.acc_code_sig(p.code), cardinality(string_to_array(p.code, '.')), p.node_id, p.row_no
    from pg_temp.acc_import_plan p where p.error is null
  union all
  select a.code, private.acc_code_sig(a.code), cardinality(string_to_array(a.code, '.')), a.id, null
    from public.acc_accounts a
   where a.tenant_id = p_tenant_id
     and not exists (select 1 from pg_temp.acc_import_plan q where q.code = a.code and q.error is null);
  update pg_temp.acc_import_plan p
     set error = 'account_move_cycle', error_detail = jsonb_build_object('parent_code', p.parent_code_in)
   where p.error is null and p.parent_code_in = p.code;
  update pg_temp.acc_import_plan p
     set parent_node = c.node, parent_code = c.code
    from pg_temp.acc_import_cand c
   where p.error is null and p.parent_code_in is not null and c.code = p.parent_code_in;
  update pg_temp.acc_import_plan p
     set error = 'import_parent_not_found', error_detail = jsonb_build_object('parent_code', p.parent_code_in)
   where p.error is null and p.parent_code_in is not null and p.parent_node is null;
  update pg_temp.acc_import_plan p
     set parent_node = m.node, parent_code = m.code
    from (select distinct on (q.row_no) q.row_no, c.node, c.code
            from pg_temp.acc_import_plan q
           cross join lateral generate_series(private.acc_code_depth(q.code) - 1, 1, -1) as k(n)
            join pg_temp.acc_import_cand c
              on c.sig = array_to_string((string_to_array(private.acc_code_sig(q.code), '.'))[1:k.n], '.')
           where q.error is null and q.parent_code_in is null
           order by q.row_no, k.n desc, (c.nseg = cardinality(string_to_array(q.code, '.'))) desc,
                    (c.row_no is not null) desc, c.code collate "C") m
   where p.row_no = m.row_no;

  -- 5. Nivel final y ciclos (las líneas con su madre nueva; el resto del plan, con la suya).
  update pg_temp.acc_import_plan p
     set level = w.depth,
         error = case when w.cyc then 'account_move_cycle' when w.depth > 8 then 'account_level_too_deep' end
    from (
      with recursive fp(node, parent) as (
        select q.node_id, q.parent_node from pg_temp.acc_import_plan q where q.error is null
        union all
        select a.id, a.parent_id from public.acc_accounts a
         where a.tenant_id = p_tenant_id
           and not exists (select 1 from pg_temp.acc_import_plan q where q.node_id = a.id and q.error is null)
      ), walk(row_no, cur, depth, seen, cyc) as (
        select q.row_no, q.parent_node, 1, array[q.node_id], coalesce(q.parent_node = q.node_id, false)
          from pg_temp.acc_import_plan q where q.error is null
        union all
        select w.row_no, f.parent, w.depth + 1, w.seen || w.cur, coalesce(f.parent = any (w.seen || w.cur), false)
          from walk w join fp f on f.node = w.cur
         where not w.cyc and w.depth < 12
      )
      select walk.row_no, max(walk.depth) as depth, bool_or(walk.cyc) as cyc from walk group by walk.row_no
    ) w
   where p.row_no = w.row_no and p.error is null;

  -- 6. Tipo, de las madres a las hijas.
  for v_level in 1 .. 8 loop
    update pg_temp.acc_import_plan p
       set type = x.t, error = x.err,
           error_detail = case when x.err is not null then jsonb_build_object('parent_code', p.parent_code) end
      from (
        select q.row_no,
               case
                 when q.parent_node is null then coalesce(q.type_in, q.ex_type)
                 when par.perr then null
                 when coalesce(q.type_in, q.ex_type) is null then par.ptype
                 when coalesce(q.type_in, q.ex_type) = par.ptype
                      or (par.ptype in ('income', 'expense') and coalesce(q.type_in, q.ex_type) in ('income', 'expense'))
                   then coalesce(q.type_in, q.ex_type)
                 when q.type_in is null then par.ptype
               end as t,
               case
                 when q.parent_node is null and coalesce(q.type_in, q.ex_type) is null then 'import_type_required'
                 when q.parent_node is not null and par.perr then 'import_parent_has_errors'
                 when q.parent_node is not null and q.type_in is not null and q.type_in <> par.ptype
                      and not (par.ptype in ('income', 'expense') and q.type_in in ('income', 'expense'))
                   then 'account_type_mismatch'
               end as err
          from pg_temp.acc_import_plan q
          left join lateral (
            select coalesce(pp.type, a.type) as ptype, coalesce(pp.error is not null, false) as perr
              from (select 1) one
              left join pg_temp.acc_import_plan pp on pp.node_id = q.parent_node
              left join public.acc_accounts a on a.id = q.parent_node and a.tenant_id = p_tenant_id
          ) par on true
         where q.level = v_level and q.error is null
      ) x
     where p.row_no = x.row_no;
  end loop;

  -- 7. Imputable y lado normal.
  update pg_temp.acc_import_plan p
     set postable = case
           when p.ex_id is null and p.parent_node is null then coalesce(p.postable_in, false)
           when p.ex_id is null then
             coalesce(p.postable_in, not exists (select 1 from pg_temp.acc_import_plan c
                                                  where c.parent_node = p.node_id and c.error is null))
           else coalesce(p.postable_in,
                  case when exists (select 1 from pg_temp.acc_import_plan c where c.parent_node = p.node_id and c.error is null)
                       then false else p.ex_postable end)
         end
   where p.error is null;
  update pg_temp.acc_import_plan p set error = 'account_root_must_be_group'
   where p.error is null and p.parent_node is null and p.postable;
  update pg_temp.acc_import_plan p
     set side = (case when (p.type in ('asset', 'expense'))
                           <> coalesce(p.contra_in,
                                       p.ex_side <> (case when p.ex_type in ('asset', 'expense') then 'debit' else 'credit' end)::public.acc_side,
                                       false)
                      then 'debit' else 'credit' end)::public.acc_side
   where p.error is null;

  -- 8. La madre tiene que ser un grupo; las existentes, las reglas del trigger (movimientos, sistema, cajas, hijas).
  update pg_temp.acc_import_plan p
     set error = 'parent_is_postable', error_detail = jsonb_build_object('parent_code', p.parent_code)
   where p.error is null and p.parent_node is not null
     and coalesce((select pp.postable from pg_temp.acc_import_plan pp where pp.node_id = p.parent_node and pp.error is null),
                  (select a.postable from public.acc_accounts a
                    where a.id = p.parent_node and a.tenant_id = p_tenant_id
                      and not exists (select 1 from pg_temp.acc_import_plan q where q.node_id = a.id and q.error is null)));
  update pg_temp.acc_import_plan p
     set error = x.err,
         error_detail = case when x.err is not null then jsonb_build_object('account_code', p.code, 'account_name', p.ex_name) end
    from (
      select q.row_no,
             case
               when (q.type <> q.ex_type or q.side <> q.ex_side or q.postable <> q.ex_postable) and q.ex_moves
                 then 'account_has_movements'
               when (q.type <> q.ex_type or q.side <> q.ex_side) and (q.ex_system_key is not null or q.ex_is_treasury)
                 then 'account_type_mismatch'
               when q.postable <> q.ex_postable and q.ex_system_key is not null then 'system_account_locked'
               when q.ex_postable and not q.postable and q.ex_in_use then 'account_in_use'
               when q.postable and not q.ex_postable
                    and (exists (select 1 from public.acc_accounts c
                                  where c.parent_id = q.ex_id and c.tenant_id = p_tenant_id
                                    and not exists (select 1 from pg_temp.acc_import_plan m
                                                     where m.node_id = c.id and m.error is null
                                                       and m.parent_node is distinct from q.ex_id))
                         or exists (select 1 from pg_temp.acc_import_plan c where c.parent_node = q.node_id and c.error is null))
                 then 'account_has_children'
               when q.type <> q.ex_type
                    and (exists (select 1 from public.acc_accounts c
                                  where c.parent_id = q.ex_id and c.tenant_id = p_tenant_id and c.type <> q.type
                                    and not (q.type in ('income', 'expense') and c.type in ('income', 'expense'))
                                    and not exists (select 1 from pg_temp.acc_import_plan m where m.node_id = c.id and m.error is null))
                         or exists (select 1 from pg_temp.acc_import_plan c
                                     where c.parent_node = q.node_id and c.error is null and c.type <> q.type
                                       and not (q.type in ('income', 'expense') and c.type in ('income', 'expense'))))
                 then 'account_type_mismatch'
             end as err
        from pg_temp.acc_import_plan q
       where q.error is null and q.ex_id is not null
    ) x
   where p.row_no = x.row_no;

  -- 9. Qué cambia en cada una y qué se hace.
  update pg_temp.acc_import_plan p
     set changes = array_remove(array[
           case when p.name is distinct from p.ex_name then 'name' end,
           case when p.has_desc and p.description is distinct from p.ex_description then 'description' end,
           case when p.parent_node is distinct from p.ex_parent_id then 'parent' end,
           case when p.type <> p.ex_type then 'type' end,
           case when p.side <> p.ex_side then 'normal_side' end,
           case when p.postable <> p.ex_postable then 'postable' end], null)
   where p.error is null and p.ex_id is not null;
  update pg_temp.acc_import_plan p
     set action = case when p.error is not null then 'error' when p.ex_id is null then 'create'
                       when cardinality(p.changes) > 0 then 'update' else 'none' end;

  -- 10. Aplicar (o ensayar y deshacer). Madres antes que hijas; los grupos que pasan a imputables, al final.
  select count(*) into v_errors from pg_temp.acc_import_plan where error is not null;
  if v_errors > 0 and not v_dry then
    raise exception 'import_has_errors' using errcode = 'P0001',
      detail = (select jsonb_build_object('errors', v_errors,
                         'rows', jsonb_agg(jsonb_build_object('row', q.row_no, 'code', q.code, 'error', q.error) order by q.row_no))
                  from (select * from pg_temp.acc_import_plan where error is not null order by row_no limit 50) q)::text;
  end if;
  if v_errors = 0 then
    begin
      for r in select * from pg_temp.acc_import_plan where action in ('create', 'update') order by level, row_no loop
        v_cur := r.row_no;
        v_cur_code := r.code;
        if r.action = 'create' then
          insert into public.acc_accounts (id, tenant_id, code, name, type, normal_side, parent_id, postable, active,
                                           requires_party, purchase_selectable, manual_selectable, description,
                                           created_by, updated_by)
          values (r.node_id, p_tenant_id, r.code, r.name, r.type, r.side, r.parent_node, r.postable, true,
                  false, r.postable and r.type = 'expense', true, r.description, v_uid, v_uid);
        else
          update public.acc_accounts a
             set name = r.name,
                 description = case when r.has_desc then r.description else a.description end,
                 parent_id = r.parent_node, type = r.type, normal_side = r.side,
                 postable = r.postable and a.postable,
                 purchase_selectable = a.purchase_selectable and r.postable and not a.requires_party
                                       and r.type in ('asset', 'expense'),
                 updated_by = v_uid
           where a.id = r.ex_id and a.tenant_id = p_tenant_id;
        end if;
      end loop;
      for r in select * from pg_temp.acc_import_plan
                where action = 'update' and postable and not ex_postable order by level desc, row_no loop
        v_cur := r.row_no;
        v_cur_code := r.code;
        update public.acc_accounts a set postable = true, updated_by = v_uid
         where a.id = r.ex_id and a.tenant_id = p_tenant_id;
      end loop;
      if v_dry then
        raise exception using errcode = 'AIDRY', message = 'acc_import_rehearsal';   -- deshace el ensayo
      end if;
      v_applied := true;
    exception
      when sqlstate 'AIDRY' then
        null;
      when others then
        get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate, v_det = pg_exception_detail;
        if not v_dry then
          raise exception using message = v_msg, errcode = v_state,
            detail = jsonb_build_object('row', v_cur, 'code', v_cur_code, 'detail', v_det)::text;
        end if;
        update pg_temp.acc_import_plan
           set error = case v_state when 'P0001' then v_msg when '23514' then 'check_violation'
                                    when '23505' then 'duplicate' else 'import_failed' end,
               error_detail = jsonb_build_object('detail', v_det), action = 'error'
         where row_no = v_cur;
    end;
  end if;

  if v_applied then
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_accounts.imported', 'acc_accounts', p_tenant_id,
      (select jsonb_build_object('rows', v_n,
                'created', count(*) filter (where q.action = 'create'),
                'updated', count(*) filter (where q.action = 'update'),
                'created_codes', coalesce((array_agg(q.code order by q.row_no) filter (where q.action = 'create'))[1:200], '{}'),
                'updated_codes', coalesce((array_agg(q.code order by q.row_no) filter (where q.action = 'update'))[1:200], '{}'))
         from pg_temp.acc_import_plan q));
  end if;

  select jsonb_build_object(
           'dry_run', v_dry, 'applied', v_applied, 'total', count(*),
           'creates', count(*) filter (where q.action = 'create'),
           'updates', count(*) filter (where q.action = 'update'),
           'unchanged', count(*) filter (where q.action = 'none'),
           'errors', count(*) filter (where q.action = 'error'),
           'rows', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'row', q.row_no, 'code', q.code, 'name', q.name, 'action', q.action,
               'account_id', case when q.ex_id is not null then q.ex_id when v_applied then q.node_id end,
               'parent_code', q.parent_code, 'level', q.level, 'type', q.type, 'normal_side', q.side,
               'postable', q.postable, 'system_key', q.ex_system_key,
               'is_treasury', case when q.ex_is_treasury then true end,
               'changes', case when q.action = 'update' then to_jsonb(q.changes) end,
               'previous', case when q.action = 'update' then jsonb_build_object(
                             'name', q.ex_name, 'parent_code', q.ex_parent_code, 'type', q.ex_type,
                             'normal_side', q.ex_side, 'postable', q.ex_postable, 'description', q.ex_description) end,
               'error', q.error, 'error_detail', q.error_detail)) order by q.row_no), '[]'::jsonb))
    into v_summary
    from pg_temp.acc_import_plan q;
  return v_summary;
end;
$$;

comment on function public.acc_import_accounts(uuid, jsonb, boolean) is
  'Importa un plan de cuentas pegado: crea los códigos nuevos y actualiza los que ya existen (nunca borra). Con p_dry_run devuelve el plan sin escribir.';

revoke all on function public.acc_import_accounts(uuid, jsonb, boolean) from public, anon;
grant execute on function public.acc_import_accounts(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
