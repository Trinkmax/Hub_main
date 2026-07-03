-- Fix crítico (auditoría mensajería): defensa en profundidad de grants.
--
-- anon tenía ALL (arwdDxtm) sobre todas las tablas de public, incluido TRUNCATE
-- — que RLS NO cubre (es una operación table-level, no row-level). La fuente es
-- un default privilege de `postgres` que otorga ALL a anon/authenticated en cada
-- tabla nueva (por eso hasta las tablas de loyalty salieron con ALL para anon).
--
-- Se revoca lo innecesario en las tablas actuales y se cierra el default
-- privilege. Se mantiene SELECT/INSERT para anon (capture/QR lo usan, contenido
-- por RLS) y el DML completo para authenticated (la app escribe con ese rol).
-- Idempotente (revoke de algo ya ausente es no-op).

revoke update, delete, truncate, references, trigger
  on all tables in schema public from anon;

revoke truncate, references, trigger
  on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
