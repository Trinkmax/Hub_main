-- Parte 3 de 4 de la migración #16 (acc_chart_flex): alta y edición de cuentas con tipos mixtos, raíces y
-- movimientos de grupos enteros (acc_save_account) y reasignación de claves del sistema
-- (acc_remap_system_account).
-- Claves de error nuevas (con texto en lib/accounting/errors.ts): account_root_must_be_group,
-- system_remap_incompatible, system_remap_has_balance (más las de la parte 1 que levanta el trigger).

-- ─── 1. acc_save_account (reemplaza la de la #8) ─────────────────────────────
-- Alta: {parent_id?, code?, name, type?, postable?, contra?, requires_party?, purchase_selectable?,
--        manual_selectable?, description?}. Sin parent_id (o null) y con type → raíz (grupo).
-- Edición: {id, name?, code?, type?, parent_id?, active?, requires_party?, purchase_selectable?,
--           manual_selectable?, description?}. parent_id null → la pasa a raíz (solo un grupo).
-- type: bajo un grupo de ingresos o egresos se puede elegir ingreso o egreso; en el resto tiene que ser
-- el de la madre (por defecto, el de la madre). El lado normal sigue al tipo (invertido si es regularizadora).
-- El trigger acc_accounts_biu hace cumplir el resto (movimientos, cuentas del sistema y de cajas, ciclos,
-- hijas compatibles) y la cascada recalcula el subárbol de un grupo que se mueve.
create or replace function public.acc_save_account(p_tenant_id uuid, p_account jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_accounts;
  v_row public.acc_accounts;
  v_parent public.acc_accounts;
  v_created boolean;
  v_key text;
  v_bool boolean;
  v_contra boolean := false;
  v_type public.acc_account_type;
  v_txt text;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_account is null or jsonb_typeof(p_account) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'account';
  end if;
  for v_key in select jsonb_object_keys(p_account) loop
    if v_key not in ('id', 'parent_id', 'code', 'name', 'type', 'postable', 'contra', 'requires_party',
                     'purchase_selectable', 'manual_selectable', 'description', 'active') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  v_created := not (p_account ? 'id');
  if p_account ? 'type' and jsonb_typeof(p_account -> 'type') <> 'null' then
    if jsonb_typeof(p_account -> 'type') <> 'string'
       or (p_account ->> 'type') not in ('asset', 'liability', 'equity', 'income', 'expense') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'type';
    end if;
    v_type := (p_account ->> 'type')::public.acc_account_type;
  end if;

  if v_created then
    if p_account ? 'parent_id' and jsonb_typeof(p_account -> 'parent_id') <> 'null' then
      select * into v_parent from public.acc_accounts a
       where a.id = private.acc_to_uuid(p_account ->> 'parent_id') and a.tenant_id = p_tenant_id;
      if not found then
        raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
      end if;
    elsif v_type is null then
      raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';  -- una raíz trae su tipo
    end if;
    v_row.id := gen_random_uuid();
    v_row.tenant_id := p_tenant_id;
    v_row.parent_id := v_parent.id;
    v_row.active := true;
    v_row.postable := v_parent.id is not null;
    v_row.requires_party := false;
    v_row.purchase_selectable := false;
    v_row.manual_selectable := true;
    foreach v_key in array array['postable', 'contra'] loop
      if p_account ? v_key then
        if private.acc_to_bool(p_account -> v_key) is null then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
        end if;
        if v_key = 'postable' then v_row.postable := private.acc_to_bool(p_account -> v_key);
        else v_contra := private.acc_to_bool(p_account -> v_key); end if;
      end if;
    end loop;
    if v_parent.id is null and v_row.postable then
      raise exception 'account_root_must_be_group' using errcode = 'P0001';
    end if;
    -- Tipo: el de la madre; bajo un grupo de resultados, ingreso o egreso; una raíz, el que trae.
    if v_parent.id is null then
      v_row.type := v_type;
    elsif v_type is null or v_type = v_parent.type then
      v_row.type := v_parent.type;
    elsif v_parent.type in ('income', 'expense') and v_type in ('income', 'expense') then
      v_row.type := v_type;
    else
      raise exception 'account_type_mismatch' using errcode = 'P0001', detail = v_parent.code;
    end if;
    if not (p_account ? 'name') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
  else
    select * into v_old from public.acc_accounts a
     where a.id = private.acc_to_uuid(p_account ->> 'id') and a.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    if p_account ? 'postable' or p_account ? 'contra' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'postable';
    end if;
    v_row := v_old;
    v_contra := v_old.normal_side <> (case when v_old.type in ('asset', 'expense') then 'debit' else 'credit' end)::public.acc_side;
    if p_account ? 'parent_id' then
      if jsonb_typeof(p_account -> 'parent_id') = 'null' then
        if v_old.postable then
          raise exception 'account_root_must_be_group' using errcode = 'P0001';
        end if;
        v_row.parent_id := null;
      else
        select * into v_parent from public.acc_accounts a
         where a.id = private.acc_to_uuid(p_account ->> 'parent_id') and a.tenant_id = p_tenant_id;
        if not found then
          raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
        end if;
        v_row.parent_id := v_parent.id;
      end if;
    elsif v_old.parent_id is not null then
      select * into v_parent from public.acc_accounts a where a.id = v_old.parent_id and a.tenant_id = p_tenant_id;
    end if;
    -- Tipo pedido, o el que impone una madre de otro tipo (fuera de los grupos de resultados).
    if v_type is not null and v_type <> v_old.type then
      if v_parent.id is not null and v_type <> v_parent.type
         and not (v_parent.type in ('income', 'expense') and v_type in ('income', 'expense')) then
        raise exception 'account_type_mismatch' using errcode = 'P0001', detail = v_parent.code;
      end if;
      v_row.type := v_type;
    elsif v_parent.id is not null and v_row.type <> v_parent.type
          and not (v_parent.type in ('income', 'expense') and v_row.type in ('income', 'expense')) then
      v_row.type := v_parent.type;
    end if;
  end if;
  -- Lado normal: el del tipo (activo y egreso al Debe); una regularizadora lo invierte.
  v_row.normal_side := (case when (v_row.type in ('asset', 'expense')) <> v_contra then 'debit' else 'credit' end)::public.acc_side;

  foreach v_key in array array['requires_party', 'purchase_selectable', 'manual_selectable', 'active'] loop
    if p_account ? v_key then
      v_bool := private.acc_to_bool(p_account -> v_key);
      if v_bool is null or (v_created and v_key = 'active') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
      end if;
      case v_key
        when 'requires_party' then v_row.requires_party := v_bool;
        when 'purchase_selectable' then v_row.purchase_selectable := v_bool;
        when 'manual_selectable' then v_row.manual_selectable := v_bool;
        else v_row.active := v_bool;
      end case;
    end if;
  end loop;
  if v_row.requires_party and (not v_row.postable or v_row.is_treasury) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'requires_party';
  end if;
  -- «¿En qué?» solo para imputables de activo o egreso sin partícipe (C.3.4).
  if v_row.purchase_selectable and (not v_row.postable or v_row.requires_party or v_row.type not in ('asset', 'expense')) then
    v_row.purchase_selectable := false;
  end if;
  if p_account ? 'name' then
    v_txt := btrim(coalesce(p_account ->> 'name', ''));
    if char_length(v_txt) not between 2 and 80 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
    v_row.name := v_txt;
  end if;
  if p_account ? 'description' then
    v_txt := nullif(btrim(coalesce(p_account ->> 'description', '')), '');
    if char_length(v_txt) > 280 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'description';
    end if;
    v_row.description := v_txt;
  end if;
  -- Código: etiqueta libre (formato y único por bar); el propuesto es el siguiente libre de la madre.
  if p_account ? 'code' and nullif(btrim(coalesce(p_account ->> 'code', '')), '') is not null then
    v_txt := btrim(p_account ->> 'code');
    if v_txt !~ '^[0-9]+(\.[0-9]+)*$' or char_length(v_txt) > 24 then
      raise exception 'code_invalid' using errcode = 'P0001',
        detail = case when v_row.parent_id is not null then private.acc_next_child_code(p_tenant_id, v_row.parent_id) end;
    end if;
    if exists (select 1 from public.acc_accounts a
                where a.tenant_id = p_tenant_id and a.code = v_txt and a.id <> v_row.id) then
      raise exception 'code_taken' using errcode = 'P0001', detail = v_txt;
    end if;
    v_row.code := v_txt;
  elsif v_created then
    if v_row.parent_id is null then
      raise exception 'code_invalid' using errcode = 'P0001';                          -- una raíz trae su código
    end if;
    v_row.code := private.acc_next_child_code(p_tenant_id, v_row.parent_id);
  end if;

  if v_created then
    insert into public.acc_accounts (id, tenant_id, code, name, type, normal_side, parent_id, postable, active,
                                     requires_party, purchase_selectable, manual_selectable, description,
                                     created_by, updated_by)
    values (v_row.id, p_tenant_id, v_row.code, v_row.name, v_row.type, v_row.normal_side, v_row.parent_id,
            v_row.postable, true, v_row.requires_party, v_row.purchase_selectable, v_row.manual_selectable,
            v_row.description, v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_account) k);
  else
    update public.acc_accounts a
       set code = v_row.code, name = v_row.name, parent_id = v_row.parent_id, type = v_row.type,
           normal_side = v_row.normal_side, active = v_row.active, requires_party = v_row.requires_party,
           purchase_selectable = v_row.purchase_selectable, manual_selectable = v_row.manual_selectable,
           description = v_row.description, updated_by = v_uid
     where a.id = v_old.id and a.tenant_id = p_tenant_id
     returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_account.saved', 'acc_account', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row);
end;
$$;

-- ─── 2. acc_remap_system_account ─────────────────────────────────────────────
-- Pasa una clave del sistema (system_key) a otra cuenta compatible con lo que el motor espera de esa clave:
-- imputable, activa, sin caja, sin otra clave, mismo tipo, mismo lado normal y mismo control de partícipe.
-- Copia «¿En qué?» (purchase_selectable) de la cuenta anterior. La historia queda donde estaba, por eso la
-- cuenta anterior no puede dejar saldo (ni partidas abiertas si es de control). Los partícipes que la usaban
-- como cuenta de control pasan a la nueva. Escritor + administrador, bajo el lock del bar, auditado.
create function public.acc_remap_system_account(p_tenant_id uuid, p_system_key text, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_from public.acc_accounts;
  v_to public.acc_accounts;
  v_reason text;
  v_parties integer := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform public.acc_assert_admin(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_system_key is null or p_system_key !~ '^[a-z][a-z0-9_]{2,40}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'system_key';
  end if;
  select * into v_from from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.system_key = p_system_key
     for update;
  if not found then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'system_key';
  end if;
  select * into v_to from public.acc_accounts a
   where a.id = p_account_id and a.tenant_id = p_tenant_id
     for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  if v_to.id = v_from.id then                                         -- ya era esa: no cambia nada
    return jsonb_build_object('system_key', p_system_key, 'changed', false,
      'from', jsonb_build_object('id', v_from.id, 'code', v_from.code, 'name', v_from.name),
      'to', to_jsonb(v_to), 'parties_repointed', 0);
  end if;
  v_reason := case
    when v_to.system_key is not null then 'system'
    when v_to.is_treasury then 'treasury'
    when not v_to.postable then 'postable'
    when not v_to.active then 'inactive'
    when v_to.type <> v_from.type then 'type'
    when v_to.normal_side <> v_from.normal_side then 'normal_side'
    when v_to.requires_party <> v_from.requires_party then 'requires_party'
  end;
  if v_reason is not null then
    raise exception 'system_remap_incompatible' using errcode = 'P0001',
      detail = jsonb_build_object('reason', v_reason, 'account_code', v_to.code, 'account_name', v_to.name)::text;
  end if;
  if public.acc_account_balance(p_tenant_id, v_from.id, null) <> 0
     or (v_from.requires_party and exists (
           select 1 from public.acc_journal_lines l
             join public.acc_journal_entries e on e.id = l.entry_id
            where l.tenant_id = p_tenant_id and l.account_id = v_from.id and e.status = 'posted' and not e.is_mirror
            group by l.party_id
           having sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end) <> 0)) then
    raise exception 'system_remap_has_balance' using errcode = 'P0001',
      detail = jsonb_build_object('account_code', v_from.code, 'account_name', v_from.name)::text;
  end if;

  perform set_config('acc.remap', p_tenant_id::text, true);          -- el trigger deja mover la clave
  update public.acc_accounts a set system_key = null, updated_by = v_uid
   where a.id = v_from.id and a.tenant_id = p_tenant_id;
  update public.acc_accounts a
     set system_key = p_system_key, purchase_selectable = v_from.purchase_selectable, updated_by = v_uid
   where a.id = v_to.id and a.tenant_id = p_tenant_id
   returning * into v_to;
  perform set_config('acc.remap', '', true);

  if v_from.requires_party then
    update public.acc_parties p
       set payable_account_id = case when p.payable_account_id = v_from.id then v_to.id else p.payable_account_id end,
           receivable_account_id = case when p.receivable_account_id = v_from.id then v_to.id else p.receivable_account_id end,
           updated_by = v_uid
     where p.tenant_id = p_tenant_id and v_from.id in (p.payable_account_id, p.receivable_account_id);
    get diagnostics v_parties = row_count;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_account.system_key_remapped', 'acc_account', v_to.id,
    jsonb_build_object('system_key', p_system_key, 'from_account_id', v_from.id, 'from_code', v_from.code,
                       'to_account_id', v_to.id, 'to_code', v_to.code, 'parties_repointed', v_parties));
  return jsonb_build_object('system_key', p_system_key, 'changed', true,
    'from', jsonb_build_object('id', v_from.id, 'code', v_from.code, 'name', v_from.name),
    'to', to_jsonb(v_to), 'parties_repointed', v_parties);
end;
$$;

comment on function public.acc_save_account(uuid, jsonb, timestamptz) is
  'Alta o edición de una cuenta del plan: código libre, tipos mixtos bajo resultados, raíces y grupos que se mueven con su subárbol.';
comment on function public.acc_remap_system_account(uuid, text, uuid) is
  'Pasa una clave del sistema a otra cuenta compatible (mismo tipo, lado y control; imputable y activa). La historia queda donde estaba.';

revoke all on function public.acc_save_account(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_account(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_remap_system_account(uuid, text, uuid) from public, anon;
grant execute on function public.acc_remap_system_account(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
