-- ============================================================
-- Pauta de cumpleaños — una por mes
-- ============================================================
-- POR QUÉ: el bar corre una campaña de cumpleaños en Meta todo el mes, para
-- cualquier fecha. A diferencia de la pauta de eventos (`scheduled_event_marketing`,
-- una fila por fecha de evento), esta no tiene una fecha a la que atarse: se
-- carga por MES. Pedido del dueño (23/09/2026): "poner cuánto voy gastando en
-- cumpleaños, esta cantidad de mensajes y ahí ver cuánto estamos cerrando".
--
-- CONTRA QUÉ SE MIDE (decisión del dueño): los cumpleaños RESERVADOS en el mes
-- (`salon_reservations.created_at`), sin importar para qué fecha. Es lo que
-- producen los mensajes de ese mes; los festejados en el mes se reservaron en
-- parte con los mensajes del anterior. Entran todos, también los reservados
-- dentro de un evento. La cuenta vive en `lib/salon/birthdays-report.ts`.
--
-- SIN FILA = "sin cargar". No hay «no tuvo pauta»: un mes sin campaña no se
-- carga. Por eso el gasto va de 1 centavo para arriba.
--
-- QUIÉN VE ESTO: solo `owner`, SELECT incluido (es plata), igual que
-- `scheduled_event_marketing`.
-- ============================================================

create table if not exists public.birthday_marketing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- El primer día del mes de la campaña.
  month date not null check (extract(day from month) = 1),

  -- Importe gastado en Meta, en centavos de dólar.
  ad_spend_usd_cents bigint not null
    check (ad_spend_usd_cents between 1 and 10000000),
  -- «Conversaciones con mensajes iniciadas». NULL = todavía no se cargó.
  messages integer check (messages between 0 and 1000000),
  -- «Alcance» (personas distintas). Opcional.
  reach integer check (reach between 0 and 100000000),

  notes text check (char_length(notes) <= 280),

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bm_one_per_month unique (tenant_id, month)
);

comment on table public.birthday_marketing is
  'Pauta de cumpleaños en Meta, una fila por mes («Cómo nos fue» → Cumpleaños). Solo owner. Se mide contra los cumpleaños reservados en el mes; sin fila = sin cargar.';

drop trigger if exists birthday_marketing_updated_at on public.birthday_marketing;
create trigger birthday_marketing_updated_at
  before update on public.birthday_marketing
  for each row execute function public.set_updated_at();

alter table public.birthday_marketing enable row level security;

drop policy if exists "bm_owner_all" on public.birthday_marketing;
create policy "bm_owner_all" on public.birthday_marketing
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- Data API GRANT (CLAUDE.md §5) + revoke de los default privileges que el
-- proyecto le regala a `anon` en cada tabla nueva de public.
grant select, insert, update, delete on public.birthday_marketing to authenticated;
revoke all on public.birthday_marketing from anon;

notify pgrst, 'reload schema';
