-- Resultados de los exámenes que se publican como páginas de Marketing (/p/<slug>).
--
-- La página del examen es HTML suelto que se sirve desde el host de páginas, sin sesión. Al terminar,
-- el navegador de quien rindió llama a `submit_landing_exam_result` con la clave pública; la función
-- (security definer) valida todo y escribe la fila. Nadie más escribe en la tabla: no hay grant de
-- insert/update para nadie. El dueño la lee desde el panel (Marketing → Páginas → Resultados) y puede
-- borrar un intento (una prueba, uno repetido).
--
-- Solo reciben resultados las páginas publicadas que se declaran examen con
-- `<meta name="hub-exam" content="1">`: cualquier otra landing queda afuera aunque alguien llame a la
-- función a mano.

create table if not exists public.landing_exam_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id uuid not null,

  -- La arma el celular al terminar y la repite en cada reintento: un envío que llegó pero cuya
  -- respuesta se perdió no deja la nota dos veces.
  submission_id uuid not null,

  taker_name text not null
    constraint landing_exam_results_name_check check (length(btrim(taker_name)) between 2 and 60),
  score integer not null,
  total integer not null,
  -- [{ "name": "Cafetería", "ok": 4, "of": 5 }, …] en el orden del examen.
  stations jsonb not null default '[]'::jsonb,
  -- [{ "station", "question", "picked" (null si no respondió a tiempo), "right", "ok" }, …].
  -- Se guarda el texto y no la posición: si el examen se corrige después, el resultado sigue diciendo
  -- qué vio y qué contestó esa persona.
  answers jsonb not null default '[]'::jsonb,
  duration_seconds integer not null,
  -- Veces que salió de la pantalla durante el examen (por ejemplo, para mirar la carta).
  left_screen integer not null default 0,
  -- Intento número N en ese celular.
  attempt integer not null default 1,
  -- Identificador al azar que guarda el celular: junta los intentos del mismo teléfono.
  device_id text,

  created_at timestamptz not null default now(),

  constraint landing_exam_results_score_check
    check (total between 1 and 50 and score between 0 and total),
  constraint landing_exam_results_numbers_check
    check (duration_seconds between 0 and 86400 and left_screen between 0 and 10000 and attempt between 1 and 1000),
  constraint landing_exam_results_device_check
    check (device_id is null or length(device_id) <= 64),
  constraint landing_exam_results_json_check
    check (jsonb_typeof(stations) = 'array' and jsonb_typeof(answers) = 'array'),
  constraint landing_exam_results_submission_key unique (page_id, submission_id),
  -- Compuesta, como el resto de las tablas de landings: el resultado y la página son del MISMO bar.
  constraint landing_exam_results_page_fk
    foreign key (page_id, tenant_id)
    references public.landing_pages(id, tenant_id) on delete cascade
);

comment on table public.landing_exam_results is
  'Un intento de un examen publicado como landing. Lo escribe submit_landing_exam_result(); el dueño lo lee y lo puede borrar.';

create index if not exists landing_exam_results_page_idx
  on public.landing_exam_results (tenant_id, page_id, created_at desc);

alter table public.landing_exam_results enable row level security;

drop policy if exists "landing_exam_results_owner_read" on public.landing_exam_results;
create policy "landing_exam_results_owner_read" on public.landing_exam_results
  for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "landing_exam_results_owner_delete" on public.landing_exam_results;
create policy "landing_exam_results_owner_delete" on public.landing_exam_results
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, delete on public.landing_exam_results to authenticated;
revoke all on public.landing_exam_results from anon;

-- ──────────────────────────────────────────────
-- Guardar un resultado (la llama la página del examen, sin sesión)
-- ──────────────────────────────────────────────

create or replace function public.submit_landing_exam_result(
  p_slug text,
  p_submission_id uuid,
  p_name text,
  p_score integer,
  p_total integer,
  p_stations jsonb,
  p_answers jsonb,
  p_duration_seconds integer,
  p_left_screen integer,
  p_attempt integer,
  p_device_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page uuid;
  v_tenant uuid;
  v_ok integer;
  v_recent integer;
  v_id uuid;
begin
  select lp.id, lp.tenant_id
    into v_page, v_tenant
  from public.landing_pages lp
  where lp.slug = lower(btrim(coalesce(p_slug, '')))
    and lp.published
    and position('name="hub-exam"' in lp.html) > 0;

  if v_page is null then
    raise exception 'examen no encontrado' using errcode = 'P0002';
  end if;

  if p_submission_id is null then
    raise exception 'falta el identificador del envío' using errcode = '22023';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) <> p_total
     or octet_length(p_answers::text) > 100000 then
    raise exception 'respuestas inválidas' using errcode = '22023';
  end if;

  if p_stations is null or jsonb_typeof(p_stations) <> 'array'
     or jsonb_array_length(p_stations) > 20
     or octet_length(p_stations::text) > 5000 then
    raise exception 'estaciones inválidas' using errcode = '22023';
  end if;

  -- La nota tiene que salir de las respuestas, no de lo que diga el celular.
  select count(*) into v_ok
  from jsonb_array_elements(p_answers) as a
  where jsonb_typeof(a) = 'object' and (a -> 'ok') = 'true'::jsonb;

  if v_ok <> p_score then
    raise exception 'la nota no coincide con las respuestas' using errcode = '22023';
  end if;

  -- Freno contra un bucle o un abuso: un examen no recibe más de 300 resultados en 10 minutos.
  select count(*) into v_recent
  from public.landing_exam_results r
  where r.page_id = v_page
    and r.created_at > now() - interval '10 minutes';

  if v_recent >= 300 then
    raise exception 'demasiados resultados seguidos' using errcode = '54000';
  end if;

  insert into public.landing_exam_results (
    tenant_id, page_id, submission_id, taker_name, score, total, stations, answers,
    duration_seconds, left_screen, attempt, device_id
  )
  values (
    v_tenant, v_page, p_submission_id, regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'),
    p_score, p_total, p_stations, p_answers,
    p_duration_seconds, coalesce(p_left_screen, 0), coalesce(p_attempt, 1), nullif(btrim(p_device_id), '')
  )
  on conflict (page_id, submission_id) do nothing
  returning id into v_id;

  -- Un reintento del mismo envío: devuelve el que ya estaba.
  if v_id is null then
    select r.id into v_id
    from public.landing_exam_results r
    where r.page_id = v_page and r.submission_id = p_submission_id;
  end if;

  return v_id;
end;
$$;

comment on function public.submit_landing_exam_result(text, uuid, text, integer, integer, jsonb, jsonb, integer, integer, integer, text) is
  'Guarda un intento de un examen publicado (landing con <meta name="hub-exam">). La llama la página del examen con la clave pública.';

revoke all on function public.submit_landing_exam_result(text, uuid, text, integer, integer, jsonb, jsonb, integer, integer, integer, text) from public;
grant execute on function public.submit_landing_exam_result(text, uuid, text, integer, integer, jsonb, jsonb, integer, integer, integer, text) to anon, authenticated;
