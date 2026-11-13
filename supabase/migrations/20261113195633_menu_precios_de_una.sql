-- Carta: un cambio de precios se aplica entero o no se aplica (docs/features/pos.md › Precios).
--
-- «Aumentar precios» escribía de a tandas desde el servidor de la aplicación: decenas de idas a la base,
-- una por cada «de cuánto a cuánto». Si una fallaba por la mitad (un corte, un tiempo de espera), la carta
-- quedaba a medio aumentar. Y como cada ida era una operación aparte, el historial no sabía que todos esos
-- cambios eran un mismo aumento: los juntaba adivinando, por persona y por hora.
--
-- Esta función hace lo mismo en UNA sola operación:
--   · si algo falla, no queda nada escrito (ni un precio);
--   · cada precio se cambia solo si sigue valiendo lo que la persona estaba viendo. Los que alguien cambió
--     en el medio, o que ya no están, no se pisan: vuelven en `failed`, uno por uno, con lo que valen ahora;
--   · un aumento (o su deshacer) queda marcado como una tanda: todos sus renglones del historial comparten
--     `batch_id`, que los disparadores de precios ya sabían leer de `pos.price_batch`.
--
-- Corre con los permisos de quien la llama (no es `security definer`): quién puede cambiar precios lo
-- siguen decidiendo las mismas políticas de `menu_items` y `menu_item_branches` (dueño y editor). Además
-- pide el rol de forma explícita, para contestar «no podés» en vez de «no cambió nada».
--
-- Qué toca de lo que ya existe: NADA. Es una función nueva. No cambia tablas, políticas, disparadores ni
-- datos; la pantalla de precios pasa a llamarla en vez de escribir tabla por tabla.
--
-- Para volver atrás: `drop function public.menu_apply_price_changes(uuid, jsonb, boolean);` (y la versión
-- anterior de `lib/menu/prices/actions.ts`).
--
-- El cuerpo no lleva renglones de comentario a propósito: así su md5 es el mismo se aplique este archivo
-- tal cual o sin comentarios.

set local lock_timeout = '5s';

-- Candado de entrada: la función no existe todavía, y lo que usa está como en el ensayo.
do $pre$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'menu_apply_price_changes'
  ) then
    raise exception 'candado: menu_apply_price_changes ya existe';
  end if;
  if to_regclass('public.menu_item_branches') is null
     or to_regclass('public.menu_price_changes') is null
     or to_regprocedure('public.user_role_in_tenant(uuid)') is null then
    raise exception 'candado: falta algo de lo que esta función usa';
  end if;
  if (select count(*) from pg_trigger tg
       where not tg.tgisinternal
         and ((tg.tgrelid = 'public.menu_items'::regclass and tg.tgname = 'menu_items_log_price')
           or (tg.tgrelid = 'public.menu_item_branches'::regclass and tg.tgname = 'menu_item_branches_log_price'))) <> 2 then
    raise exception 'candado: faltan los disparadores que anotan el historial de precios';
  end if;
end
$pre$;

