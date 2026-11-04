-- Lo que pidió la contadora en la reunión del 29/10/2026 y aprobó Nacho el 04/11: «reimputa y hace asientos».
--   · private.acc_assert_poster: el dueño con acceso sube cualquier comprobante; la contadora solo un bundle
--     de asientos manuales, sin partícipes nuevos.
--   · acc_post_bundle: cambia una sola línea (quién puede). El resto queda igual a la migración #9: se parcha la
--     definición vigente y falla si no encuentra exactamente lo que espera.
-- Reversa: volver a `perform public.acc_assert_writer(p_tenant_id);` y borrar la función.

create function private.acc_assert_poster(p_tenant uuid, p_bundle jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tenant in (select public.acc_writer_tenant_ids()) then
    return;
  end if;
  if p_tenant in (select public.acc_reader_tenant_ids())
     and jsonb_typeof(p_bundle -> 'documents') = 'array'
     and jsonb_array_length(p_bundle -> 'documents') between 1 and 10
     and not exists (select 1 from jsonb_array_elements(p_bundle -> 'documents') e
                      where e.value ->> 'kind' is distinct from 'manual')
     and coalesce(jsonb_array_length(nullif(p_bundle -> 'new_parties', 'null'::jsonb)), 0) = 0 then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end;
$$;
comment on function private.acc_assert_poster(uuid, jsonb) is
  'Quién puede guardar un bundle: dueño con acceso (todo), contadora (solo asientos manuales, sin partícipes nuevos).';
revoke all on function private.acc_assert_poster(uuid, jsonb) from public, anon, authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('public.acc_post_bundle(uuid, uuid, jsonb)'::regprocedure);
  v_old text := 'perform public.acc_assert_writer(p_tenant_id);';
  v_new text := 'perform private.acc_assert_poster(p_tenant_id, p_bundle);';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'acc_post_bundle: no encontré la línea a cambiar';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
