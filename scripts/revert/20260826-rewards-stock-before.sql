-- Snapshot del stock de `rewards` de HUB ANTES de pasarlos todos a ilimitado
-- (26/08/2026, pedido del dueño: "activá todos los beneficios, ponelos en ilimitado").
--
-- Contexto: 24 de 28 recompensas tenían stock = 0, que en la billetera significa
-- AGOTADO y bloquea el canje (lib/points/engine.ts:146). Eran filas viejas,
-- previas al switch "Ilimitado"; el 0 no era una decisión, era el default.
--
-- Correr este script deshace el cambio exactamente.
update public.rewards as r
   set stock = v.stock
  from (values
    ('2fd97310-1bdc-42cc-8f30-55a96a03ffc2'::uuid, 0),
    ('bf81cf2b-fed4-4f0f-ad23-a20b8237cc74'::uuid, 0),
    ('c9eb3d2f-83f2-4659-b77e-5cd5550e0eda'::uuid, null),
    ('034c17b4-4301-41a1-a2e3-91dca85fe8ba'::uuid, 0),
    ('bee0656f-e968-4b0f-aecc-d5a4f040dcc2'::uuid, 0),
    ('5e558b2d-5b93-40ea-859c-d6320794006f'::uuid, 0),
    ('56363175-351d-45e2-8ee6-5fa5b35b4e6b'::uuid, 0),
    ('3197c394-609d-42ed-8739-b6d2760e7215'::uuid, 0),
    ('af88d2c9-879e-4cae-8609-ddd328d800fc'::uuid, 0),
    ('0a27c537-2716-4173-a9d0-536f253d2c95'::uuid, 0),
    ('bf70717a-3988-42d2-9147-588298ec409a'::uuid, 0),
    ('3667646a-f981-42a4-9873-ca0f403d3105'::uuid, 0),
    ('9ddb515a-4321-45ec-97bd-65307facb91c'::uuid, 0),
    ('1cafab57-05ff-487a-acb5-109f34363680'::uuid, 0),
    ('3ff5d5c1-0a3b-4c86-8c42-fb37130a45d1'::uuid, 0),
    ('49509e33-bce7-4b61-8050-453e8c6495f9'::uuid, 0),
    ('70505642-e0d1-4a73-8ace-0e62ed799315'::uuid, 0),
    ('d52ddba1-3c3a-47ec-a9a3-d1946933fb49'::uuid, 0),
    ('0013c9a2-2668-4e99-a6d8-776eb9085ea1'::uuid, 0),
    ('b3d7566b-f7b1-4b6c-b1e2-23d485f1a46f'::uuid, 0),
    ('335460d5-f850-426a-9f42-db630e05483f'::uuid, 0),
    ('2d67b311-f837-42f4-9197-a3282ab51d55'::uuid, 0),
    ('a03e1c5f-79bf-4dfe-89a5-7d03112530ee'::uuid, 0),
    ('78aedbe6-c651-447c-802e-350b48a9758b'::uuid, 0),
    ('9c2c2ecc-1724-4356-b361-c16da3702b3b'::uuid, 0),
    ('f51e83f1-08dd-4a95-8cf8-5b4da15e31f4'::uuid, 0),
    -- Los dos únicos con stock cargado a mano:
    ('e889fd29-1c79-4471-9da3-5ca5878bc1bf'::uuid, 20),  -- Picada para 2
    ('7381f123-f2fb-4d01-a26b-8b05a673c6d8'::uuid, 10)   -- Botella de espumante
  ) as v(id, stock)
 where r.id = v.id
   and r.tenant_id = '23cf2e05-ea4d-4004-adcf-6b2346b7d676';
