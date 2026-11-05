-- Impuestos automáticos (reunión del 29/10/2026), aprobado por Nacho el 04/11. Dos reglas del motor, solo suman:
--   · acc_line_rule: un cierre del día puede llevar renglones `manual`: los de Ingresos Brutos y Comercio e Industria
--     viajan dentro del mismo asiento, así que se anulan y se corrigen con él.
--   · acc_post_bundle: un pago, una compra pagada, un gasto o un movimiento de caja pueden guardarse junto con un gasto
--     bancario (el impuesto a los débitos y créditos), en la misma transacción.
-- Se parcha la definición vigente y falla si no encuentra exactamente lo que espera. Lo ya cargado no cambia.
-- Reversa: sacar la fila de acc_line_rule y las dos condiciones de la composición.

do $patch$
declare
  v_def text := pg_get_functiondef('private.acc_line_rule(text, text)'::regprocedure);
  v_old text := $t$('sales_close', 'treasury', '{debit}', 'treasury'),$t$;
  v_new text := $t$('sales_close', 'manual', '{debit,credit}', 'any_postable'),
      ('sales_close', 'treasury', '{debit}', 'treasury'),$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'acc_line_rule: no encontré la fila';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.acc_post_bundle(uuid, uuid, jsonb)'::regprocedure);
  v_old text := $t$or (v_n = 2 and v_kinds[1] = 'purchase' and v_kinds[2] = 'payment')$t$;
  v_new text := $t$or (v_n = 2 and v_kinds[1] = 'purchase' and v_kinds[2] = 'payment')
          or (v_n = 3 and v_kinds[1] = 'purchase' and v_kinds[2] = 'payment' and v_kinds[3] = 'bank_expense')
          or (v_n = 2 and v_kinds[1] in ('payment', 'expense', 'cash_movement') and v_kinds[2] = 'bank_expense')$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'acc_post_bundle: no encontré la composición';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
