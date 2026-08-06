# Plantillas de WhatsApp — escribirlas desde el sistema

**Dónde**: Mensajería → Plantillas (`/[tenantSlug]/mensajeria/plantillas`, solo `owner`).

Meta exige que todo primer contacto (y todo mensaje fuera de la ventana de 24 h)
vaya con una plantilla aprobada. Esta pantalla las escribe, las manda a revisión
y las trae de vuelta — sin entrar nunca a Meta Business Manager.

| Pieza | Archivo |
|---|---|
| ABM + preview | `app/(manager)/[tenantSlug]/mensajeria/plantillas/*` |
| Server actions | `lib/meta/template-actions.ts` |
| Alta/baja contra Meta + upsert local | `lib/meta/templates.ts` |
| Armado de `components` (puro) | `lib/meta/template-components.ts` |
| Validación zod | `lib/meta/template-schemas.ts` |
| Errores en criollo | `lib/meta/errors.ts` → `humanizeTemplateError` |
| Catálogo de variables | `lib/broadcasts/variables.ts` |
| Sync periódico | `/api/cron/sync-templates` |

## Variables: nombres lindos arriba, posicionales abajo

**Meta solo entiende `{{1}}`, `{{2}}`…** No hay nombres del lado de la API. La
capa linda vive de este lado:

- `TEMPLATE_VARIABLES` (en `lib/broadcasts/variables.ts`) es la **fuente única**:
  clave, etiqueta corta (botón del editor), etiqueta larga (select de la
  difusión), ejemplo y ayuda. Hoy: nombre, apellido, nombre y apellido,
  teléfono, cumpleaños, puntos, y "lo completo al enviar" (texto fijo por
  difusión).
- El editor inserta el hueco **en la posición del cursor**, carga solo el
  ejemplo que Meta pide para aprobar, y guarda en
  `message_templates.variable_hints` qué dato es cada número
  (`{"1":"first_name"}`).
- La difusión lee esos hints y llega con el paso «Hacelo personal» ya resuelto.
  Una plantilla vieja sin hints cae en "Nombre", como antes.
- Al enviar, `resolveTemplateVariables` saca el dato del cliente. Si falta
  (nadie cargó el cumpleaños), usa el texto de respaldo — Meta rechaza los
  parámetros vacíos.

**Si agregás un dato al catálogo** hay que enseñarle a `resolveOne` a sacarlo del
cliente y sumar la columna al `select` de `lib/broadcasts/engine.ts`. El type de
`ResolvableCustomer` te obliga a lo primero; lo segundo no lo checkea nadie.

### Renumerado automático

Meta exige que las variables sean contiguas desde 1. Borrar el `{{1}}` del medio
dejaba `{{2}} {{3}}` y el alta se rechazaba por una regla que el dueño no tiene
por qué conocer. `renumberPositionalVars` corre en cada tecleada y reordena
texto + ejemplos + hints, así ese estado no existe. `caretOutsideVariable` evita
la otra forma de romper el texto: insertar un hueco con el cursor adentro de
otro.

## Errores

Meta contesta en inglés y por código. `humanizeTemplateError` traduce los de la
Business Management API (2388019/39/40/47/72/73/293/299 + token, rate limit y
permisos) y, para lo que no está mapeado, muestra el `error_data.details` que
manda Meta. El error crudo va a `console.error` para diagnosticar.

## Estados

`pending` → `approved` / `rejected`, sincronizado por el cron. Solo las
`approved` aparecen en el combo de difusiones.
