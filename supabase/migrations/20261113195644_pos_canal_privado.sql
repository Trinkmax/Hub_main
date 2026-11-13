-- Punto de venta, parte 7: el canal en vivo deja de ser público (docs/features/pos.md › En vivo).
--
-- Cada vez que algo cambia en el salón, la base manda un aviso sin datos («algo cambió, volvé a mirar») al
-- canal `pos:<sucursal>` y las pantallas vuelven a leer lo suyo. Ese canal era público: no lleva datos,
-- pero cualquiera con la clave pública del proyecto y el id de una sucursal podía escucharlo (y saber
-- cuándo se mueve el salón de un bar) o mandarle avisos falsos para hacer releer a todas las pantallas.
--
-- Ahora es privado:
--   · la base manda el aviso al canal privado (`realtime.send(..., true)`);
--   · Realtime deja entrar solo a quien pasa la política de abajo: alguien con un rol en el bar de esa
--     sucursal (los mismos roles que ya pueden leer la sucursal);
--   · nadie puede mandar desde el navegador: no hay política de escritura.
--
-- Qué toca de lo que ya existe: redefine UNA función (`private.pos_poke`, el mismo cuerpo con el canal
-- privado) y agrega UNA política de lectura en `realtime.messages`, que hoy no tiene ninguna. No cambia
-- tablas, permisos ni datos. Los canales públicos que usa el resto del sistema no se enteran.
--
-- Para volver atrás: `drop policy pos_live_listen on realtime.messages;` y redefinir `private.pos_poke`
-- con `false` en el último argumento (el archivo `20261113020745_pos_salon_en_vivo.sql` tiene el original).
--
-- El cuerpo no lleva renglones de comentario a propósito: así su md5 es el mismo se aplique este archivo
-- tal cual o sin comentarios.

set local lock_timeout = '5s';

-- Candado de entrada: lo que se va a tocar tiene que estar como en el ensayo (producción al 13/11).
do $pre$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = 'private.pos_poke(uuid, text, uuid)'::regprocedure)
     is distinct from 'c9a488ee724234e7cb7e4ca278eff698' then
    raise exception 'candado: pos_poke ya no es la del ensayo';
  end if;
  if exists (
    select 1 from pg_policy pol
     where pol.polrelid = 'realtime.messages'::regclass
  ) then
    raise exception 'candado: realtime.messages ya tiene políticas; hay que mirarlas antes de sumar otra';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) then
    raise exception 'candado: realtime.messages no tiene la seguridad por fila prendida';
  end if;
end
$pre$;

create or replace function private.pos_poke(p_branch_id uuid, p_what text, p_session_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('what', p_what, 'session_id', p_session_id),
    'poke',
    'pos:' || p_branch_id::text,
    true
  );
exception when others then
  null;
end;
$$;

-- Quién puede escuchar `pos:<sucursal>`: quien tiene un rol en el bar de esa sucursal. La sucursal se lee
-- con los permisos de quien pregunta (la de otro bar ni se ve) y además se pide el rol de forma explícita.
-- Un nombre de canal que no tiene esa forma no entra (y no rompe: el texto no se convierte si no es un id).
create policy pos_live_listen on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
        from public.branches b
       where b.id = (
               case
                 when (select realtime.topic()) ~ '^pos:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                 then substring((select realtime.topic()) from 5)::uuid
               end
             )
         and public.user_role_in_tenant(b.tenant_id) is not null
    )
  );

-- Candado de salida: quedó exactamente lo previsto, y nada más.
do $guard$
declare
  v_ok integer;
  v_bad text;
begin
  select count(*) into v_ok
    from pg_proc p
   where p.oid = 'private.pos_poke(uuid, text, uuid)'::regprocedure
     and md5(p.prosrc) = 'df4a1c6ba16f4b120ebfb4b53363b9db';
  if v_ok <> 1 then
    raise exception 'candado: pos_poke no es la del archivo';
  end if;

  select count(*) into v_ok
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where p.xmin = pg_current_xact_id()::xid and ns.nspname in ('public', 'private');
  if v_ok <> 1 then
    raise exception 'candado: se tocaron % funciones y tenía que ser 1', v_ok;
  end if;

  -- La función sigue siendo interna: definer, sin camino de búsqueda y sin que nadie de afuera la llame.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.oid = 'private.pos_poke(uuid, text, uuid)'::regprocedure
     and (not p.prosecdef
          or p.proconfig::text is distinct from '{"search_path=\"\""}'
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'candado: permisos o atributos que no son los previstos en: %', v_bad;
  end if;

  -- Una sola política en realtime.messages: de lectura, para quien tiene sesión, y nada de escritura.
  select count(*) into v_ok
    from pg_policy pol
   where pol.polrelid = 'realtime.messages'::regclass;
  if v_ok <> 1 then
    raise exception 'candado: realtime.messages quedó con % políticas y tenía que ser 1', v_ok;
  end if;
  select count(*) into v_ok
    from pg_policy pol
   where pol.polrelid = 'realtime.messages'::regclass
     and pol.polname = 'pos_live_listen'
     and pol.polcmd = 'r'
     and pol.polpermissive
     and pol.polroles = array[(select r.oid from pg_roles r where r.rolname = 'authenticated')];
  if v_ok <> 1 then
    raise exception 'candado: la política no quedó como estaba prevista';
  end if;
end
$guard$;
