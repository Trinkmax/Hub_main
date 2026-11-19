-- Arreglo urgente de la tanda 1 (sucursales_acceso, 20261118163437).
--
-- membership_branches tenía tres claves (a tenants, a memberships y a branches), todas dentro de su clave primaria:
-- PostgREST la tomó como tabla puente entre esos pares y `memberships?select=tenant:tenants(...)` y
-- `branches?select=tenant:tenants(...)` pasaron a tener dos relaciones (PGRST201). Fallaban la página del QR de canje
-- (/v/…) y la vuelta al bar propio (getMembershipsForUser).
--
-- Se saca la clave a tenants: sobra, porque la fila ya cuelga de la membresía (que se borra con el bar) y de la
-- sucursal. Queda como puente solo entre membresías y sucursales, que no tenían otra relación. Los datos no cambian.

set local lock_timeout = '5s';

alter table public.membership_branches drop constraint membership_branches_tenant_id_fkey;

notify pgrst, 'reload schema';
