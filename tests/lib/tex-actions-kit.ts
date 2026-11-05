/**
 * Lo que comparten las pruebas de las herramientas de Tex: un bar de prueba y los lectores simulados
 * que salen de él, para correr cada herramienta de punta a punta sin base. El asiento lo arma el motor
 * de verdad (`previewDocumentForm`), con el mismo contexto de los tests del motor.
 *
 * Cada archivo de prueba declara sus `vi.mock`; acá solo se les da lo que devuelven.
 */

import { expect, vi } from 'vitest'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { listAccounts } from '@/lib/accounting/queries/accounts'
import { searchKey, searchParties } from '@/lib/accounting/queries/parties'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { DocumentForm, PreviewBundleState } from '@/lib/accounting/server/document-types'
import { runPreviewDocument } from '@/lib/accounting/server/post-document'
import type { PostingContext } from '@/lib/accounting/types'
import type { TexTicket } from '@/lib/tex/protocol'
import {
  type TexPrepared,
  type TexTool,
  type TexToolContext,
  type TexToolResult,
  toInputSchema,
} from '@/lib/tex/tools/types'

export const TEX_CTX: TexToolContext = {
  slug: 'hub',
  tenantId: '00000000-0000-4000-8000-0000000000aa',
  tenantName: 'HUB',
  userId: '00000000-0000-4000-8000-0000000000cc',
  role: 'owner',
  features: {} as never,
  isAccountant: false,
  access: { read: true, write: true, admin: false },
  today: '2026-10-31',
}

/** Los lectores que usan `lib/tex/resolve.ts` y la vista previa, todos desde el mismo contexto. */
export function stubBar(ctx: PostingContext, firstOpenDate: string | null = null): void {
  vi.mocked(tryLoadPostingContext).mockResolvedValue({ ok: true, ctx })
  vi.mocked(listTreasuryAccounts).mockResolvedValue(
    [...ctx.treasuries.values()]
      .filter((t) => t.active)
      .map((t) => ({ ...t, lastCheckedOn: null })) as never,
  )
  vi.mocked(listAccounts).mockResolvedValue(
    [...ctx.accounts.values()]
      .filter((a) => a.active)
      .map((a) => ({ ...a, manualSelectable: a.code !== '1.1.01.01.002' })) as never,
  )
  vi.mocked(searchParties).mockImplementation(async (_tenantId, params = {}) => {
    const key = searchKey(params.q ?? '')
    return [...ctx.parties.values()]
      .filter((p) => (params.kinds?.length ? params.kinds.includes(p.kind) : true))
      .filter((p) => searchKey(p.name).includes(key))
      .map((p) => ({ ...p, defaultAccountId: null })) as never
  })
  vi.mocked(runPreviewDocument).mockImplementation(
    async (_slug, request): Promise<PreviewBundleState> => {
      const { form, values } = request as { form: DocumentForm; values: unknown }
      return previewDocumentForm(form, values, ctx, { firstOpenDate })
    },
  )
}

export function toolNamed(tools: readonly TexTool[], name: string): TexTool {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`No está la herramienta ${name}`)
  return tool
}

/**
 * Lo que necesita la API y el ciclo de cada herramienta: un esquema que se pueda describir, una
 * descripción que diga que no guarda nada y los textos de lo que está haciendo.
 */
export function expectWellFormed(tools: readonly TexTool[], executors: Record<string, unknown>) {
  for (const tool of tools) {
    expect(tool.name).toMatch(/^preparar_[a-z_]+$/)
    expect(tool.description).toContain('No guarda nada')
    expect(tool.mood).toBe('working')
    const schema = toInputSchema(tool.input)
    expect(schema.type).toBe('object')
    expect(JSON.stringify(schema).length).toBeLessThan(2600)
  }
  for (const name of Object.keys(executors)) expect(name).toMatch(/^[a-z]+\.[a-z_]+$/)
}

/** Corre la herramienta como el ciclo: su entrada pasa por zod y después por `run`. */
export async function runTool(
  tools: readonly TexTool[],
  name: string,
  input: unknown,
  ctx: TexToolContext = TEX_CTX,
): Promise<TexToolResult> {
  const tool = toolNamed(tools, name)
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) throw new Error(`Entrada inválida: ${parsed.error.message}`)
  return tool.run(parsed.data, ctx)
}

export function asPrepared(result: TexToolResult): TexPrepared {
  if (result.kind !== 'prepared') {
    throw new Error(`Se esperaba un tique y vino: ${JSON.stringify(result)}`)
  }
  return result.prepared
}

export function asError(result: TexToolResult): string {
  if (result.kind !== 'error') {
    throw new Error(`Se esperaba un error y vino: ${JSON.stringify(result)}`)
  }
  return result.message
}

export type DocumentPayload = {
  form: DocumentForm
  values: Record<string, unknown>
  previewHash: string
  warningsAck: string[]
}

export function documentPayload(prepared: TexPrepared): DocumentPayload {
  return prepared.payload as DocumentPayload
}

/** Lo que importa de un tique de comprobante: el zod del formulario pasa y el asiento cuadra. */
export function expectBalanced(prepared: TexPrepared, ctx: PostingContext): void {
  const { form, values, previewHash } = documentPayload(prepared)
  const state = previewDocumentForm(form, values, ctx)
  if (!state.ok) throw new Error(`El motor no lo armó: ${JSON.stringify(state)}`)
  expect(state.preview.length).toBeGreaterThan(0)
  for (const entry of state.preview) expect(entry.balanced).toBe(true)
  // Lo que se confirma es lo que se vio: el mismo hash.
  expect(state.hash).toBe(previewHash)
}

/** El asiento del tique, en renglones para comparar. */
export function entryOf(
  ticket: Pick<TexTicket, 'entry'>,
): Array<[string, string | null, string | null]> {
  return ticket.entry.map((line) => [line.account, line.debit, line.credit])
}

export function rowValue(ticket: Pick<TexTicket, 'rows'>, label: string): string | undefined {
  return ticket.rows.find((row) => row.label === label)?.value
}
