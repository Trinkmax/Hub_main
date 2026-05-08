-- Plan 5: cron RPCs (auto-abandono y expiración de punch cards).
-- Las invoca el endpoint /api/cron/* con CRON_SECRET.

-- ──────────────────────────────────────────────────────────
-- auto_abandon_stale_sessions
-- ──────────────────────────────────────────────────────────
-- Marca como 'abandoned' sesiones open con > tenant.session_auto_abandon_hours
-- sin actividad de ningún guest.
create or replace function public.auto_abandon_stale_sessions()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
  r record;
  v_threshold timestamptz;
begin
  for r in
    select ts.id, ts.tenant_id, t.session_auto_abandon_hours,
           coalesce(max(sg.last_activity_at), ts.opened_at) as last_activity
    from public.table_sessions ts
    join public.tenants t on t.id = ts.tenant_id
    left join public.session_guests sg on sg.session_id = ts.id
    where ts.status = 'open'
    group by ts.id, ts.tenant_id, t.session_auto_abandon_hours, ts.opened_at
  loop
    v_threshold := now() - (r.session_auto_abandon_hours || ' hours')::interval;
    if r.last_activity < v_threshold then
      update public.table_sessions
        set status = 'abandoned',
            abandoned_reason = 'auto_stale',
            updated_at = now()
        where id = r.id;
      insert into public.table_session_events (session_id, type, payload)
      values (
        r.id,
        'session_abandoned',
        jsonb_build_object('reason', 'auto_stale', 'last_activity', r.last_activity)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('abandoned_count', v_count);
end $$;

revoke all on function public.auto_abandon_stale_sessions() from public;
grant execute on function public.auto_abandon_stale_sessions() to service_role;

-- ──────────────────────────────────────────────────────────
-- expire_punch_cards
-- ──────────────────────────────────────────────────────────
-- Marca expired_at en cards activas que pasaron expires_after_days.
create or replace function public.expire_punch_cards()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  with expired as (
    update public.customer_punch_cards cpc
      set expired_at = now(), updated_at = now()
      from public.punch_card_templates t
      where cpc.template_id = t.id
        and cpc.completed_at is null
        and cpc.expired_at is null
        and t.expires_after_days is not null
        and cpc.started_at + (t.expires_after_days || ' days')::interval < now()
      returning cpc.id
  )
  select count(*) into v_count from expired;
  return jsonb_build_object('expired_count', v_count);
end $$;

revoke all on function public.expire_punch_cards() from public;
grant execute on function public.expire_punch_cards() to service_role;
