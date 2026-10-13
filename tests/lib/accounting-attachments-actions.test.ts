/**
 * Acciones de la foto del comprobante, con la base, Storage y el permiso
 * simulados. Lo que importa: que la ruta la decida el servidor, que nada se
 * registre fuera de la carpeta del comprobante, que el archivo que la base
 * rechaza no quede suelto en el bucket, y que quitar borre fila y archivo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/accounting/queries/attachments', () => ({ getDocumentAttachmentUrl: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { authorizeAccounting } from '@/lib/accounting/access'
import {
  fetchDocumentAttachmentUrl,
  prepareAttachmentUploads,
  registerDocumentAttachments,
  removeDocumentAttachment,
} from '@/lib/accounting/actions/attachments'
import { ATTACHMENT_BUCKET, parseAttachmentPath } from '@/lib/accounting/attachments'
import { ACC_ERRORS } from '@/lib/accounting/errors'
import { getDocumentAttachmentUrl } from '@/lib/accounting/queries/attachments'
import { createClient } from '@/lib/supabase/server'

const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-0000000000aa'
const DOC = '1111aaaa-1111-4111-8111-11111111bbbb'
const OTHER_DOC = '2222aaaa-2222-4222-8222-22222222bbbb'
const ATTACHMENT = '4444aaaa-4444-4444-8444-44444444bbbb'
const path = (n: number, ext = 'jpg', doc = DOC) =>
  `${TENANT}/${doc}/3333cccc-3333-4333-8333-33333333ddd${n}.${ext}`

type RpcReply = { data: unknown; error: { message: string; code?: string } | null }

/** Lo mínimo de supabase-js que usan las acciones. */
function fakeSupabase(
  opts: {
    doc?: { id: string } | null
    count?: number
    rpc?: (fn: string, args: Record<string, unknown>) => RpcReply
    removeFails?: boolean
  } = {},
) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const removed: Array<{ bucket: string; paths: string[] }> = []
  const client = {
    from(table: string) {
      if (table === 'acc_documents') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: opts.doc === undefined ? { id: DOC } : opts.doc,
            error: null,
          }),
        }
        return chain
      }
      // acc_document_attachments: select(count).eq(tenant).eq(document) → se espera el segundo eq.
      const eq = vi.fn()
      const chain = { select: () => chain, eq }
      eq.mockReturnValueOnce(chain).mockReturnValueOnce(
        Promise.resolve({ data: null, count: opts.count ?? 0, error: null }),
      )
      return chain
    },
    rpc: async (fn: string, args: Record<string, unknown>): Promise<RpcReply> => {
      rpcCalls.push({ fn, args })
      return opts.rpc ? opts.rpc(fn, args) : { data: { id: ATTACHMENT }, error: null }
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths })
          return opts.removeFails
            ? { data: null, error: { name: 'StorageApiError', message: 'no' } }
            : { data: [], error: null }
        },
      }),
    },
  }
  vi.mocked(createClient).mockResolvedValue(client as never)
  return { rpcCalls, removed }
}

function allow() {
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: '9999aaaa-9999-4999-8999-99999999bbbb',
    slug: SLUG,
    access: {} as never,
  })
}

function deny() {
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: false,
    state: { ok: false, code: 'forbidden', message: ACC_ERRORS.forbidden.message },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  allow()
})

