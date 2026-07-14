-- Fix crítico (auditoría mensajería): inyección/corrupción SQL en el RPC de
-- audiencias. La versión previa inlineaba cada valor con quote_literal + un
-- regexp_replace de los placeholders $N; un valor de texto con "$3" corrompía
-- reemplazos posteriores, y el patrón es frágil ante metacaracteres.
--
-- Reescritura: los VALORES nunca entran al string SQL. Se pasan por USING como
-- un único jsonb ($2) y cada placeholder del compilador ($2, $3, …) se reemplaza
-- por `(($2->>idx)::<tipo>)`, donde <tipo> sale de una allowlist. Lo único que se
-- concatena desde los params es el nombre de tipo validado → inyección imposible
-- por construcción. Firma intacta (compilador/llamador sin cambios).
create or replace function public.evaluate_audience_query(
  p_tenant_id uuid,
  p_where text,
  p_params jsonb default '[]'::jsonb,
  p_limit integer default null
)
returns table(customer_id uuid, count_total bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sql text;
  v_values jsonb := '[]'::jsonb;
  v_param jsonb;
  v_type text;
  v_cast text;
  n int := 0;
  j int;
begin
  for v_param in select value from jsonb_array_elements(p_params) loop
    n := n + 1;
    v_values := v_values || jsonb_build_array(v_param -> 'value');
  end loop;

  v_sql := 'with matched as ('
        || ' select c.id from public.customers c'
        || ' where c.tenant_id = $1 and c.deleted_at is null and ('
        || coalesce(nullif(btrim(p_where), ''), 'true') || ')'
        || ') select id as customer_id, count(*) over () as count_total from matched';

  if p_limit is not null then
    v_sql := v_sql || ' limit ' || greatest(p_limit, 0)::text;
  end if;

  for j in 1 .. n loop
    v_type := lower(coalesce((p_params -> (j - 1)) ->> 'type', ''));
    v_cast := case v_type
                when 'uuid' then 'uuid'
                when 'text' then 'text'
                when 'int' then 'integer'
                when 'integer' then 'integer'
                when 'bigint' then 'bigint'
                when 'bool' then 'boolean'
                when 'boolean' then 'boolean'
                when 'date' then 'date'
                when 'timestamptz' then 'timestamptz'
                when 'numeric' then 'numeric'
                else null
              end;
    if v_cast is null then
      raise exception 'evaluate_audience_query: tipo de parametro no permitido: %', v_type
        using errcode = '22023';
    end if;
    v_sql := regexp_replace(
      v_sql,
      '\$' || (j + 1)::text || '(\D|$)',
      '(($2->>' || (j - 1)::text || ')::' || v_cast || ')\1',
      'g'
    );
  end loop;

  return query execute v_sql using p_tenant_id, v_values;
end;
$function$;

revoke execute on function public.evaluate_audience_query(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.evaluate_audience_query(uuid, text, jsonb, integer) to service_role;