create function public.menu_apply_price_changes(
  p_tenant_id uuid,
  p_changes jsonb,
  p_batch boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_role public.tenant_role;
  v_user uuid := (select auth.uid());
  v_before text := current_setting('pos.price_batch', true);
  v_batch uuid;
  v_count integer;
  v_menu_applied jsonb;
  v_menu_failed jsonb;
  v_own_updated jsonb;
  v_own_inserted jsonb;
  v_own_failed jsonb;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null or v_role::text not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_changes);
  if v_count < 1 or v_count > 3000 then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_changes)
        as c(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
     where c.item_id is null
        or (c.branch_id is null and (c.price_cents is null or c.expected_cents is null))
        or c.price_cents < 0 or c.price_cents > 1000000000000
        or c.expected_cents < 0 or c.expected_cents > 1000000000000
  ) then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct (c.item_id, c.branch_id))
      from jsonb_to_recordset(p_changes) as c(item_id uuid, branch_id uuid)
  ) then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_changes) as c(item_id uuid, branch_id uuid)
     where c.branch_id is not null
       and not exists (
         select 1 from public.branches b
          where b.id = c.branch_id and b.tenant_id = p_tenant_id
       )
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  if p_batch then
    v_batch := gen_random_uuid();
    perform set_config('pos.price_batch', v_batch::text, true);
  else
    perform set_config('pos.price_batch', '', true);
  end if;

  perform 1
     from public.menu_items m
    where m.tenant_id = p_tenant_id
      and m.id in (
        select c.item_id
          from jsonb_to_recordset(p_changes) as c(item_id uuid, branch_id uuid)
         where c.branch_id is null
      )
    order by m.id
      for update;
  perform 1
     from public.menu_item_branches mb
    where mb.tenant_id = p_tenant_id
      and (mb.branch_id, mb.menu_item_id) in (
        select c.branch_id, c.item_id
          from jsonb_to_recordset(p_changes) as c(item_id uuid, branch_id uuid)
         where c.branch_id is not null
      )
    order by mb.branch_id, mb.menu_item_id
      for update;

  with c as (
    select r.item_id, r.expected_cents, r.price_cents
      from jsonb_to_recordset(p_changes)
        as r(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
     where r.branch_id is null
  ), upd as (
    update public.menu_items m
       set price_cents = c.price_cents
      from c
     where m.id = c.item_id
       and m.tenant_id = p_tenant_id
       and m.price_cents = c.expected_cents
       and m.price_cents <> c.price_cents
    returning m.id as item_id, c.expected_cents, c.price_cents
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', u.item_id, 'branch_id', null,
           'from_cents', u.expected_cents, 'to_cents', u.price_cents)), '[]'::jsonb)
    into v_menu_applied
    from upd u;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', c.item_id, 'branch_id', null,
           'reason', case when m.id is null then 'missing' else 'changed' end,
           'current_cents', m.price_cents)), '[]'::jsonb)
    into v_menu_failed
    from jsonb_to_recordset(p_changes)
      as c(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
    left join public.menu_items m on m.id = c.item_id and m.tenant_id = p_tenant_id
   where c.branch_id is null
     and (m.id is null or m.price_cents <> c.price_cents);

  with c as (
    select r.item_id, r.branch_id, r.expected_cents, r.price_cents
      from jsonb_to_recordset(p_changes)
        as r(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
     where r.branch_id is not null
  ), upd as (
    update public.menu_item_branches mb
       set price_cents = c.price_cents,
           updated_by = v_user
      from c
     where mb.branch_id = c.branch_id
       and mb.menu_item_id = c.item_id
       and mb.tenant_id = p_tenant_id
       and mb.price_cents is not distinct from c.expected_cents
       and mb.price_cents is distinct from c.price_cents
    returning mb.menu_item_id as item_id, mb.branch_id, c.expected_cents, c.price_cents
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', u.item_id, 'branch_id', u.branch_id,
           'from_cents', u.expected_cents, 'to_cents', u.price_cents)), '[]'::jsonb)
    into v_own_updated
    from upd u;

  with c as (
    select r.item_id, r.branch_id, r.expected_cents, r.price_cents
      from jsonb_to_recordset(p_changes)
        as r(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
     where r.branch_id is not null
  ), ins as (
    insert into public.menu_item_branches (branch_id, menu_item_id, tenant_id, price_cents, updated_by)
    select c.branch_id, c.item_id, p_tenant_id, c.price_cents, v_user
      from c
      join public.menu_items m on m.id = c.item_id and m.tenant_id = p_tenant_id
     where c.expected_cents is null
       and c.price_cents is not null
       and not exists (
         select 1 from public.menu_item_branches mb
          where mb.branch_id = c.branch_id and mb.menu_item_id = c.item_id
       )
    on conflict (branch_id, menu_item_id) do nothing
    returning menu_item_id as item_id, branch_id, price_cents
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.item_id, 'branch_id', i.branch_id,
           'from_cents', null, 'to_cents', i.price_cents)), '[]'::jsonb)
    into v_own_inserted
    from ins i;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', c.item_id, 'branch_id', c.branch_id,
           'reason', case when m.id is null then 'missing' else 'changed' end,
           'current_cents', mb.price_cents)), '[]'::jsonb)
    into v_own_failed
    from jsonb_to_recordset(p_changes)
      as c(item_id uuid, branch_id uuid, expected_cents bigint, price_cents bigint)
    left join public.menu_items m on m.id = c.item_id and m.tenant_id = p_tenant_id
    left join public.menu_item_branches mb
      on mb.branch_id = c.branch_id and mb.menu_item_id = c.item_id and mb.tenant_id = p_tenant_id
   where c.branch_id is not null
     and (m.id is null or mb.price_cents is distinct from c.price_cents);

  perform set_config('pos.price_batch', coalesce(v_before, ''), true);

  return jsonb_build_object(
    'batch_id', v_batch,
    'applied', v_menu_applied || v_own_updated || v_own_inserted,
    'failed', v_menu_failed || v_own_failed
  );
end;
$$;

comment on function public.menu_apply_price_changes(uuid, jsonb, boolean) is
  'Carta: aplica una lista de cambios de precio en una sola operación (entera o nada). Cada precio se cambia solo si sigue valiendo lo esperado; con p_batch quedan marcados como una tanda en el historial.';

revoke all on function public.menu_apply_price_changes(uuid, jsonb, boolean) from public, anon;
grant execute on function public.menu_apply_price_changes(uuid, jsonb, boolean) to authenticated;

-- Candado de salida: quedó exactamente lo previsto, y nada más.
do $guard$
declare
  v_ok integer;
  v_bad text;
begin
  select count(*) into v_ok
    from pg_proc p
   where p.oid = 'public.menu_apply_price_changes(uuid, jsonb, boolean)'::regprocedure
     and md5(p.prosrc) = 'd6fb998cce16f2edfb4e5ef3d343b746';
  if v_ok <> 1 then
    raise exception 'candado: menu_apply_price_changes no es la del archivo';
  end if;

  select count(*) into v_ok
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where p.xmin = pg_current_xact_id()::xid and ns.nspname in ('public', 'private');
  if v_ok <> 1 then
    raise exception 'candado: se tocaron % funciones y tenía que ser 1', v_ok;
  end if;

  -- Corre con los permisos de quien llama, sin camino de búsqueda, y sin sesión no se la puede llamar.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.oid = 'public.menu_apply_price_changes(uuid, jsonb, boolean)'::regprocedure
     and (p.prosecdef
          or p.proconfig::text is distinct from '{"search_path=\"\""}'
          or has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'candado: permisos o atributos que no son los previstos en: %', v_bad;
  end if;
end
$guard$;

notify pgrst, 'reload schema';
