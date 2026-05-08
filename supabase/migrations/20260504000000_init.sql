-- Migración inicial vacía. F0: solo deja preparada la estructura del repo.
-- Las tablas de negocio (tenants, memberships, audit_log, etc.) se crean en F1.

-- Habilitamos extensiones que vamos a necesitar pronto pero que son baratas hoy.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
