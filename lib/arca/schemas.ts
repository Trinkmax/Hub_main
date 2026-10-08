/**
 * Validación de la entrada de las acciones de ARCA (diseño §2.3 y §3.1). Sin
 * `'use server'`: el mismo esquema sirve para los errores al tipear en el
 * formulario y como verdad en el servidor.
 *
 * Mensajes escritos a mano en rioplatense (zod no tiene locale global y sin
 * mensaje propio contesta en inglés). Las reglas que dependen de la base (que en
 * producción la CUIT del certificado sea la de la SAS, que el alias no cambie con
 * un certificado subido) las decide la acción o la RPC.
 */

import { z } from 'zod'
import { cuitField, formBool, formInt, updatedAtField } from '@/lib/accounting/schemas'
import { ARCA_ENVIRONMENTS } from './endpoints'
import { ARCA_GUIDE_STEP_IDS } from './guide'

const DATA_MESSAGE = 'Revisá los datos.'

function obj<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.object(shape, { message: DATA_MESSAGE })
}

// ─── Campos ──────────────────────────────────────────────────────────────────

export const environmentField = z.enum(ARCA_ENVIRONMENTS, {
  message: 'Elegí el ambiente (producción u homologación).',
})

export const ALIAS_MESSAGE =
  'El alias va con letras y números, sin espacios ni símbolos (de 3 a 30 caracteres).'

/** Alias del certificado (CN del pedido = alias en ARCA). Se pasa a minúsculas. */
export const aliasField = z
  .string({ message: ALIAS_MESSAGE })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{3,30}$/, ALIAS_MESSAGE)

/** CUIT opcional: vacío o ausente → `null`. */
const optionalCuit = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
  cuitField.nullable(),
)

/** `updated_at` que vio la pantalla (opcional: sin él, la acción usa el de la base). */
const optionalUpdatedAt = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  updatedAtField.nullable(),
)

export const POINT_OF_SALE_MESSAGE = 'Revisá el punto de venta: va de 1 a 99998.'

// ─── Clave y pedido del certificado (paso 5) ─────────────────────────────────

export const CERTIFICATE_MODES = ['new', 'replace', 'renew'] as const
export type CertificateMode = (typeof CERTIFICATE_MODES)[number]

/**
 * `startArcaCertificate`. `mode`: `new` la primera vez; `replace` empieza de cero
 * (pisa el certificado subido: la pantalla lo pide después de que la base contesta
 * `arca_key_replace_requires_confirm`); `renew` deja una clave nueva pendiente sin
 * tocar la vigente (mismo alias y misma CUIT). `certCuit`: en producción es la de
 * la SAS (si viene otra, error); en homologación, la CUIT personal de quien usa
 * WSASS (si no viene, la del pedido anterior).
 */
export const startCertificateSchema = obj({
  environment: environmentField,
  alias: aliasField,
  certCuit: optionalCuit.default(null),
  mode: z
    .enum(CERTIFICATE_MODES, { message: 'Recargá la página y probá de nuevo.' })
    .default('new'),
})
export type StartCertificateInput = z.infer<typeof startCertificateSchema>

// ─── Certificado (paso 6) ────────────────────────────────────────────────────

/**
 * Tope del archivo del certificado: el mismo `CERT_UPLOAD_MAX_BYTES` de `pem.ts`
 * (16 KB). Se repite acá porque `pem.ts` usa `Buffer` y este módulo corre también en
 * el navegador (un test vigila que sean iguales).
 */
export const CERT_FILE_MAX_BYTES = 16 * 1024

/** Tope del texto base64 (16 KB de archivo → ~21,9 KB en base64, más el prefijo `data:`). */
const FILE_BASE64_MAX = Math.ceil(CERT_FILE_MAX_BYTES / 3) * 4 + 200

export const UNREADABLE_CERT_MESSAGE =
  'No pudimos leer el archivo. Tiene que ser el .crt que bajaste de ARCA.'

/**
 * `uploadArcaCertificate`. `fileBase64`: el archivo en base64, o como
 * `data:…;base64,…` (lo que da `FileReader.readAsDataURL`).
 */
export const uploadCertificateSchema = obj({
  environment: environmentField,
  fileBase64: z
    .string({ message: UNREADABLE_CERT_MESSAGE })
    .trim()
    .min(1, UNREADABLE_CERT_MESSAGE)
    .max(FILE_BASE64_MAX, UNREADABLE_CERT_MESSAGE),
  expectedUpdatedAt: optionalUpdatedAt,
})
export type UploadCertificateInput = z.infer<typeof uploadCertificateSchema>

