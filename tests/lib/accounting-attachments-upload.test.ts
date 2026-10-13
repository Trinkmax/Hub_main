/**
 * La subida de la foto del comprobante del lado del navegador, con el
 * servidor, Storage y el achicador simulados. Lo que importa: qué se achica y
 * qué va tal cual, que cada archivo que falla vuelva con su motivo sin frenar a
 * los demás, y que un formulario que ya guardó avise (sin reintentar nada).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/accounting/actions/attachments', () => ({
  prepareAttachmentUploads: vi.fn(),
  registerDocumentAttachments: vi.fn(),
}))
vi.mock('@/lib/supabase/browser', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/menu/upload-image', () => ({ processImageForUpload: vi.fn() }))

import { toast } from 'sonner'
import {
  attachPendingFiles,
  uploadDocumentAttachments,
  uploadPendingAttachments,
} from '@/components/administracion/adjuntos/upload'
import {
  prepareAttachmentUploads,
  registerDocumentAttachments,
} from '@/lib/accounting/actions/attachments'
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MESSAGES,
  pendingAttachmentsMessage,
} from '@/lib/accounting/attachments'
import { processImageForUpload } from '@/lib/menu/upload-image'
import { createClient } from '@/lib/supabase/browser'

const SLUG = 'hub'
const DOC = '1111aaaa-1111-4111-8111-11111111bbbb'
const MB = 1024 * 1024

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

type Uploaded = { bucket: string; path: string; size: number; contentType: string | undefined }

/** Storage del navegador: anota lo que se sube; `failPaths` devuelve error para esas rutas. */
function fakeStorage(opts: { failPaths?: string[]; throwPaths?: string[] } = {}) {
  const uploaded: Uploaded[] = []
  vi.mocked(createClient).mockReturnValue({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, blob: Blob, options?: { contentType?: string }) => {
          if (opts.throwPaths?.includes(path)) throw new TypeError('Failed to fetch')
          if (opts.failPaths?.includes(path)) {
            return { data: null, error: { name: 'StorageApiError', message: 'denied' } }
          }
          uploaded.push({ bucket, path, size: blob.size, contentType: options?.contentType })
          return { data: { path }, error: null }
        },
      }),
    },
  } as never)
  return uploaded
}

