-- Pedido de los socios del 16/11/2026: «que el campo del número de factura no sea obligatorio».
-- Una COMPRA (factura, nota de débito o de crédito, recibo) puede ir sin punto de venta ni número, igual que el
-- tique desde el 29/10/2026 (`acc_simple_tique_sin_numero`). Sin número no entra al Libro IVA, y la aplicación
-- tampoco le toma el IVA: el total va entero a la imputación. Con número sigue yendo al libro, como siempre.
-- Lo que emite el bar (ventas) no cambia: sigue llevando número.
-- Afloja una sola regla: ninguna fila existente cambia.
--   · adoc_numbered_vouchers: en una compra, el número va entero o no va (los dos, o ninguno).
--   · acc_check_document cambia dos condiciones (número obligatorio y fila del libro): se parcha la definición
--     vigente y falla si no encuentra exactamente lo que espera, o si la función no es la que se revisó.
-- Aplicada en producción el 16/11/2026 (versión 20261116131711) con un candado de entrada y otro de salida
-- (la huella de acc_check_document antes y después), que acá no van: las huellas son de esa base.
-- Reversa: volver a poner la constraint y las dos condiciones de `acc_simple_tique_sin_numero` (exige que no haya
-- compras sin número que no sean tiques).


alter table public.acc_documents drop constraint adoc_numbered_vouchers;
alter table public.acc_documents add constraint adoc_numbered_vouchers check (
       voucher_type is null
    or voucher_type in ('ddjj_impuesto', 'sin_comprobante', 'tique')
    or kind = 'expense'
    or (point_of_sale is not null and number is not null)
    or (kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note')
        and point_of_sale is null and number is null));

do $patch$
declare
  v_def text := pg_get_functiondef('private.acc_check_document(uuid, jsonb, jsonb)'::regprocedure);
  v_a text := $t$if v_numbered and v_kind <> 'expense' and (v_pos is null or v_num is null) and not (v_vt = 'tique' and v_pos is null and v_num is null) then$t$;
  v_a2 text := $t$if v_numbered and v_kind <> 'expense' and (v_pos is null or v_num is null) and not ((v_purchase or v_vt = 'tique') and v_pos is null and v_num is null) then$t$;
  v_b text := $t$when v_purchase or v_sales_doc then case when v_ivabook and not (v_vt = 'tique' and v_num is null) then 'required' else 'forbidden' end$t$;
  v_b2 text := $t$when v_purchase or v_sales_doc then case when v_ivabook and not ((v_purchase or v_vt = 'tique') and v_num is null) then 'required' else 'forbidden' end$t$;
begin
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1
     or (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'acc_factura_sin_numero: no encontré las condiciones a cambiar';
  end if;
  execute replace(replace(v_def, v_a, v_a2), v_b, v_b2);
end;
$patch$;
