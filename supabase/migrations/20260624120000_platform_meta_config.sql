-- ============================================================
-- platform_meta_config: credenciales de la Meta App de HUB (GLOBAL de plataforma).
-- 1 sola fila (id = true). Editable sólo por superadmins; el runtime la lee por service_role.
-- app_secret cifrado con pgp_sym_encrypt (encrypt_meta_token / META_TOKEN_KEY). Fallback a env en código.
-- ============================================================
create table if not exists public.platform_meta_config (
  id boolean primary key default true,
  constraint platform_meta_config_singleton check (id),  -- fuerza una única fila (id = true)
  app_id text,
  app_secret_encrypted text,        -- pgp_sym_encrypt(app_secret, META_TOKEN_KEY)
  webhook_verify_token text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.platform_meta_config enable row level security;

drop policy if exists "platform_meta_config_admin_all" on public.platform_meta_config;
create policy "platform_meta_config_admin_all" on public.platform_meta_config
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update on public.platform_meta_config to authenticated;
