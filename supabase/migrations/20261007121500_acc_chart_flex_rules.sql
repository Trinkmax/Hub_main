-- Parte 1 de 4 de la migración #16 (acc_chart_flex): reglas del plan de cuentas. Partida en cuatro
-- solo para que cada apply_migration por MCP sea chica; cada parte trae los revoke/grant de lo suyo.
-- ============================================================
-- Sprint 1 «Administración» · migración #16 · plan de cuentas totalmente configurable
-- (pedido del dueño del 07/10, con el modelo de plan de cuentas de la contadora como inspiración)
-- ============================================================
--   1. El código es una etiqueta libre: se va «el código de la hija empieza con el de la madre»
--      (code_parent_mismatch). Quedan el formato (aac_code_fmt) y la unicidad por bar (aac_code_uq).
--      Sirven igual el estilo con ceros del modelo (1.1.01.01.000 → 1.1.01.01.001) y el de puntos.
--   2. Grupos de resultados mixtos: bajo un grupo de ingresos o de egresos, la hija puede ser ingreso o
--      egreso (así «4 Resultado del ejercicio» tiene Ingresos y Egresos adentro). Fuera de esos grupos
--      el tipo se sigue heredando. El lado normal sigue al tipo (invertido en las regularizadoras).
--   3. Mover cualquier cosa: un grupo con hijas se mueve con todo su subárbol (nivel y camino se
--      recalculan en cascada, trigger AFTER), y el código cambia aunque haya movimientos: la foto de los
--      períodos cerrados (acc_period_snapshot_hash) usa ids de cuenta, nunca códigos. Con movimientos
--      siguen sin cambiar tipo, lado normal, imputable ni control. Las cuentas del sistema y las de una
--      caja no cambian de tipo ni de lado; las del sistema tampoco de imputable ni de control.
--   4. acc_next_child_code propone el siguiente código con el estilo de la madre: 1.1.01.01.000 con
--      hijas .001….007 → 1.1.01.01.008; 1.1.01.00.000 → 1.1.01.03.000; 1.1.01 → 1.1.01.04 (como antes).
--   5. acc_treasury_create: la primera caja va a «Caja y bancos» del plan nuevo (1.1.01.01.000) o a la
--      1.1.01 de un plan viejo.
-- Partes: 1 reglas (esta) · 2 plan estándar nuevo · 3 alta/edición y reasignación de claves · 4 importar.
-- Claves de error nuevas (con texto en lib/accounting/errors.ts): account_move_cycle,
-- account_level_too_deep, account_type_mismatch, account_has_children.
-- ============================================================

-- ─── 1. Helpers de códigos (puros) ───────────────────────────────────────────
-- Código significativo: sin los segmentos finales en cero (1.1.01.01.000 → 1.1.01.01; 1.0.00.00.000 → 1).
create function private.acc_code_sig(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_code, '(\.0+)+$', '')
$$;

