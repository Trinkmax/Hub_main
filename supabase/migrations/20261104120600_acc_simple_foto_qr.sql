-- Reunión del 29/10/2026 (min. 25): «cuando pone agregar foto, te pone un QR, lo escaneás con el celu, sacás la foto
-- y ya se carga». La compu abre un link de subida con URLs firmadas de Storage (las crea con la sesión de quien
-- carga) y el celular sube sin iniciar sesión: el token del QR es la credencial, dura poco y solo sirve para eso.
--   · acc_upload_links: el link (el token se guarda hasheado; las URLs firmadas no se leen por la API).
--   · acc_upload_link_files: lo que ya subió el celular.
--   · Cuatro RPC: crear y listar (dueños con acceso), abrir y avisar (públicas, por token).
-- Los archivos van a <tenant>/<link>/<uuid>.jpg en el bucket acc-comprobantes: esa forma ya la acepta la política de
-- subida, así que no se toca ninguna política de Storage. Al cargar el comprobante, el navegador los pasa a su
-- carpeta con el flujo de adjuntos de siempre. Aditivo.

create table public.acc_upload_links (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null,
  slots jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  constraint aul_id_tenant_uq unique (id, tenant_id),
  constraint aul_token_uq unique (token_hash),
  constraint aul_token_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint aul_slots_shape check (jsonb_typeof(slots) = 'array')
);
create index aul_tenant_idx on public.acc_upload_links (tenant_id, created_at desc);
create index aul_created_by_idx on public.acc_upload_links (created_by) where created_by is not null;
comment on table public.acc_upload_links is
  'Links de subida por QR: el celular sube la foto del comprobante sin iniciar sesión. Sin acceso directo: solo por RPC.';

create table public.acc_upload_link_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  link_id uuid not null,
  path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint aulf_path_uq unique (path),
  constraint aulf_file_name_len check (char_length(btrim(file_name)) between 1 and 120),
  constraint aulf_mime check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'application/pdf')),
  constraint aulf_size check (size_bytes between 1 and 10485760),
  constraint aulf_link_same_tenant foreign key (link_id, tenant_id)
    references public.acc_upload_links (id, tenant_id) on delete cascade
);
create index aulf_link_idx on public.acc_upload_link_files (link_id, tenant_id, created_at);
comment on table public.acc_upload_link_files is 'Archivos que el celular ya subió a un link. Sin acceso directo: solo por RPC.';

alter table public.acc_upload_links enable row level security;
alter table public.acc_upload_link_files enable row level security;
revoke all on public.acc_upload_links from anon, authenticated;
revoke all on public.acc_upload_link_files from anon, authenticated;

-- La compu crea el link con sus URLs firmadas. Devuelve las rutas de links vencidos para que el navegador las borre.
create function public.acc_upload_link_create(p_tenant_id uuid, p_link_id uuid, p_token_hash text, p_slots jsonb,
                                              p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale text[];
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_link_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) not between 1 and 10
     or p_expires_at is null or p_expires_at > now() + interval '2 hours' then
    perform private.acc_raise('invalid_payload', '{"field":"link"}');
  end if;
  insert into public.acc_upload_links (id, tenant_id, token_hash, slots, created_by, expires_at)
  values (p_link_id, p_tenant_id, p_token_hash, p_slots, (select auth.uid()), p_expires_at);

  -- Lo que quedó de links vencidos sin usar.
  select coalesce(array_agg(f.path), '{}') into v_stale
    from public.acc_upload_link_files f
    join public.acc_upload_links l on l.id = f.link_id and l.tenant_id = f.tenant_id
   where f.tenant_id = p_tenant_id and l.expires_at < now() - interval '1 day';
  delete from public.acc_upload_links l
   where l.tenant_id = p_tenant_id and l.expires_at < now() - interval '1 day';

  return jsonb_build_object('id', p_link_id, 'stale_paths', to_jsonb(v_stale));
end;
$$;
revoke all on function public.acc_upload_link_create(uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_upload_link_create(uuid, uuid, text, jsonb, timestamptz) to authenticated;

-- Lo que la compu mira mientras espera la foto.
create function public.acc_upload_link_files_list(p_tenant_id uuid, p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'file_name', f.file_name,
                                        'mime_type', f.mime_type, 'size_bytes', f.size_bytes)
                     order by f.created_at)
      from public.acc_upload_link_files f
     where f.tenant_id = p_tenant_id and f.link_id = p_link_id), '[]'::jsonb);
end;
$$;
revoke all on function public.acc_upload_link_files_list(uuid, uuid) from public, anon;
grant execute on function public.acc_upload_link_files_list(uuid, uuid) to authenticated;

-- El celular abre el QR: sin sesión. Solo devuelve lo mínimo para subir, nunca datos del bar más allá del nombre.
create function public.acc_upload_link_open(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.acc_upload_links;
  v_name text;
begin
  if p_token is null or char_length(p_token) not between 32 and 128 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into l from public.acc_upload_links x
   where x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if l.closed_at is not null or l.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select t.name into v_name from public.tenants t where t.id = l.tenant_id;
  return jsonb_build_object(
    'ok', true,
    'tenant_name', v_name,
    'bucket', 'acc-comprobantes',
    'uploaded', (select count(*) from public.acc_upload_link_files f where f.link_id = l.id and f.tenant_id = l.tenant_id),
    'slots', coalesce((
      select jsonb_agg(s.value)
        from jsonb_array_elements(l.slots) s
       where not exists (select 1 from public.acc_upload_link_files f
                          where f.tenant_id = l.tenant_id and f.path = s.value ->> 'path')), '[]'::jsonb));
end;
$$;
comment on function public.acc_upload_link_open(text) is
  'Abre un link de subida por su token (público). Devuelve las URLs firmadas que quedan y el nombre del bar.';
revoke all on function public.acc_upload_link_open(text) from public;
grant execute on function public.acc_upload_link_open(text) to anon, authenticated;

create function public.acc_upload_link_add(p_token text, p_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.acc_upload_links;
begin
  if p_token is null or char_length(p_token) not between 32 and 128 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into l from public.acc_upload_links x
   where x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or l.closed_at is not null or l.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if not exists (select 1 from jsonb_array_elements(l.slots) s where s.value ->> 'path' = p_path) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into public.acc_upload_link_files (tenant_id, link_id, path, file_name, mime_type, size_bytes)
  values (l.tenant_id, l.id, p_path, left(btrim(coalesce(nullif(p_file_name, ''), 'Foto')), 120), p_mime_type, p_size_bytes)
  on conflict (path) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.acc_upload_link_add(text, text, text, text, bigint) is
  'El celular avisa que subió un archivo a una ruta de su link (público, por token).';
revoke all on function public.acc_upload_link_add(text, text, text, text, bigint) from public;
grant execute on function public.acc_upload_link_add(text, text, text, text, bigint) to anon, authenticated;

create function public.acc_upload_link_close(p_tenant_id uuid, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  update public.acc_upload_links l set closed_at = now()
   where l.id = p_link_id and l.tenant_id = p_tenant_id and l.closed_at is null;
end;
$$;
revoke all on function public.acc_upload_link_close(uuid, uuid) from public, anon;
grant execute on function public.acc_upload_link_close(uuid, uuid) to authenticated;