/** El servidor da una ruta por archivo (`p1.jpg`, `p2.pdf`…) y registra todo lo que le llega. */
function serverOk() {
  vi.mocked(prepareAttachmentUploads).mockImplementation(async (_slug, raw) => {
    const { files } = raw as { files: Array<{ mimeType: string }> }
    return {
      ok: true,
      data: { paths: files.map((f, i) => `p${i + 1}.${f.mimeType.split('/')[1]}`) },
      message: '',
    }
  })
  vi.mocked(registerDocumentAttachments).mockImplementation(async (_slug, raw) => {
    const { files } = raw as { files: unknown[] }
    return { ok: true, data: { saved: files.length, failed: [] }, message: '' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  serverOk()
  vi.mocked(processImageForUpload).mockImplementation(async () => ({
    blob: new Blob([new Uint8Array(200_000)], { type: 'image/webp' }),
    ext: 'webp',
    contentType: 'image/webp',
  }))
})

describe('uploadDocumentAttachments', () => {
  it('un PDF va tal cual: ruta del servidor, subida directa y registro', async () => {
    const uploaded = fakeStorage()
    const pdf = file('Factura A 0003.pdf', 'application/pdf', 300_000)
    const result = await uploadDocumentAttachments(SLUG, DOC, [pdf])

    expect(result).toEqual({ uploaded: 1, failed: [] })
    expect(processImageForUpload).not.toHaveBeenCalled()
    expect(prepareAttachmentUploads).toHaveBeenCalledWith(SLUG, {
      documentId: DOC,
      files: [{ mimeType: 'application/pdf', sizeBytes: 300_000 }],
    })
    expect(uploaded).toEqual([
      { bucket: ATTACHMENT_BUCKET, path: 'p1.pdf', size: 300_000, contentType: 'application/pdf' },
    ])
    expect(registerDocumentAttachments).toHaveBeenCalledWith(SLUG, {
      documentId: DOC,
      files: [
        {
          path: 'p1.pdf',
          fileName: 'Factura A 0003.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 300_000,
        },
      ],
    })
  })

  it('una foto grande se achica; una chica en un formato común va tal cual', async () => {
    const uploaded = fakeStorage()
    const big = file('IMG_0001.jpg', 'image/jpeg', 4 * MB)
    const small = file('tique.png', 'image/png', 180_000)
    const result = await uploadDocumentAttachments(SLUG, DOC, [big, small])

    expect(result.uploaded).toBe(2)
    expect(processImageForUpload).toHaveBeenCalledTimes(1)
    expect(processImageForUpload).toHaveBeenCalledWith(big)
    expect(uploaded.map((u) => [u.contentType, u.size])).toEqual([
      ['image/webp', 200_000],
      ['image/png', 180_000],
    ])
  })

  it('una foto que pesa más que el tope entra si achicada queda por debajo', async () => {
    fakeStorage()
    const huge = file('camara.jpg', 'image/jpeg', 14 * MB)
    expect((await uploadDocumentAttachments(SLUG, DOC, [huge])).uploaded).toBe(1)
  })

  it('HEIC que el navegador no puede leer: va el original', async () => {
    vi.mocked(processImageForUpload).mockRejectedValue(new Error('decode'))
    const uploaded = fakeStorage()
    const heic = file('IMG_0002.HEIC', '', 2 * MB)
    const result = await uploadDocumentAttachments(SLUG, DOC, [heic])
    expect(result).toEqual({ uploaded: 1, failed: [] })
    expect(uploaded[0]).toMatchObject({ contentType: 'image/heic', size: 2 * MB })
  })

  it('una imagen ilegible de un formato que el bucket no guarda no se sube', async () => {
    vi.mocked(processImageForUpload).mockRejectedValue(new Error('decode'))
    fakeStorage()
    const bmp = file('escaneo.bmp', 'image/bmp', 2 * MB)
    const result = await uploadDocumentAttachments(SLUG, DOC, [bmp])
    expect(result).toEqual({
      uploaded: 0,
      failed: [{ file: bmp, message: ATTACHMENT_MESSAGES.unreadableImage }],
    })
    expect(prepareAttachmentUploads).not.toHaveBeenCalled()
  })

  it('una foto que no se pudo achicar y pesa más de 10 MB no se sube', async () => {
    vi.mocked(processImageForUpload).mockRejectedValue(new Error('memoria'))
    fakeStorage()
    const huge = file('camara.jpg', 'image/jpeg', 12 * MB)
    const result = await uploadDocumentAttachments(SLUG, DOC, [huge])
    expect(result.failed).toEqual([{ file: huge, message: ATTACHMENT_MESSAGES.tooBig }])
  })

  it('lo que no es foto ni PDF se rechaza sin frenar al resto', async () => {
    const uploaded = fakeStorage()
    const sheet = file('planilla.xlsx', 'application/vnd.ms-excel', 1000)
    const pdf = file('remito.pdf', 'application/pdf', 1000)
    const result = await uploadDocumentAttachments(SLUG, DOC, [sheet, pdf])
    expect(result).toEqual({
      uploaded: 1,
      failed: [{ file: sheet, message: ATTACHMENT_MESSAGES.type }],
    })
    expect(uploaded).toHaveLength(1)
  })

  it('hasta 5 por vez: los que sobran vuelven como fallidos', async () => {
    fakeStorage()
    const files = Array.from({ length: 7 }, (_, i) => file(`f${i}.pdf`, 'application/pdf', 100))
    const result = await uploadDocumentAttachments(SLUG, DOC, files)
    expect(result.uploaded).toBe(5)
    expect(result.failed.map((f) => [f.file.name, f.message])).toEqual([
      ['f5.pdf', ATTACHMENT_MESSAGES.limit],
      ['f6.pdf', ATTACHMENT_MESSAGES.limit],
    ])
  })

  it('si el servidor no da lugar (o no hay permiso), no se sube nada', async () => {
    const uploaded = fakeStorage()
    vi.mocked(prepareAttachmentUploads).mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'Un comprobante lleva hasta 5 archivos. Quitá uno para sumar otro.',
    })
    const a = file('a.pdf', 'application/pdf', 100)
    const b = file('b.pdf', 'application/pdf', 100)
    const result = await uploadDocumentAttachments(SLUG, DOC, [a, b])
    expect(result.uploaded).toBe(0)
    expect(result.failed.map((f) => f.message)).toEqual([
      'Un comprobante lleva hasta 5 archivos. Quitá uno para sumar otro.',
      'Un comprobante lleva hasta 5 archivos. Quitá uno para sumar otro.',
    ])
    expect(uploaded).toEqual([])
    expect(registerDocumentAttachments).not.toHaveBeenCalled()
  })

  it('sin conexión al pedir las rutas: vuelve como fallido, no tira', async () => {
    fakeStorage()
    vi.mocked(prepareAttachmentUploads).mockRejectedValue(new TypeError('Failed to fetch'))
    const a = file('a.pdf', 'application/pdf', 100)
    expect(await uploadDocumentAttachments(SLUG, DOC, [a])).toEqual({
      uploaded: 0,
      failed: [{ file: a, message: ATTACHMENT_MESSAGES.offline }],
    })
  })

  it('el que Storage rechaza o se corta no se registra; los demás sí', async () => {
    fakeStorage({ failPaths: ['p1.pdf'], throwPaths: ['p3.pdf'] })
    const [a, b, c] = ['a', 'b', 'c'].map((n) => file(`${n}.pdf`, 'application/pdf', 100)) as [
      File,
      File,
      File,
    ]
    const result = await uploadDocumentAttachments(SLUG, DOC, [a, b, c])
    expect(result).toEqual({
      uploaded: 1,
      failed: [
        { file: a, message: ATTACHMENT_MESSAGES.upload },
        { file: c, message: ATTACHMENT_MESSAGES.offline },
      ],
    })
    const registered = vi.mocked(registerDocumentAttachments).mock.calls[0]?.[1] as {
      files: Array<{ path: string }>
    }
    expect(registered.files.map((f) => f.path)).toEqual(['p2.pdf'])
  })

  it('si no subió ninguno, no se llama a registrar', async () => {
    fakeStorage({ failPaths: ['p1.pdf'] })
    await uploadDocumentAttachments(SLUG, DOC, [file('a.pdf', 'application/pdf', 100)])
    expect(registerDocumentAttachments).not.toHaveBeenCalled()
  })

  it('lo que la base no acepta al registrar vuelve con su motivo, por archivo', async () => {
    fakeStorage()
    vi.mocked(registerDocumentAttachments).mockResolvedValue({
      ok: true,
      data: { saved: 1, failed: [{ path: 'p2.pdf', message: 'Hasta 5.' }] },
      message: '',
    })
    const a = file('a.pdf', 'application/pdf', 100)
    const b = file('b.pdf', 'application/pdf', 100)
    expect(await uploadDocumentAttachments(SLUG, DOC, [a, b])).toEqual({
      uploaded: 1,
      failed: [{ file: b, message: 'Hasta 5.' }],
    })
  })

  it('si registrar falla entero o se corta, todos vuelven como fallidos', async () => {
    fakeStorage()
    const a = file('a.pdf', 'application/pdf', 100)
    vi.mocked(registerDocumentAttachments).mockResolvedValue({
      ok: false,
      code: 'forbidden',
      message: 'Tu sesión venció. Volvé a entrar.',
    })
    expect(await uploadDocumentAttachments(SLUG, DOC, [a])).toEqual({
      uploaded: 0,
      failed: [{ file: a, message: 'Tu sesión venció. Volvé a entrar.' }],
    })
    vi.mocked(registerDocumentAttachments).mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await uploadDocumentAttachments(SLUG, DOC, [a])).toEqual({
      uploaded: 0,
      failed: [{ file: a, message: ATTACHMENT_MESSAGES.offline }],
    })
  })

  it('uploadPendingAttachments sin archivos no llama a nadie', async () => {
    fakeStorage()
    expect(await uploadPendingAttachments(SLUG, DOC, [])).toEqual({ uploaded: 0, failed: [] })
    expect(prepareAttachmentUploads).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('attachPendingFiles (después de guardar un formulario)', () => {
  const pdf = () => file('factura.pdf', 'application/pdf', 100)

  it('sin archivos o sin comprobante no hace nada', async () => {
    fakeStorage()
    const openDocument = vi.fn()
    await attachPendingFiles({ tenantSlug: SLUG, documentId: DOC, files: [], openDocument })
    await attachPendingFiles({ tenantSlug: SLUG, documentId: null, files: [pdf()], openDocument })
    expect(prepareAttachmentUploads).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('si sube todo, no avisa nada (el formulario ya mostró que guardó)', async () => {
    fakeStorage()
    await attachPendingFiles({
      tenantSlug: SLUG,
      documentId: DOC,
      files: [pdf(), pdf()],
      openDocument: vi.fn(),
    })
    expect(registerDocumentAttachments).toHaveBeenCalledTimes(1)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('si alguno no sube, avisa que el comprobante quedó guardado y ofrece abrirlo', async () => {
    fakeStorage({ failPaths: ['p2.pdf'] })
    const openDocument = vi.fn()
    await attachPendingFiles({
      tenantSlug: SLUG,
      documentId: DOC,
      files: [pdf(), pdf(), pdf()],
      openDocument,
    })
    expect(toast.warning).toHaveBeenCalledTimes(1)
    const [message, options] = vi.mocked(toast.warning).mock.calls[0] ?? []
    expect(message).toBe(pendingAttachmentsMessage(1, 3))
    const action = (options as { action: { label: string; onClick: () => void } }).action
    expect(action.label).toBe('Abrir el comprobante')
    action.onClick()
    expect(openDocument).toHaveBeenCalledWith(DOC)
  })

  it('si no sube ninguno (sin conexión), avisa igual y nunca tira', async () => {
    fakeStorage()
    vi.mocked(prepareAttachmentUploads).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      attachPendingFiles({
        tenantSlug: SLUG,
        documentId: DOC,
        files: [pdf()],
        openDocument: vi.fn(),
      }),
    ).resolves.toBeUndefined()
    expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toBe(pendingAttachmentsMessage(1, 1))
  })
})
