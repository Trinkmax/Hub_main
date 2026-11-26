-- ============================================================
-- Punto de venta · el aviso de cocina le llega siempre a quien atiende la mesa (26/11/2026)
-- ============================================================
-- Ajuste a `pos_estaciones_mozos_avisos`.
--
-- El disparador que avisa «en preparación / para retirar» salteaba a quien había hecho el movimiento:
-- si la persona que atiende la mesa era la misma que la avanzaba en la cocina, no se generaba aviso. La
-- idea era no avisarle a alguien de algo que acababa de hacer, pero en la práctica es al revés: quien
-- atiende quiere que le suene el teléfono cuando su pedido sale, lo haya marcado quien lo haya marcado.
-- Pasa cuando un dueño atiende mesas y la pantalla de cocina está abierta con su mismo usuario (y fue
-- lo primero que probó Nacho: el celular no sonó).
--
-- Queda: se avisa SIEMPRE a quien atiende la mesa (o, si no la atiende nadie, a quien cargó el pedido).
-- La pantalla de cocina no muestra esos avisos (eso lo resuelve la app), así que a la cocina no le
-- aparece nada nuevo.
--
-- Qué toca: una condición del cuerpo de `private.pos_tg_items_progress()`. Se parcha sobre la
-- definición vigente, como las lecturas de la migración anterior. No toca datos.

set local lock_timeout = '5s';

do $$
declare
  v_fn regprocedure := 'private.pos_tg_items_progress()'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_old text := E'\n         and l.user_id is distinct from v_me';
  v_hits integer := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
begin
  if v_hits <> 1 then
    raise exception 'pos_avisos: la condición aparece % veces en % (tenía que ser una)', v_hits, v_fn;
  end if;
  execute replace(v_def, v_old, '');
end $$;
