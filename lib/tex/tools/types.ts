import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { TexEvent, TexMood, TexTicket, TexTicketResult, TexTicketWarning } from '../protocol'

/**
 * El contrato de lo que Tex sabe hacer. Hay tres clases de herramienta:
 *
 * - **Mirar**: leen con la sesión de la persona (la RLS y las RPC deciden qué puede ver) y le devuelven
 *   datos a Tex. Corren solas.
 * - **Mostrar**: mueven la pantalla de la persona (`events`). Corren solas y no tocan la base.
 * - **Preparar**: NO escriben nada. Validan con el motor de siempre y arman un tique (`prepared`). La
 *   escritura la hace un `TexExecutor` recién cuando la persona confirma ese tique, y siempre a través
 *   de la misma acción que usa el formulario: mismos permisos, mismas validaciones, misma auditoría.
 *
 * Por eso lo que venga en un dato (el nombre de un proveedor, una nota, una foto) no puede hacer que
 * Tex escriba: hace falta el toque de una persona.
 */

export type TexToolContext = {
  slug: string
  tenantId: string
  tenantName: string
  userId: string
  /** Dueño o contadora. */
  isAccountant: boolean
  /** Lo que puede hacer esta persona en Administración. */
  access: { read: boolean; write: boolean; admin: boolean }
  /** Hoy en Córdoba (`yyyy-MM-dd`). */
  today: string
}

/** Quién puede usar la herramienta. La acción y la base lo vuelven a decidir al escribir. */
export type TexToolNeed =
  /** Cualquiera que vea Administración. */
  | 'read'
  /** Dueño con acceso de carga. */
  | 'write'
  /** Dueño con acceso de carga, o la contadora (asientos y reimputar). */
  | 'poster'

/** Lo que muestra el tique antes de confirmar: el resto lo completa el ciclo. */
export type TexTicketDraft = Omit<TexTicket, 'actionId' | 'status' | 'result' | 'error'>

export type TexPrepared = {
  /** Qué `TexExecutor` lo ejecuta. */
  executor: string
  /** Lo que recibe el ejecutor, tal cual. */
  payload: unknown
  ticket: TexTicketDraft
}

export type TexToolResult =
  | {
      kind: 'data'
      /** Lo que lee Tex. Plata en pesos con `money()`; fechas `dd/MM/yyyy`; ids para poder seguir. */
      data: unknown
      /** Eventos para la pantalla: llevar a otro lado, señalar algo. */
      events?: TexEvent[]
    }
  | { kind: 'error'; message: string }
  | { kind: 'prepared'; prepared: TexPrepared }

export type TexTool<S extends z.ZodType = z.ZodType> = {
  /** En español y con guion bajo: `ver_cajas`, `preparar_compra`. */
  name: string
  /** Para Tex: cuándo usarla y qué devuelve. Una o dos oraciones. */
  description: string
  input: S
  need: TexToolNeed
  /** Lo que se ve mientras corre: «Mirando la caja». */
  doing: (input: z.output<S>) => string
  /** Lo que queda después: «Miré la caja». */
  done: (input: z.output<S>) => string
  /** Cómo se pone Tex mientras tanto. Por defecto, `reading`. */
  mood?: TexMood
  run: (input: z.output<S>, ctx: TexToolContext) => Promise<TexToolResult>
}

/** Conserva el tipo de la entrada adentro de la herramienta y la deja guardarse en una lista común. */
export function defineTool<S extends z.ZodType>(tool: TexTool<S>): TexTool {
  return tool as unknown as TexTool
}

/** Cómo terminó la ejecución de un tique confirmado. */
export type TexExecution =
  | ({ ok: true; documentId?: string | null; data?: unknown } & TexTicketResult)
  /**
   * La acción pide que la persona vea algo antes de seguir (un aviso que solo ve la base, o el asiento
   * que cambió mientras tanto). El tique queda pendiente con esto a la vista y el payload nuevo.
   */
  | {
      ok: false
      kind: 'review'
      payload: unknown
      warnings: TexTicketWarning[]
      entry?: TexTicket['entry']
      message: string
    }
  | { ok: false; kind: 'failed'; message: string }

export type TexExecutor = {
  run: (payload: unknown, ctx: TexToolContext) => Promise<TexExecution>
}

// ─── Lo que comparten las herramientas ───────────────────────────────────────

const JSON_SCHEMA_KEYS_TO_DROP = ['$schema'] as const

/** El esquema que lee la API, generado de la misma validación que corre después. */
export function toInputSchema(schema: z.ZodType): { type: 'object'; [key: string]: unknown } {
  const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
  for (const key of JSON_SCHEMA_KEYS_TO_DROP) delete json[key]
  return { ...json, type: 'object' }
}

/** Una entrada vacía. */
export const noInput = z.object({})

/** Lo que Tex manda en pesos, como lo dice la gente. Es la única puerta de pesos a centavos. */
export const pesosField = (description?: string) => {
  const field = z.number().positive().max(100_000_000_000)
  return description ? field.describe(description) : field
}

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export const dayField = (description = 'Fecha yyyy-MM-dd.') =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(description)

export const monthField = (description = 'Mes yyyy-MM.') =>
  z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .describe(description)

const AR_WHOLE = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const AR_CENTS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Plata para que la lea Tex: `$ 12.100,50`. Con espacio común: un NBSP solo gasta tokens. */
export function money(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const whole = Number(cents) % 100 === 0
  const value = Number(cents) / 100
  const sign = value < 0 ? '-' : ''
  return `${sign}$ ${(whole ? AR_WHOLE : AR_CENTS).format(Math.abs(value))}`
}

/** `2026-11-05` → `05/11/2026`. */
export function dayText(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

/** Los campos que no vinieron bien, en una oración, para que Tex corrija o pregunte. */
export function zodIssuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** Lista corta: Tex lee lo que hace falta y sabe si hay más. */
export function capped<T>(rows: readonly T[], max: number): { filas: T[]; hay_mas: boolean } {
  return { filas: rows.slice(0, max), hay_mas: rows.length > max }
}

/** Las herramientas como las lee la API, en el mismo orden: el caché depende de eso. */
export function texApiTools(tools: readonly TexTool[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toInputSchema(tool.input) as Anthropic.Tool.InputSchema,
    eager_input_streaming: true,
  }))
}