-- Profundidad = segmentos significativos (1.1.01.01.001 → 5; 1.1.01.00.000 → 3; 1.1.01 → 3).
create function private.acc_code_depth(p_code text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select cardinality(string_to_array(private.acc_code_sig(p_code), '.'))
$$;

-- Madre de un código del estilo con ceros: el último segmento significativo pasa a ceros del mismo ancho
-- (1.1.01.01.001 → 1.1.01.01.000; 1.1.01.01.000 → 1.1.01.00.000); la raíz no tiene (null). Lo usa la
-- siembra del plan estándar; la importación infiere la madre con acc_code_sig (prefijo significativo).
create function private.acc_code_parent(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when d.k = 1 then null
              else array_to_string(d.segs[1:d.k - 1] || repeat('0', char_length(d.segs[d.k])) || d.segs[d.k + 1:], '.')
         end
    from (select string_to_array(p_code, '.') as segs, private.acc_code_depth(p_code) as k) d
$$;

-- ─── 2. Trigger del plan (reemplaza el de la #5) ─────────────────────────────
create or replace function private.acc_tg_accounts_biu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.acc_accounts;
  v_contra boolean;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;                                                   -- cascada del bar entero
    end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then
      return old;                                                   -- reinicio antes del primer cierre (I.6)
    end if;
    raise exception 'account_delete_forbidden' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.tenant_id <> old.tenant_id then
      raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_accounts';
    end if;
    -- La clave del sistema solo la mueve acc_remap_system_account (marca acc.remap en su transacción).
    if new.system_key is distinct from old.system_key
       and coalesce(current_setting('acc.remap', true), '') <> old.tenant_id::text then
      raise exception 'system_account_locked' using errcode = 'P0001';
    end if;
  end if;

  -- Nivel, camino y tipo. El código es una etiqueta: formato (aac_code_fmt) y unicidad (aac_code_uq).
  v_contra := new.normal_side <> (case when new.type in ('asset', 'expense') then 'debit' else 'credit' end)::public.acc_side;
  if new.parent_id is null then
    new.level := 1;
    new.path := '{}';
  else
    select * into p from public.acc_accounts a where a.id = new.parent_id and a.tenant_id = new.tenant_id;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
    end if;
    if p.id = new.id or new.id = any (p.path) then                  -- ciclo (solo posible en UPDATE)
      raise exception 'account_move_cycle' using errcode = 'P0001', detail = p.code;
    end if;
    if p.postable then
      raise exception 'parent_is_postable' using errcode = 'P0001', detail = p.code;
    end if;
    if p.level >= 8 then
      raise exception 'account_level_too_deep' using errcode = 'P0001', detail = p.code;
    end if;
    -- Hereda el tipo de la madre, salvo bajo un grupo de resultados: ahí la hija es ingreso o egreso.
    if not (p.type in ('income', 'expense') and new.type in ('income', 'expense')) then
      new.type := p.type;
    end if;
    new.level := p.level + 1;
    new.path := p.path || p.id;
  end if;
  -- Lado normal: el del tipo final; una regularizadora lo conserva invertido.
  new.normal_side := (case when (new.type in ('asset', 'expense')) <> v_contra then 'debit' else 'credit' end)::public.acc_side;

  if tg_op = 'UPDATE' then
    -- Con movimientos no cambian tipo, lado normal, imputable ni control (código y madre sí).
    if (new.type <> old.type or new.normal_side <> old.normal_side or new.postable <> old.postable
        or new.requires_party <> old.requires_party)
       and exists (select 1 from public.acc_journal_lines l where l.account_id = old.id and l.tenant_id = old.tenant_id) then
      raise exception 'account_has_movements' using errcode = 'P0001', detail = old.code;
    end if;
    -- El motor depende del tipo y del lado de las cuentas del sistema y de las de una caja.
    if (new.type <> old.type or new.normal_side <> old.normal_side)
       and (old.system_key is not null or old.is_treasury) then
      raise exception 'account_type_mismatch' using errcode = 'P0001', detail = old.code;
    end if;
    if (new.requires_party <> old.requires_party or new.postable <> old.postable) and old.system_key is not null then
      raise exception 'system_account_locked' using errcode = 'P0001';
    end if;
    -- Un grupo con hijas no pasa a imputable; si cambia de tipo, sus hijas tienen que seguir siendo compatibles.
    if new.postable and not old.postable
       and exists (select 1 from public.acc_accounts c where c.parent_id = old.id and c.tenant_id = old.tenant_id) then
      raise exception 'account_has_children' using errcode = 'P0001', detail = old.code;
    end if;
    if new.type <> old.type
       and exists (select 1 from public.acc_accounts c
                    where c.parent_id = old.id and c.tenant_id = old.tenant_id and c.type <> new.type
                      and not (new.type in ('income', 'expense') and c.type in ('income', 'expense'))) then
      raise exception 'account_type_mismatch' using errcode = 'P0001', detail = old.code;
    end if;
    -- Desactivar: sin clave de sistema, con saldo cero y sin nada activo que la use.
    if old.active and not new.active then
      if old.system_key is not null then
        raise exception 'system_account_locked' using errcode = 'P0001';
      end if;
      if old.postable and public.acc_account_balance(old.tenant_id, old.id, null) <> 0 then
        raise exception 'account_has_balance' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.acc_accounts c
                  where c.parent_id = old.id and c.tenant_id = old.tenant_id and c.active)
         or exists (select 1 from public.acc_treasury_accounts tr
                     where tr.account_id = old.id and tr.tenant_id = old.tenant_id and tr.active)
         or exists (select 1 from public.acc_parties pa
                     where pa.tenant_id = old.tenant_id and pa.active
                       and old.id in (pa.default_account_id, pa.payable_account_id, pa.receivable_account_id))
         or exists (select 1 from public.acc_recurring_expenses rx
                     where rx.account_id = old.id and rx.tenant_id = old.tenant_id and rx.active) then
        raise exception 'account_in_use' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Cascada del subárbol: si una cuenta cambió de lugar (camino o nivel), sus hijas lo recalculan desde la
-- madre ya actualizada (su BEFORE) y cada una baja a las suyas. A lo sumo 8 niveles.
create function private.acc_tg_accounts_au()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acc_accounts c
     set path = new.path || new.id, level = new.level + 1
   where c.parent_id = new.id and c.tenant_id = new.tenant_id;
  return null;
end;
$$;
create trigger acc_accounts_au_subtree
  after update on public.acc_accounts
  for each row
  when (old.path is distinct from new.path or old.level is distinct from new.level)
  execute function private.acc_tg_accounts_au();

-- ─── 3. Siguiente código libre con el estilo de la madre ─────────────────────
create or replace function private.acc_next_child_code(p_tenant uuid, p_parent_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent public.acc_accounts;
  v_segs text[];
  v_n int;
  v_z int;
  v_prefix text;
  v_suffix text;
  v_sep text;
  v_pattern text;
  v_max numeric;
  v_width int;
  v_next text;
begin
  select * into v_parent from public.acc_accounts a where a.id = p_parent_id and a.tenant_id = p_tenant;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
  end if;
  v_segs := string_to_array(v_parent.code, '.');
  v_n := cardinality(v_segs);
  -- Estilo con ceros: la madre termina en segmentos de ceros (desde el segundo). Las hijas numeran el
  -- primero de esa cola con el mismo ancho; se mira todo el plan (el código es único por bar).
  for i in reverse v_n..2 loop
    exit when v_segs[i] !~ '^0+$';
    v_z := i;
  end loop;
  if v_z is not null then
    v_prefix := array_to_string(v_segs[1:v_z - 1], '.') || '.';
    v_suffix := case when v_z < v_n then '.' || array_to_string(v_segs[v_z + 1:v_n], '.') else '' end;
    v_width := char_length(v_segs[v_z]);
    v_pattern := '^' || replace(v_prefix, '.', '\.') || '([0-9]+)' || replace(v_suffix, '.', '\.') || '$';
    select max((regexp_match(c.code, v_pattern))[1]::numeric) into v_max
      from public.acc_accounts c
     where c.tenant_id = p_tenant and c.code ~ v_pattern;
    v_next := (coalesce(v_max, 0) + 1)::text;
    return v_prefix || lpad(v_next, greatest(v_width, char_length(v_next)), '0') || v_suffix;
  end if;
  -- Estilo con puntos (1.1.01 → 1.1.01.04): con puntos salvo que la madre no los use y ya tenga hijas sin
  -- puntos (esquema 1101 → 110104).
  v_sep := case when position('.' in v_parent.code) > 0
                  or not exists (select 1 from public.acc_accounts c
                                  where c.tenant_id = p_tenant and c.parent_id = v_parent.id
                                    and position('.' in c.code) = 0)
                then '.' else '' end;
  v_pattern := '^' || replace(v_parent.code, '.', '\.') || replace(v_sep, '.', '\.') || '([0-9]{1,6})$';
  select max((regexp_match(c.code, v_pattern))[1]::bigint), max(char_length((regexp_match(c.code, v_pattern))[1]))
    into v_max, v_width
    from public.acc_accounts c
   where c.tenant_id = p_tenant and c.code ~ v_pattern;
  v_next := (coalesce(v_max, 0) + 1)::text;
  return v_parent.code || v_sep || lpad(v_next, greatest(coalesce(v_width, 2), 2, char_length(v_next)), '0');
end;
$$;

-- ─── 4. Cajas: grupo de respaldo de la primera ───────────────────────────────
-- Igual que en la #8 salvo el grupo de respaldo de la primera caja: «Caja y bancos» del plan nuevo
-- (1.1.01.01.000) o, en un plan sembrado antes, 1.1.01. Las siguientes van al grupo de una caja que ya
-- existe del mismo lado (aunque la contadora la haya movido o recodificado); las tarjetas de la empresa,
-- al grupo de «Proveedores» (payable_suppliers).
create or replace function private.acc_treasury_create(p_tenant uuid, p_actor uuid, p_t jsonb, p_sort int,
                                            p_create_bank_party boolean)
returns public.acc_treasury_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_kind text;
  v_bank_name text;
  v_cbu text;
  v_alias text;
  v_number text;
  v_allow_negative boolean;
  v_parent public.acc_accounts;
  v_account_id uuid;
  v_row public.acc_treasury_accounts;
begin
  if p_t is null or jsonb_typeof(p_t) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury';
  end if;
  v_name := btrim(coalesce(p_t ->> 'name', ''));
  if char_length(v_name) not between 2 and 60 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
  end if;
  if exists (select 1 from public.acc_treasury_accounts t where t.tenant_id = p_tenant and lower(t.name) = lower(v_name)) then
    raise exception 'treasury_name_taken' using errcode = 'P0001', detail = v_name;
  end if;
  v_kind := p_t ->> 'kind';
  if v_kind is null or v_kind not in ('cash', 'bank', 'wallet', 'credit_card', 'other') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
  end if;
  v_bank_name := nullif(btrim(coalesce(p_t ->> 'bank_name', '')), '');
  v_cbu := nullif(regexp_replace(coalesce(p_t ->> 'cbu_cvu', ''), '\s', '', 'g'), '');
  v_alias := nullif(btrim(coalesce(p_t ->> 'alias', '')), '');
  v_number := nullif(btrim(coalesce(p_t ->> 'account_number', '')), '');
  if char_length(v_bank_name) > 80 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'bank_name';
  end if;
  if v_cbu !~ '^[0-9]{22}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cbu_cvu';
  end if;
  if v_alias !~ '^[A-Za-z0-9.\-]{6,20}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'alias';
  end if;
  if char_length(v_number) > 40 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'account_number';
  end if;
  v_allow_negative := coalesce(private.acc_to_bool(p_t -> 'allow_negative'), false);

  -- Grupo de la cuenta.
  select pa.* into v_parent
    from public.acc_treasury_accounts t
    join public.acc_accounts a on a.id = t.account_id and a.tenant_id = t.tenant_id
    join public.acc_accounts pa on pa.id = a.parent_id and pa.tenant_id = a.tenant_id
   where t.tenant_id = p_tenant and (t.kind = 'credit_card') = (v_kind = 'credit_card')
   order by t.sort, t.created_at
   limit 1;
  if v_parent.id is null then
    if v_kind = 'credit_card' then
      select pa.* into v_parent
        from public.acc_accounts a
        join public.acc_accounts pa on pa.id = a.parent_id and pa.tenant_id = a.tenant_id
       where a.tenant_id = p_tenant and a.system_key = 'payable_suppliers';
    else
      select a.* into v_parent from public.acc_accounts a
       where a.tenant_id = p_tenant and a.code in ('1.1.01.01.000', '1.1.01') and not a.postable and a.type = 'asset'
       order by a.code = '1.1.01.01.000' desc
       limit 1;
    end if;
  end if;
  if v_parent.id is null or v_parent.postable then
    raise exception 'treasury_account_invalid' using errcode = 'P0001';
  end if;

  insert into public.acc_accounts (tenant_id, code, name, type, normal_side, parent_id, postable, is_treasury,
                                   requires_party, purchase_selectable, manual_selectable, created_by, updated_by)
  values (p_tenant, private.acc_next_child_code(p_tenant, v_parent.id), v_name, v_parent.type,
          case when v_kind = 'credit_card' then 'credit' else 'debit' end::public.acc_side, v_parent.id, true, true,
          false, false, true, p_actor, p_actor)
  returning id into v_account_id;

  insert into public.acc_treasury_accounts (tenant_id, account_id, name, kind, bank_name, cbu_cvu, alias, account_number,
                                            allow_negative, sort, created_by, updated_by)
  values (p_tenant, v_account_id, v_name, v_kind, v_bank_name, v_cbu, v_alias, v_number, v_allow_negative,
          coalesce(p_sort, 0), p_actor, p_actor)
  returning * into v_row;

  if p_create_bank_party then
    update public.acc_treasury_accounts t
       set bank_party_id = private.acc_bank_party_create(p_tenant, p_actor, coalesce(v_bank_name, v_name))
     where t.id = v_row.id
     returning * into v_row;
  end if;
  return v_row;
end;
$$;

comment on function private.acc_code_sig(text) is
  'Código sin los segmentos finales en cero (1.1.01.01.000 → 1.1.01.01). Base de la madre inferida al importar.';
comment on function private.acc_code_depth(text) is
  'Cantidad de segmentos significativos de un código (1.1.01.01.001 → 5; 1.1.01.00.000 → 3).';
comment on function private.acc_code_parent(text) is
  'Madre de un código del estilo con ceros (1.1.01.01.001 → 1.1.01.01.000); null en la raíz. La usa la siembra.';
comment on function private.acc_tg_accounts_au() is
  'Cascada del subárbol: cuando una cuenta cambia de camino o de nivel, sus hijas lo recalculan.';
comment on function private.acc_next_child_code(uuid, uuid) is
  'Siguiente código libre con el estilo de la madre (1.1.01.01.000 → 1.1.01.01.008; 1.1.01 → 1.1.01.04).';

-- Permisos de las funciones de esta parte (internas: sin EXECUTE para nadie)
revoke all on function private.acc_code_sig(text) from public, anon, authenticated;
revoke all on function private.acc_code_depth(text) from public, anon, authenticated;
revoke all on function private.acc_code_parent(text) from public, anon, authenticated;
revoke all on function private.acc_tg_accounts_biu() from public, anon, authenticated;
revoke all on function private.acc_tg_accounts_au() from public, anon, authenticated;
revoke all on function private.acc_next_child_code(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_treasury_create(uuid, uuid, jsonb, int, boolean) from public, anon, authenticated;
