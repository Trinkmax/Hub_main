-- Al pagar un sueldo desde un banco o una billetera, el impuesto al cheque viaja en el mismo bundle (`withBankTax`).
-- `acc_report_payroll` unía todos los documentos del bundle, así que ese impuesto se sumaba como si fuera parte del
-- adelanto o del pago. Ahora cuenta solo el movimiento de caja. Cambia una función de lectura: no toca datos.

do $patch$
declare
  v_def text;
  v_old constant text :=
    $old$join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id and d.status = 'posted'
     where m.tenant_id = p_tenant_id and m.month = v_month),$old$;
  v_new constant text :=
    $new$join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id and d.status = 'posted'
                                      and d.kind = 'cash_movement'
     where m.tenant_id = p_tenant_id and m.month = v_month),$new$;
  v_count integer;
begin
  select pg_get_functiondef('public.acc_report_payroll(uuid, date)'::regprocedure) into v_def;
  v_count := (char_length(v_def) - char_length(replace(v_def, v_old, ''))) / char_length(v_old);
  if v_count <> 1 then
    raise exception 'acc_report_payroll: se esperaba una coincidencia y hay %', v_count;
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
