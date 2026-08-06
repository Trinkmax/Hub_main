import { z } from 'zod'

/**
 * Catálogo de "huecos" que se pueden meter en una plantilla de WhatsApp.
 *
 * Fuente única para tres lugares que antes no se hablaban: los botones del
 * editor de plantillas, el select de personalización de la difusión y el
 * resolvedor que arma los parámetros al enviar. Si se agrega un dato acá, hay
 * que enseñarle a `resolveOne` a sacarlo del cliente — el type lo obliga.
 *
 * Meta solo entiende variables POSICIONALES (`{{1}}`, `{{2}}`…). Los nombres
 * lindos ("Nombre", "Cumpleaños") viven de este lado: la plantilla guarda en
 * `variable_hints` qué significa cada número, y la difusión llega con el
 * mapeo ya elegido.
 */
export const VARIABLE_SOURCES = [
  'first_name',
  'last_name',
  'full_name',
  'phone',
  'birthdate',
  'points',
  'custom',
] as const

export type VariableSourceKey = (typeof VARIABLE_SOURCES)[number]

export type VariableDefinition = {
  key: VariableSourceKey
  /** Etiqueta corta — la del botón en el editor. */
  label: string
  /** Frase larga — la del select de la difusión. */
  longLabel: string
  /** Valor de muestra: sirve de ejemplo para Meta y de preview. */
  example: string
  /** Una línea explicando de dónde sale el dato. */
  hint: string
}

export const TEMPLATE_VARIABLES: readonly VariableDefinition[] = [
  {
    key: 'first_name',
    label: 'Nombre',
    longLabel: 'El nombre del cliente',
    example: 'Juan',
    hint: 'Cómo lo saludás. Es el más usado.',
  },
  {
    key: 'last_name',
    label: 'Apellido',
    longLabel: 'El apellido del cliente',
    example: 'Pérez',
    hint: 'Para mensajes más formales.',
  },
  {
    key: 'full_name',
    label: 'Nombre y apellido',
    longLabel: 'El nombre y apellido del cliente',
    example: 'Juan Pérez',
    hint: 'Los dos juntos.',
  },
  {
    key: 'phone',
    label: 'Teléfono',
    longLabel: 'El teléfono del cliente',
    example: '+54 9 351 000 0000',
    hint: 'Su número, tal como lo tenés cargado.',
  },
  {
    key: 'birthdate',
    label: 'Cumpleaños',
    longLabel: 'El cumpleaños del cliente',
    example: '15/03',
    hint: 'Día y mes. Ideal para el saludo de cumple.',
  },
  {
    key: 'points',
    label: 'Puntos',
    longLabel: 'Los puntos que tiene el cliente',
    example: '250',
    hint: 'Su saldo de puntos del club, al momento del envío.',
  },
  {
    key: 'custom',
    label: 'Lo completo al enviar',
    longLabel: 'Un texto fijo, igual para todos',
    example: 'este viernes',
    hint: 'Un texto que escribís en cada difusión: el nombre de un evento, una fecha.',
  },
] as const

export function variableDefinition(key: string): VariableDefinition | null {
  return TEMPLATE_VARIABLES.find((v) => v.key === key) ?? null
}

/** Etiqueta corta de un hueco ya mapeado, para mostrar en listas. */
export function variableLabel(key: string): string {
  return variableDefinition(key)?.label ?? 'Dato del cliente'
}

export const variableSourceSchema = z.object({
  source: z.enum(VARIABLE_SOURCES),
  value: z.string().optional(),
  fallback: z.string().optional(),
})
export const variableMappingSchema = z.record(z.string(), variableSourceSchema)
export type VariableSource = z.infer<typeof variableSourceSchema>
export type VariableMapping = z.infer<typeof variableMappingSchema>

/**
 * Lo que hace falta saber del cliente para llenar cualquier hueco del catálogo.
 * Los campos nuevos son opcionales: los envíos viejos y los previews que solo
 * tienen nombre/teléfono siguen funcionando.
 */
export type ResolvableCustomer = {
  first_name: string
  last_name: string
  phone: string
  birthdate?: string | null
  points_balance?: number | null
}

export function templateBodyParamCount(components: unknown): number {
  if (!Array.isArray(components)) return 0
  const body = components.find(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      String((c as { type?: string }).type).toUpperCase() === 'BODY',
  ) as { text?: string } | undefined
  const text = body?.text ?? ''
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g)
  return matches ? new Set(matches.map((m) => m.replace(/\D/g, ''))).size : 0
}

export function resolveTemplateVariables(
  mapping: VariableMapping,
  customer: ResolvableCustomer,
  count: number,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const def = mapping[String(i)]
    out.push(def ? resolveOne(def, customer) : '')
  }
  return out
}

/** `YYYY-MM-DD` → `dd/MM`. Sin `Date`: una fecha pelada no tiene zona horaria. */
function formatBirthdate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!match) return ''
  return `${match[3]}/${match[2]}`
}

function resolveOne(def: VariableSource, customer: ResolvableCustomer): string {
  if (def.source === 'custom') return def.value ?? ''

  let raw = ''
  switch (def.source) {
    case 'first_name':
      raw = customer.first_name
      break
    case 'last_name':
      raw = customer.last_name
      break
    case 'full_name':
      raw = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
      break
    case 'phone':
      raw = customer.phone
      break
    case 'birthdate':
      raw = customer.birthdate ? formatBirthdate(customer.birthdate) : ''
      break
    case 'points':
      // 0 es un valor válido: solo cae al fallback si no sabemos el saldo.
      raw = customer.points_balance == null ? '' : String(customer.points_balance)
      break
  }

  return raw && raw.trim().length > 0 ? raw : (def.fallback ?? '')
}
