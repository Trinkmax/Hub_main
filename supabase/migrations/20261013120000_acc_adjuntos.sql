-- Foto del comprobante: lo que pidieron los socios de HUB el 12/10/2026 (punto 1.5).
--   «En todas las compras, poder cargar la foto de la factura o del comprobante.»
--   · acc_document_attachments: los archivos de un comprobante (hasta 5: fotos o PDF). Solo se agregan y
--     se quitan (sin updated_at). No tocan el asiento ni los libros: se pueden sumar con el mes cerrado.
--   · Bucket PRIVADO acc-comprobantes (10 MB por archivo; JPG, PNG, WebP, AVIF, HEIC/HEIF y PDF). El
--     archivo vive en <tenant_id>/<document_id>/<uuid>.<ext>. AVIF está en la lista porque el achicador
--     de fotos del navegador (lib/menu/upload-image.ts) lo prefiere cuando el equipo lo soporta.
--   · Cómo se sube: el navegador manda el archivo directo a Storage con la sesión de la persona (una
--     Server Action no puede llevar una foto de celular) y después acc_attach_document_file lo registra.
--     Las políticas de storage.objects dejan leer a quien lee Administración de ese bar (dueños con
--     acceso y la contadora) y subir o borrar solo a quien escribe (la contadora, nunca).
--   · Quitar: acc_detach_document_file borra la fila y devuelve la ruta; el archivo lo borra el servidor
--     por la API de Storage (borrarlo por SQL lo dejaría huérfano en el bucket).
-- Todo aditivo: una tabla, un bucket, tres políticas y dos RPC nuevas.

-- Crea políticas en storage.objects (la usan las fotos de la carta y los mensajes): si está tomada,
-- fallar rápido y reintentar antes que encolar tráfico.
set local lock_timeout = '5s';

-- ─── 1. Tabla ────────────────────────────────────────────────────────────────
create table public.acc_document_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  storage_path text not null,                         -- <tenant_id>/<document_id>/<uuid>.<ext> en acc-comprobantes
  file_name text not null,                            -- el nombre con que se muestra (no entra a la auditoría)
  mime_type text not null,
  size_bytes bigint not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint adat_id_tenant_uq unique (id, tenant_id),
  constraint adat_path_uq unique (storage_path),
  constraint adat_path_shape check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|avif|heic|heif|pdf)$'
    and left(storage_path, 74) = tenant_id::text || '/' || document_id::text || '/'),
  constraint adat_file_name_len check (char_length(btrim(file_name)) between 1 and 120),
  constraint adat_mime check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'application/pdf')),
  constraint adat_size check (size_bytes between 1 and 10485760),
  -- Si el comprobante se borra (solo pasa en el reinicio de I.6 o al borrar el bar), sus filas se van con él.
  constraint adat_doc_same_tenant foreign key (document_id, tenant_id)
    references public.acc_documents (id, tenant_id) on delete cascade
);
-- Los archivos de un comprobante, en el orden en que se subieron. Cubre las FK al bar y al comprobante.
create index adat_document_idx on public.acc_document_attachments (tenant_id, document_id, created_at);
create index adat_created_by_idx on public.acc_document_attachments (created_by) where created_by is not null;
comment on table public.acc_document_attachments is
  'Archivos adjuntos de un comprobante (foto o PDF de la factura, el tique o el remito): hasta 5. El archivo vive en el bucket privado acc-comprobantes.';
comment on column public.acc_document_attachments.storage_path is
  'Ruta en el bucket acc-comprobantes: <tenant_id>/<document_id>/<uuid>.<ext>.';

-- ─── 2. RLS y privilegios (mismo patrón que el resto de acc_*) ───────────────
-- Leen quienes leen Administración del bar; se escribe solo por las RPC de abajo.
alter table public.acc_document_attachments enable row level security;
revoke all on public.acc_document_attachments from anon, authenticated;
grant select on public.acc_document_attachments to authenticated;
create policy adat_select_readers on public.acc_document_attachments
  for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

-- ─── 3. Bucket privado ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'acc-comprobantes',
  'acc-comprobantes',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Una carpeta por bar. La carpeta se compara como texto (sin cast a uuid): un nombre raro da «denegado»,
-- no un error de la consulta. Sin política de UPDATE: un archivo no se pisa ni se mueve.
drop policy if exists "acc_comprobantes_reader_select" on storage.objects;
create policy "acc_comprobantes_reader_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'acc-comprobantes'
    and (storage.foldername(name))[1] in (select r.id::text from public.acc_reader_tenant_ids() as r(id))
  );