describe('prepareAttachmentUploads', () => {
  it('pide permiso de escritura y devuelve una ruta por archivo, en la carpeta del comprobante', async () => {
    fakeSupabase({ count: 1 })
    const result = await prepareAttachmentUploads(SLUG, {
      documentId: DOC.toUpperCase(),
      files: [
        { mimeType: 'image/webp', sizeBytes: 200_000 },
        { mimeType: 'application/pdf', sizeBytes: 900_000 },
      ],
    })
    expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.paths).toHaveLength(2)
    const [first, second] = result.data.paths.map(parseAttachmentPath)
    expect(first).toMatchObject({ tenantId: TENANT, documentId: DOC, extension: 'webp' })
    expect(second).toMatchObject({ tenantId: TENANT, documentId: DOC, extension: 'pdf' })
    expect(first?.fileId).not.toBe(second?.fileId)
  })

  it('sin permiso no hace nada', async () => {
    deny()
    const { rpcCalls } = fakeSupabase()
    const result = await prepareAttachmentUploads(SLUG, {
      documentId: DOC,
      files: [{ mimeType: 'image/jpeg', sizeBytes: 10 }],
    })
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(createClient).not.toHaveBeenCalled()
    expect(rpcCalls).toEqual([])
  })

  it('valida tipo, peso y cantidad antes de tocar la base', async () => {
    fakeSupabase()
    for (const files of [
      [],
      [{ mimeType: 'image/gif', sizeBytes: 10 }],
      [{ mimeType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 }],
      [{ mimeType: 'image/jpeg', sizeBytes: 0 }],
      Array.from({ length: 6 }, () => ({ mimeType: 'image/jpeg', sizeBytes: 10 })),
    ]) {
      const result = await prepareAttachmentUploads(SLUG, { documentId: DOC, files })
      expect(result, JSON.stringify(files).slice(0, 60)).toMatchObject({
        ok: false,
        code: 'invalid',
      })
    }
    expect(
      await prepareAttachmentUploads(SLUG, {
        documentId: 'no-es-un-uuid',
        files: [{ mimeType: 'image/jpeg', sizeBytes: 10 }],
      }),
    ).toMatchObject({ ok: false, code: 'invalid' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('un comprobante de otro bar (o que no existe) no recibe archivos', async () => {
    fakeSupabase({ doc: null })
    const result = await prepareAttachmentUploads(SLUG, {
      documentId: DOC,
      files: [{ mimeType: 'image/jpeg', sizeBytes: 10 }],
    })
    expect(result).toMatchObject({ ok: false, detail: { key: 'document_not_found' } })
  })

  it('si no entran todos (hasta 5), no se sube ninguno', async () => {
    fakeSupabase({ count: 4 })
    const result = await prepareAttachmentUploads(SLUG, {
      documentId: DOC,
      files: [
        { mimeType: 'image/jpeg', sizeBytes: 10 },
        { mimeType: 'image/jpeg', sizeBytes: 10 },
      ],
    })
    expect(result).toMatchObject({
      ok: false,
      message: ACC_ERRORS.attachment_limit.message,
      detail: { key: 'attachment_limit' },
    })
  })
})

describe('registerDocumentAttachments', () => {
  const file = (n: number, ext = 'jpg', mimeType = 'image/jpeg') => ({
    path: path(n, ext),
    fileName: `IMG_000${n}.HEIC`,
    mimeType,
    sizeBytes: 150_000,
  })

  it('registra cada archivo con el nombre prolijo y revalida una sola vez', async () => {
    const { rpcCalls, removed } = fakeSupabase()
    const result = await registerDocumentAttachments(SLUG, {
      documentId: DOC,
      files: [file(1), file(2, 'pdf', 'application/pdf')],
    })
    expect(result).toMatchObject({
      ok: true,
      data: { saved: 2, failed: [] },
      message: '2 archivos adjuntados.',
    })
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'acc_attach_document_file',
      'acc_attach_document_file',
    ])
    expect(rpcCalls[0]?.args).toEqual({
      p_tenant_id: TENANT,
      p_document_id: DOC,
      p_path: path(1),
      p_file_name: 'IMG_0001.jpg',
      p_mime_type: 'image/jpeg',
      p_size_bytes: 150_000,
    })
    expect(rpcCalls[1]?.args.p_file_name).toBe('IMG_0002.pdf')
    expect(removed).toEqual([])
    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith(`/${SLUG}/administracion`, 'layout')
  })

  it('una ruta de otro comprobante, de otro bar o con otra extensión no se registra ni se toca', async () => {
    const { rpcCalls, removed } = fakeSupabase()
    const result = await registerDocumentAttachments(SLUG, {
      documentId: DOC,
      files: [
        { ...file(1), path: path(1, 'jpg', OTHER_DOC) },
        { ...file(2), path: path(2).replace(TENANT, '00000000-0000-4000-8000-0000000000bb') },
        { ...file(3), path: path(3, 'pdf') },
        { ...file(4), path: `${TENANT}/${DOC}/../${DOC}/x.jpg` },
      ],
    })
    expect(result.ok).toBe(false)
    expect(rpcCalls).toEqual([])
    expect(removed).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('lo que la base rechaza se borra del bucket; lo demás queda', async () => {
    const { removed } = fakeSupabase({
      rpc: (_fn, args) =>
        args.p_path === path(2)
          ? { data: null, error: { code: 'P0001', message: 'attachment_limit' } }
          : { data: { id: ATTACHMENT }, error: null },
    })
    const result = await registerDocumentAttachments(SLUG, {
      documentId: DOC,
      files: [file(1), file(2)],
    })
    expect(result).toMatchObject({
      ok: true,
      data: {
        saved: 1,
        failed: [{ path: path(2), message: ACC_ERRORS.attachment_limit.message }],
      },
      message: 'Archivo adjuntado.',
    })
    expect(removed).toEqual([{ bucket: ATTACHMENT_BUCKET, paths: [path(2)] }])
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('con un corte (sin código) no se sabe si quedó: el archivo no se borra', async () => {
    const { removed } = fakeSupabase({
      rpc: () => ({ data: null, error: { message: 'TypeError: fetch failed' } }),
    })
    const result = await registerDocumentAttachments(SLUG, { documentId: DOC, files: [file(1)] })
    expect(result).toMatchObject({ ok: false, detail: { key: 'offline' } })
    expect(removed).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('si no quedó ninguno, devuelve el motivo del primero', async () => {
    fakeSupabase({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'document_not_found' } }),
    })
    const result = await registerDocumentAttachments(SLUG, {
      documentId: DOC,
      files: [file(1), file(2)],
    })
    expect(result).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: { key: 'document_not_found' },
    })
  })

  it('sin permiso no registra', async () => {
    deny()
    const { rpcCalls } = fakeSupabase()
    const result = await registerDocumentAttachments(SLUG, { documentId: DOC, files: [file(1)] })
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(rpcCalls).toEqual([])
  })
})

describe('removeDocumentAttachment', () => {
  it('quita la fila y después el archivo del bucket', async () => {
    const { rpcCalls, removed } = fakeSupabase({
      rpc: () => ({
        data: { id: ATTACHMENT, removed: true, document_id: DOC, storage_path: path(1) },
        error: null,
      }),
    })
    const result = await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })
    expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
    expect(result).toEqual({
      ok: true,
      data: { id: ATTACHMENT, removed: true },
      message: 'Archivo quitado.',
    })
    expect(rpcCalls).toEqual([
      {
        fn: 'acc_detach_document_file',
        args: { p_tenant_id: TENANT, p_attachment_id: ATTACHMENT },
      },
    ])
    expect(removed).toEqual([{ bucket: ATTACHMENT_BUCKET, paths: [path(1)] }])
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('si ya lo habían quitado, es un «listo» y no toca el bucket', async () => {
    const { removed } = fakeSupabase({
      rpc: () => ({ data: { id: ATTACHMENT, removed: false }, error: null }),
    })
    const result = await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })
    expect(result).toMatchObject({ ok: true, data: { removed: false } })
    expect(removed).toEqual([])
  })

  it('nunca borra un archivo de la carpeta de otro bar', async () => {
    const { removed } = fakeSupabase({
      rpc: () => ({
        data: {
          id: ATTACHMENT,
          removed: true,
          storage_path: path(1).replace(TENANT, '00000000-0000-4000-8000-0000000000bb'),
        },
        error: null,
      }),
    })
    await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })
    expect(removed).toEqual([])
  })

  it('la fila ya no está aunque el archivo no se haya podido borrar', async () => {
    fakeSupabase({
      removeFails: true,
      rpc: () => ({
        data: { id: ATTACHMENT, removed: true, storage_path: path(1) },
        error: null,
      }),
    })
    const result = await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })
    expect(result.ok).toBe(true)
  })

  it('el error de la base llega con su texto, y sin permiso no llama', async () => {
    fakeSupabase({ rpc: () => ({ data: null, error: { code: '42501', message: 'forbidden' } }) })
    expect(await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    expect(revalidatePath).not.toHaveBeenCalled()

    deny()
    const { rpcCalls } = fakeSupabase()
    expect(await removeDocumentAttachment(SLUG, { attachmentId: ATTACHMENT })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    expect(rpcCalls).toEqual([])
    expect(await removeDocumentAttachment(SLUG, { attachmentId: 'x' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
  })
})

describe('fetchDocumentAttachmentUrl', () => {
  it('con acceso de lectura (la contadora) devuelve un link nuevo', async () => {
    vi.mocked(getDocumentAttachmentUrl).mockResolvedValue({ url: 'https://x/y', expiresAt: 1 })
    const result = await fetchDocumentAttachmentUrl(SLUG, { attachmentId: ATTACHMENT })
    expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'read')
    expect(getDocumentAttachmentUrl).toHaveBeenCalledWith(TENANT, ATTACHMENT)
    expect(result).toEqual({ ok: true, data: { url: 'https://x/y', expiresAt: 1 } })
  })

  it('si el adjunto ya no está, lo dice', async () => {
    vi.mocked(getDocumentAttachmentUrl).mockResolvedValue(null)
    expect(await fetchDocumentAttachmentUrl(SLUG, { attachmentId: ATTACHMENT })).toMatchObject({
      ok: false,
      code: 'conflict',
    })
  })

  it('sin acceso o con un id raro no consulta', async () => {
    deny()
    expect(await fetchDocumentAttachmentUrl(SLUG, { attachmentId: ATTACHMENT })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    allow()
    expect(await fetchDocumentAttachmentUrl(SLUG, { attachmentId: 'x' })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(getDocumentAttachmentUrl).not.toHaveBeenCalled()
  })
})
