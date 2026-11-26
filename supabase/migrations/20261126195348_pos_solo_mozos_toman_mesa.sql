-- ============================================================
-- Punto de venta · solo un mozo toma una mesa por cargarle un pedido (26/11/2026)
-- ============================================================
-- Ajuste a `pos_estaciones_mozos_avisos`, antes de que la pantalla nueva salga a los bares.
--
-- La regla de esa migración era: «una mesa que todavía no atiende nadie la toma quien le carga un
-- pedido», valiendo para mozos, caja y dueños. Con el salón que bloquea al mozo las mesas de otra
-- persona, eso tenía un efecto que nadie pidió: si la caja o un dueño cargaba el primer pedido de una
-- mesa, la mesa quedaba a su nombre y a todos los mozos se les mostraba tomada.
--
-- Queda así:
--   · Solo un MOZO toma una mesa por cargarle un pedido (o por abrirla, que ya era así).
--   · La caja, un dueño o la anfitriona pueden cargarle lo que haga falta sin quedársela: la mesa sigue
--     sin nadie y la toma el primer mozo que le cargue algo. El aviso de cocina de un pedido cargado en
--     una mesa sin mozo le sigue llegando a quien lo cargó (eso no cambia).
--   · Si el encargado quiere una mesa a su nombre (o al de la caja), la pone a mano desde la ficha
--     («¿Quién atiende?»). Eso sí bloquea a los mozos, porque alguien lo decidió.
--
-- Qué toca: el cuerpo de una función de disparador y, por única vez, las mesas ABIERTAS que quedaron a
-- nombre de alguien que no es mozo desde que se aplicó la regla anterior (vuelven a «todavía nadie»).
-- No toca plata, ni pedidos, ni mesas cerradas.

set local lock_timeout = '5s';

create or replace function private.pos_tg_ticket_takes_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by_user_id is not null then
    update public.table_sessions s
       set waiter_id = new.created_by_user_id
     where s.id = new.session_id
       and s.waiter_id is null
       and s.status = 'open'
       and exists (
         select 1 from public.memberships m
          where m.tenant_id = s.tenant_id and m.user_id = new.created_by_user_id
            and m.role = 'waiter'
       );
  end if;
  return null;
end;
$$;

update public.table_sessions s
   set waiter_id = null
 where s.status = 'open'
   and s.waiter_id is not null
   and not exists (
     select 1 from public.memberships m
      where m.tenant_id = s.tenant_id and m.user_id = s.waiter_id and m.role = 'waiter'
   );

comment on column public.table_sessions.waiter_id is
  'Quién atiende la mesa: el mozo que la abrió, el primer mozo que le cargó un pedido, o quien el encargado puso a mano. A esa persona le llegan los avisos de cocina, y a los demás mozos la mesa se les muestra tomada. Vacío = todavía nadie.';
