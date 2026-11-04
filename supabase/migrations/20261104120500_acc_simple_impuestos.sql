-- Reunión del 29/10/2026 (Luciano, min. 49 y 54): «ese número se debería crear solo». Los porcentajes con los que el
-- sistema calcula Ingresos Brutos y Comercio e Industria en cada cierre, y el impuesto a los débitos y créditos en
-- cada pago con banco o billetera. Todos editables: los valores salen de lo que dijeron en la reunión y los revisa
-- la contadora (Comercio e Industria se dijo «0,007» y «0,007 %»: quedó 0,7 %).
--   · acc_settings.tax_settings (los bp son centésimas de punto: 300 = 3 %).
--   · acc_treasury_accounts.charges_bank_tax: null = según el tipo (banco y billetera sí, efectivo no).
--   · acc_save_tax_settings y acc_set_treasury_bank_tax.
-- Aditivo: dos columnas y dos RPC. Ningún cálculo corre hasta que el código nuevo esté en producción.

alter table public.acc_settings
  add column tax_settings jsonb not null default
    '{"auto": true, "iibb_bp": 300, "municipal_bp": 70, "bank_tax_bp": 60, "base": "invoiced_net"}'::jsonb;
comment on column public.acc_settings.tax_settings is
  'Impuestos automáticos: auto (bool), iibb_bp, municipal_bp, bank_tax_bp (centésimas de punto) y base (invoiced_net: lo facturado sin IVA; all_sales: todo lo vendido).';

alter table public.acc_treasury_accounts
  add column charges_bank_tax boolean;
comment on column public.acc_treasury_accounts.charges_bank_tax is
  '¿Al salir plata de esta cuenta se calcula el impuesto a los débitos y créditos? null = según el tipo: banco y billetera sí.';

create function public.acc_save_tax_settings(p_tenant_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_auto boolean;
  v_iibb integer;
  v_muni integer;
  v_bank integer;
  v_base text;
  v_new jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  if jsonb_typeof(p_settings) is distinct from 'object' then
    perform private.acc_raise('invalid_payload', '{"field":"settings"}');
  end if;
  v_auto := (p_settings ->> 'auto')::boolean;
  v_iibb := (p_settings ->> 'iibb_bp')::integer;
  v_muni := (p_settings ->> 'municipal_bp')::integer;
  v_bank := (p_settings ->> 'bank_tax_bp')::integer;
  v_base := p_settings ->> 'base';
  if v_auto is null or v_base is null or v_base not in ('invoiced_net', 'all_sales')
     or v_iibb is null or v_iibb not between 0 and 10000
     or v_muni is null or v_muni not between 0 and 10000
     or v_bank is null or v_bank not between 0 and 10000 then
    perform private.acc_raise('invalid_payload', '{"field":"settings"}');
  end if;
  v_new := jsonb_build_object('auto', v_auto, 'iibb_bp', v_iibb, 'municipal_bp', v_muni, 'bank_tax_bp', v_bank,
                              'base', v_base);
  update public.acc_settings s
     set tax_settings = v_new, updated_at = now()
   where s.tenant_id = p_tenant_id;
  if not found then
    perform private.acc_raise('invalid_payload', '{"field":"tenant"}');
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_settings.tax_settings_saved', 'acc_settings', p_tenant_id, v_new);
  return v_new;
end;
$$;
comment on function public.acc_save_tax_settings(uuid, jsonb) is
  'Guarda los porcentajes de los impuestos automáticos. Solo dueños con acceso.';
revoke all on function public.acc_save_tax_settings(uuid, jsonb) from public, anon;
grant execute on function public.acc_save_tax_settings(uuid, jsonb) to authenticated;

create function public.acc_set_treasury_bank_tax(p_tenant_id uuid, p_treasury_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform public.acc_assert_writer(p_tenant_id);
  update public.acc_treasury_accounts t
     set charges_bank_tax = p_value, updated_by = v_uid, updated_at = now()
   where t.id = p_treasury_id and t.tenant_id = p_tenant_id;
  if not found then
    perform private.acc_raise('invalid_payload', '{"field":"treasury"}');
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_treasury.bank_tax_set', 'acc_treasury_accounts', p_treasury_id,
    jsonb_build_object('value', p_value));
end;
$$;
revoke all on function public.acc_set_treasury_bank_tax(uuid, uuid, boolean) from public, anon;
grant execute on function public.acc_set_treasury_bank_tax(uuid, uuid, boolean) to authenticated;