/**
 * El archivo del certificado: base64 (con o sin `data:`) → bytes; `null` si no se
 * lee o pasa de 16 KB. Sin `Buffer` (corre igual en el navegador).
 */
export function decodeUploadedFile(file: string): Uint8Array | null {
  const body = file.replace(/^data:[^,]{0,120};base64,/i, '').replace(/\s+/g, '')
  if (body.length === 0 || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    return null
  }
  let binary: string
  try {
    binary = atob(body)
  } catch {
    return null
  }
  if (binary.length === 0 || binary.length > CERT_FILE_MAX_BYTES) return null
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── Punto de venta y datos de la conexión ───────────────────────────────────

export const pointOfSaleSchema = obj({
  environment: environmentField,
  pointOfSale: formInt({ min: 1, max: 99_998, message: POINT_OF_SALE_MESSAGE }),
  expectedUpdatedAt: optionalUpdatedAt,
})
export type PointOfSaleInput = z.infer<typeof pointOfSaleSchema>

export const ARCA_CLASSES = ['A', 'B', 'A51', 'ACBU'] as const
export type ArcaClass = (typeof ARCA_CLASSES)[number]

/**
 * `saveArcaSettings`: solo viajan las claves que mandó la pantalla. `allowedClasses`
 * siempre suma la `B`. Prender la emisión es solo para producción (y la base
 * exige además la conexión probada y el punto de venta).
 */
export const arcaSettingsSchema = obj({
  environment: environmentField,
  alias: aliasField.optional(),
  allowedClasses: z
    .array(z.enum(ARCA_CLASSES, { message: 'Elegí qué Factura A te autorizó ARCA.' }), {
      message: 'Elegí qué Factura A te autorizó ARCA.',
    })
    .max(4, 'Elegí qué Factura A te autorizó ARCA.')
    .transform((list) => [...new Set<ArcaClass>(['B', ...list])].sort())
    .optional(),
  defaultConcepto: z
    .union([z.literal(1), z.literal(2), z.literal(3)], {
      message: 'Elegí si facturás productos, servicios o los dos.',
    })
    .optional(),
  emissionEnabled: formBool.optional(),
  expectedUpdatedAt: optionalUpdatedAt,
}).superRefine((v, ctx) => {
  if (v.emissionEnabled === true && v.environment !== 'produccion') {
    ctx.addIssue({
      code: 'custom',
      path: ['emissionEnabled'],
      message: 'La emisión se prende solo en producción: en homologación se prueba aparte.',
    })
  }
})
export type ArcaSettingsInput = z.infer<typeof arcaSettingsSchema>

// ─── Probar, desconectar, bajar el pedido ────────────────────────────────────

export const environmentSchema = obj({ environment: environmentField })
export type EnvironmentInput = z.infer<typeof environmentSchema>

export const DISCONNECT_CONFIRMATION = 'DESCONECTAR'

export const disconnectSchema = obj({
  environment: environmentField,
  confirm: z
    .string({ message: 'Para confirmar, escribí DESCONECTAR tal cual.' })
    .trim()
    .refine((v) => v === DISCONNECT_CONFIRMATION, 'Para confirmar, escribí DESCONECTAR tal cual.'),
})
export type DisconnectInput = z.infer<typeof disconnectSchema>

export const csrDownloadSchema = obj({
  environment: environmentField,
  /** El pedido de la renovación en curso (no el vigente). */
  pending: formBool.default(false),
})

// ─── Guías ───────────────────────────────────────────────────────────────────

const STEP_MESSAGE = 'Ese paso no existe. Recargá la página y probá de nuevo.'

export const guideMarkSchema = obj({
  guide: z.enum(['arca', 'arranque'], { message: STEP_MESSAGE }),
  step: z.string({ message: STEP_MESSAGE }).regex(/^[a-z0-9_]{2,40}$/, STEP_MESSAGE),
  done: formBool,
}).superRefine((v, ctx) => {
  if (v.guide === 'arca' && !(ARCA_GUIDE_STEP_IDS as readonly string[]).includes(v.step)) {
    ctx.addIssue({ code: 'custom', path: ['step'], message: STEP_MESSAGE })
  }
})
export type GuideMarkInput = z.infer<typeof guideMarkSchema>

// ─── «Completar con ARCA» ────────────────────────────────────────────────────

export const lookupCuitSchema = obj({
  cuit: cuitField,
  purpose: z
    .enum(['supplier', 'customer'], { message: 'Recargá la página y probá de nuevo.' })
    .default('supplier'),
  /** Saltear la caché de 30 días (botón «Volver a consultar»). */
  refresh: formBool.default(false),
})
export type LookupCuitInput = z.infer<typeof lookupCuitSchema>
