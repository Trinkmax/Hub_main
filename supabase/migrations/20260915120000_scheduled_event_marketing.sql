-- ============================================================
-- Pauta por fecha de evento — cuánto costó llenar cada noche
-- ============================================================
-- POR QUÉ: marketing (Nacho) pauta en Meta para cada fecha del calendario y
-- los números quedaban en el Administrador de anuncios y en un chat. El dueño
-- pidió cargarlos "ahí mismo", en la ficha del evento de «Cómo nos fue»:
-- lo gastado (USD, como lo cobra Meta), los mensajes que llegaron, y que el
-- sistema calcule el resto contra las reservas en pie de ESA fecha
-- (costo por mensaje, % de cierre, costo por reserva y por persona).
-- Opcionales: alcance, y la facturación del evento con el dólar del día para
-- el retorno.
--
-- UNA FILA POR EDICIÓN (`scheduled_events.id`). Una campaña que cubre varias
-- fechas se reparte a mano y se explica en la nota (ver BACKLOG).
--
-- "NO TUVO PAUTA" ES `ad_spend_usd_cents = 0` Y NADA MÁS: sin fila = "sin
-- cargar", que es otra cosa. El CHECK `sem_no_ads_is_bare` impide filas raras
-- (mensajes sin gasto).
--
-- QUIÉN VE ESTO: solo `owner`, SELECT incluido (es plata, igual que
-- commission_ledger). El resto del staff lee `scheduled_events`, esto no.
--
-- FK COMPUESTA SIN CASCADE, a propósito: un anfitrión puede borrar fechas del
-- calendario y no ve esta tabla; con cascade borraría datos de plata sin
-- saberlo. Así el borrado falla (23503) y la acción lo explica. Borrar el bar
-- entero sigue cascadeando (NO ACTION se chequea al final de la sentencia).
-- ============================================================

-- El destino de una FK compuesta necesita un índice único que la respalde
-- (mismo patrón que 20260904204655_cake_option_tenant_integrity).
alter table public.scheduled_events
  add constraint scheduled_events_id_tenant_unique unique (id, tenant_id);

create table if not exists public.scheduled_event_marketing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scheduled_event_id uuid not null,

  -- Importe gastado en Meta, en centavos de dólar. 0 = "no tuvo pauta".
  ad_spend_usd_cents bigint not null
    check (ad_spend_usd_cents between 0 and 10000000),
  -- «Conversaciones con mensajes iniciadas». NULL = todavía no se cargó.
  messages integer check (messages between 0 and 1000000),
  -- «Alcance» (personas distintas). Opcional.
  reach integer check (reach between 0 and 100000000),
  -- Facturación del evento en centavos de peso + el dólar con el que se pagó
  -- Meta. Van juntos o no van (sem_revenue_needs_rate).
  revenue_ars_cents bigint check (revenue_ars_cents between 0 and 100000000000),
  usd_ars_rate numeric(12, 2) check (usd_ars_rate > 0),

  notes text check (char_length(notes) <= 280),

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sem_one_per_edition unique (scheduled_event_id),
  constraint sem_event_same_tenant foreign key (scheduled_event_id, tenant_id)
    references public.scheduled_events (id, tenant_id),
  constraint sem_no_ads_is_bare check (
    ad_spend_usd_cents > 0
    or (messages is null and reach is null and revenue_ars_cents is null and usd_ars_rate is null)
  ),
  constraint sem_revenue_needs_rate check ((revenue_ars_cents is null) = (usd_ars_rate is null))
);

comment on table public.scheduled_event_marketing is
  'Pauta en Meta por edición de evento («Cómo nos fue»). Solo owner. ad_spend_usd_cents = 0 significa "no tuvo pauta"; sin fila = sin cargar.';
comment on column public.scheduled_event_marketing.messages is
  'Conversaciones con mensajes iniciadas (columna de Meta Ads). NULL = no cargado.';
comment on column public.scheduled_event_marketing.usd_ars_rate is
  'Pesos por dólar con el que se pagó la pauta. Obligatorio si hay facturación.';

-- "Último dólar usado" y el orden por carga reciente entran por acá.
create index if not exists scheduled_event_marketing_tenant_updated_idx
  on public.scheduled_event_marketing (tenant_id, updated_at desc);

drop trigger if exists scheduled_event_marketing_updated_at on public.scheduled_event_marketing;
create trigger scheduled_event_marketing_updated_at
  before update on public.scheduled_event_marketing
  for each row execute function public.set_updated_at();

alter table public.scheduled_event_marketing enable row level security;

drop policy if exists "sem_owner_all" on public.scheduled_event_marketing;
create policy "sem_owner_all" on public.scheduled_event_marketing
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- Data API GRANT (CLAUDE.md §5) + revoke de los default privileges que el
-- proyecto le regala a `anon` en cada tabla nueva de public.
grant select, insert, update, delete on public.scheduled_event_marketing to authenticated;
revoke all on public.scheduled_event_marketing from anon;

notify pgrst, 'reload schema';
