-- ============================================================
-- Dos cierres del code review de la tanda de 16
-- ============================================================
-- (1) LEY multi-tenant (CLAUDE.md §4) en `partner_benefits`.
--     `createPartnerBenefit` inserta `tenant_id` = el tenant del owner logueado
--     y `partner_id` = lo que venga del formulario, sin cruzarlos. La RLS
--     `pben_owner_insert` mira el `tenant_id` de la FILA, que es legítimo, así
--     que deja pasar la escritura: un owner podía colgarle un beneficio al
--     aliado de otro bar. No filtra datos (la billetera lista aliados por
--     tenant), pero es una escritura cross-tenant y eso es bloqueante.
--     Se cierra donde corresponde, en la DB, igual que ya se hizo con
--     `partner_benefit_tiers` — así vale para cualquier llamador futuro.
--
-- (2) `club_has_password` tenía grant a `anon`. Es un oráculo de enumeración:
--     sin rate limit y sin costo, permite preguntarle a la API "¿este teléfono
--     es socio de HUB?" de a miles. No tiene ningún llamador en la app — el
--     alta ya devuelve `has_password` dentro de su propia respuesta, que sí pasa
--     por el rate limit de la Server Action — así que se cierra sin perder nada.
-- ============================================================
create or replace function public.partner_benefits_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_tenant uuid;
begin
  select tenant_id into v_partner_tenant from public.partners where id = new.partner_id;
  if v_partner_tenant is null then
    raise exception 'partner_not_found' using errcode = 'P0001';
  end if;
  if v_partner_tenant <> new.tenant_id then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.partner_benefits_tenant_match() from public, anon, authenticated;

drop trigger if exists trg_partner_benefits_tenant_match on public.partner_benefits;
create trigger trg_partner_benefits_tenant_match
  before insert or update of partner_id, tenant_id on public.partner_benefits
  for each row execute function public.partner_benefits_tenant_match();

revoke execute on function public.club_has_password(text, text) from anon, authenticated;