drop policy if exists "acc_comprobantes_writer_insert" on storage.objects;
create policy "acc_comprobantes_writer_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'acc-comprobantes'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|avif|heic|heif|pdf)$'
    and (storage.foldername(name))[1] in (select w.id::text from public.acc_writer_tenant_ids() as w(id))
  );

drop policy if exists "acc_comprobantes_writer_delete" on storage.objects;
create policy "acc_comprobantes_writer_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'acc-comprobantes'
    and (storage.foldername(name))[1] in (select w.id::text from public.acc_writer_tenant_ids() as w(id))
  );

-- ─── 4. Registrar un archivo ya subido ───────────────────────────────────────
-- El archivo tiene que estar en el bucket, en la carpeta de ESE comprobante de ESE bar. Hasta 5 por
-- comprobante (attachment_limit). Repetir la llamada con la misma ruta devuelve la fila que ya estaba
-- (un reintento después de un corte no duplica ni falla).
create function public.acc_attach_document_file(p_tenant_id uuid, p_document_id uuid, p_path text, p_file_name text,
                                                p_mime_type text, p_size_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_document_attachments;
  v_ext text;
  v_name text;
  v_count int;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_document_id is null or not exists (select 1 from public.acc_documents d
                                           where d.id = p_document_id and d.tenant_id = p_tenant_id) then
    raise exception 'document_not_found' using errcode = 'P0001';
  end if;

  v_ext := case p_mime_type
             when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
             when 'image/avif' then 'avif' when 'image/heic' then 'heic' when 'image/heif' then 'heif'
             when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'mime_type';
  end if;
  if p_path is null
     or p_path !~ ('^' || p_tenant_id::text || '/' || p_document_id::text || '/[0-9a-f-]{36}\.' || v_ext || '$') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'path';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'size_bytes';
  end if;
  -- El nombre es solo para mostrar: sin caracteres de control, hasta 120.
  v_name := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g')), 120);
  if v_name = '' then
    v_name := 'comprobante.' || v_ext;
  end if;

  select * into v_row from public.acc_document_attachments a
   where a.storage_path = p_path and a.tenant_id = p_tenant_id;
  if found then
    return to_jsonb(v_row);
  end if;

  if not exists (select 1 from storage.objects o where o.bucket_id = 'acc-comprobantes' and o.name = p_path) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'object';
  end if;
  select count(*) into v_count from public.acc_document_attachments a
   where a.tenant_id = p_tenant_id and a.document_id = p_document_id;
  if v_count >= 5 then
    raise exception 'attachment_limit' using errcode = 'P0001';
  end if;

  insert into public.acc_document_attachments (tenant_id, document_id, storage_path, file_name, mime_type,
                                               size_bytes, created_by)
  values (p_tenant_id, p_document_id, p_path, v_name, p_mime_type, p_size_bytes, v_uid)
  returning * into v_row;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.attachment_added', 'acc_document', p_document_id,
    jsonb_build_object('attachment_id', v_row.id, 'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes));
  return to_jsonb(v_row);
end;
$$;

-- ─── 5. Quitar un archivo ────────────────────────────────────────────────────
-- Borra la fila y devuelve la ruta para que el servidor borre el archivo del bucket. Si la fila ya no
-- está (otra persona lo quitó recién), devuelve removed = false: quitar dos veces no es un error.
create function public.acc_detach_document_file(p_tenant_id uuid, p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_document_attachments;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  delete from public.acc_document_attachments a
   where a.id = p_attachment_id and a.tenant_id = p_tenant_id
  returning * into v_row;
  if not found then
    return jsonb_build_object('id', p_attachment_id, 'removed', false);
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.attachment_removed', 'acc_document', v_row.document_id,
    jsonb_build_object('attachment_id', v_row.id, 'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes));
  return jsonb_build_object('id', v_row.id, 'removed', true, 'document_id', v_row.document_id,
                            'storage_path', v_row.storage_path);
end;
$$;

-- ─── 6. Comentarios y permisos ───────────────────────────────────────────────
comment on function public.acc_attach_document_file(uuid, uuid, text, text, text, bigint) is
  'Registra un archivo ya subido al bucket acc-comprobantes como adjunto de un comprobante (hasta 5: attachment_limit). Devuelve la fila.';
comment on function public.acc_detach_document_file(uuid, uuid) is
  'Quita un adjunto de un comprobante. Devuelve {id, removed, document_id, storage_path}: el archivo se borra aparte, por la API de Storage.';

revoke all on function public.acc_attach_document_file(uuid, uuid, text, text, text, bigint) from public, anon;
grant execute on function public.acc_attach_document_file(uuid, uuid, text, text, text, bigint) to authenticated;
revoke all on function public.acc_detach_document_file(uuid, uuid) from public, anon;
grant execute on function public.acc_detach_document_file(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
