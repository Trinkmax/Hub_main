-- Reunión del 29/10/2026: «un tique no tiene número de factura» (Tomi, min. 27). Un tique puede ir sin punto de
-- venta ni número también en una compra a deber. Sin número no entra al Libro IVA, igual que el tique de un gasto.
-- Con número sigue yendo al libro. Afloja una sola regla: ninguna fila existente cambia.
--   · adoc_numbered_vouchers suma `tique`.
--   · acc_check_document cambia dos condiciones (número obligatorio y fila del libro): se parcha la definición
--     vigente y falla si no encuentra exactamente lo que espera.
-- Reversa: volver a poner la constraint y las dos condiciones (exige que no haya tiques sin número en compras).

alter table public.acc_documents drop constraint adoc_numbered_vouchers;
alter table public.acc_documents add constraint adoc_numbered_vouchers check (
       voucher_type is null
    or voucher_type in ('ddjj_impuesto', 'sin_comprobante', 'tique')
    or kind = 'expense'
    or (point_of_sale is not null and number is not null));

do $patch$
declare
  v_def text := pg_get_functiondef('private.acc_check_document(uuid, jsonb, jsonb)'::regprocedure);
  v_a text := $t$if v_numbered and v_kind <> 'expense' and (v_pos is null or v_num is null) then$t$;
  v_a2 text := $t$if v_numbered and v_kind <> 'expense' and (v_pos is null or v_num is null) and not (v_vt = 'tique' and v_pos is null and v_num is null) then$t$;
  v_b text := $t$when v_purchase or v_sales_doc then case when v_ivabook then 'required' else 'forbidden' end$t$;
  v_b2 text := $t$when v_purchase or v_sales_doc then case when v_ivabook and not (v_vt = 'tique' and v_num is null) then 'required' else 'forbidden' end$t$;
begin
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1
     or (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'acc_check_document: no encontré las condiciones a cambiar';
  end if;
  execute replace(replace(v_def, v_a, v_a2), v_b, v_b2);
end;
$patch$;
