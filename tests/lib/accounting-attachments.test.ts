/**
 * Foto del comprobante: las reglas puras de los adjuntos (tipo, peso, cantidad,
 * ruta y nombre), dónde se muestra el bloque, y que la migración diga lo mismo
 * que el código.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attachmentsBlock } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_lib/attachments-view'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_BUCKET,
  ATTACHMENT_MESSAGES,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_NAME_MAX,
  attachmentExtension,
  attachmentFileName,
  attachmentKind,
  attachmentKindLabel,
  attachmentRoom,
  buildAttachmentPath,
  checkAttachmentCandidate,
  checkAttachmentUpload,
  formatAttachmentSize,
  guessAttachmentMime,
  isAttachmentMimeType,
  isAttachmentPathFor,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  MAX_ORIGINAL_IMAGE_BYTES,
  parseAttachmentPath,
  pendingAttachmentsMessage,
} from '@/lib/accounting/attachments'
import { isAccErrorKey } from '@/lib/accounting/errors'

const TENANT = '00000000-0000-4000-8000-0000000000aa'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000bb'
const DOC = '1111aaaa-1111-4111-8111-11111111bbbb'
const OTHER_DOC = '2222aaaa-2222-4222-8222-22222222bbbb'
const FILE = '3333cccc-3333-4333-8333-33333333dddd'

const MB = 1024 * 1024

describe('tipo del archivo', () => {
  it('toma el que informa el navegador y, si no informa, la extensión', () => {
    expect(guessAttachmentMime({ name: 'factura.pdf', type: 'application/pdf' })).toBe(
      'application/pdf',
    )
    expect(guessAttachmentMime({ name: 'foto', type: 'IMAGE/JPEG' })).toBe('image/jpeg')
    expect(guessAttachmentMime({ name: 'foto.jpg', type: 'image/jpg' })).toBe('image/jpeg')
    // HEIC suele llegar sin tipo (Chrome, Android).
    expect(guessAttachmentMime({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(guessAttachmentMime({ name: 'scan.PDF', type: 'application/octet-stream' })).toBe(
      'application/pdf',
    )
  })

  it('no adivina por la extensión cuando el navegador dice otra cosa', () => {
    expect(guessAttachmentMime({ name: 'virus.pdf', type: 'text/html' })).toBeNull()
    expect(guessAttachmentMime({ name: 'animado.gif', type: 'image/gif' })).toBeNull()
    expect(guessAttachmentMime({ name: 'sin-extension', type: '' })).toBeNull()
    expect(guessAttachmentMime({ name: '.pdf', type: '' })).toBeNull()
  })

  it('solo dibuja miniatura de lo que cualquier navegador muestra', () => {
    expect(attachmentKind('image/jpeg')).toBe('image')
    expect(attachmentKind('image/webp')).toBe('image')
    expect(attachmentKind('image/avif')).toBe('image')
    expect(attachmentKind('application/pdf')).toBe('pdf')
    expect(attachmentKind('image/heic')).toBe('file')
    expect(attachmentKind('cualquier/cosa')).toBe('file')
    expect(attachmentKindLabel('image')).toBe('Foto')
    expect(attachmentKindLabel('pdf')).toBe('PDF')
    expect(attachmentKindLabel('file')).toBe('Archivo')
  })

  it('cada tipo aceptado tiene su extensión', () => {
    expect(ATTACHMENT_MIME_TYPES).toHaveLength(7)
    expect(attachmentExtension('image/jpeg')).toBe('jpg')
    expect(attachmentExtension('application/pdf')).toBe('pdf')
    expect(isAttachmentMimeType('image/png')).toBe(true)
    expect(isAttachmentMimeType('image/gif')).toBe(false)
    expect(isAttachmentMimeType('toString')).toBe(false)
    expect(isAttachmentMimeType(null)).toBe(false)
  })

  it('el selector deja sacar la foto, elegirla o buscar un PDF (sin capture)', () => {
    expect(ATTACHMENT_ACCEPT).toBe('image/*,application/pdf')
  })
})

describe('lo que se puede elegir (checkAttachmentCandidate)', () => {
  it('fotos y PDF', () => {
    expect(checkAttachmentCandidate({ name: 'a.jpg', type: 'image/jpeg', size: 3 * MB })).toEqual({
      ok: true,
      kind: 'image',
    })
    expect(
      checkAttachmentCandidate({ name: 'a.pdf', type: 'application/pdf', size: 2 * MB }),
    ).toEqual({ ok: true, kind: 'pdf' })
    // Un formato que el bucket no guarda pero el navegador sabe convertir.
    expect(checkAttachmentCandidate({ name: 'a.bmp', type: 'image/bmp', size: MB })).toEqual({
      ok: true,
      kind: 'image',
    })
    expect(checkAttachmentCandidate({ name: 'IMG.HEIC', type: '', size: 2 * MB })).toEqual({
      ok: true,
      kind: 'image',
    })
  })

  it('una foto puede pesar más que el tope del bucket: se achica antes de subir', () => {
    expect(checkAttachmentCandidate({ name: 'a.jpg', type: 'image/jpeg', size: 14 * MB }).ok).toBe(
      true,
    )
    expect(
      checkAttachmentCandidate({
        name: 'a.jpg',
        type: 'image/jpeg',
        size: MAX_ORIGINAL_IMAGE_BYTES + 1,
      }),
    ).toEqual({ ok: false, message: ATTACHMENT_MESSAGES.imageTooBig })
  })

  it('el PDF va tal cual: su tope es el del bucket', () => {
    expect(
      checkAttachmentCandidate({
        name: 'a.pdf',
        type: 'application/pdf',
        size: MAX_ATTACHMENT_BYTES,
      }).ok,
    ).toBe(true)
    expect(
      checkAttachmentCandidate({
        name: 'a.pdf',
        type: 'application/pdf',
        size: MAX_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual({ ok: false, message: ATTACHMENT_MESSAGES.pdfTooBig })
  })

  it('rechaza lo que no es foto ni PDF, el SVG y lo vacío', () => {
    for (const file of [
      { name: 'planilla.xlsx', type: 'application/vnd.ms-excel', size: 100 },
      { name: 'pagina.html', type: 'text/html', size: 100 },
      { name: 'logo.svg', type: 'image/svg+xml', size: 100 },
      { name: 'sin-tipo', type: '', size: 100 },
    ]) {
      expect(checkAttachmentCandidate(file), file.name).toEqual({
        ok: false,
        message: ATTACHMENT_MESSAGES.type,
      })
    }
    expect(checkAttachmentCandidate({ name: 'a.jpg', type: 'image/jpeg', size: 0 })).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.empty,
    })
  })
})

describe('lo que se sube (checkAttachmentUpload)', () => {
  it('tipo de la lista del bucket y hasta 10 MB', () => {
    expect(checkAttachmentUpload({ mimeType: 'image/webp', sizeBytes: 200_000 })).toEqual({
      ok: true,
      mimeType: 'image/webp',
    })
    expect(
      checkAttachmentUpload({ mimeType: 'application/pdf', sizeBytes: MAX_ATTACHMENT_BYTES }).ok,
    ).toBe(true)
  })

  it('rechaza otro tipo, lo que pesa de más y los pesos raros', () => {
    expect(checkAttachmentUpload({ mimeType: 'image/gif', sizeBytes: 100 })).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.type,
    })
    expect(
      checkAttachmentUpload({ mimeType: 'image/jpeg', sizeBytes: MAX_ATTACHMENT_BYTES + 1 }),
    ).toEqual({ ok: false, message: ATTACHMENT_MESSAGES.tooBig })
    for (const sizeBytes of [0, -5, 1.5, Number.NaN]) {
      expect(
        checkAttachmentUpload({ mimeType: 'image/jpeg', sizeBytes }).ok,
        String(sizeBytes),
      ).toBe(false)
    }
  })
})

describe('hasta 5 por comprobante (attachmentRoom)', () => {
  it('reparte lo que entra y lo que queda afuera', () => {
    expect(MAX_ATTACHMENTS_PER_DOCUMENT).toBe(5)
    expect(attachmentRoom(0, 3)).toEqual({ accept: 3, overflow: 0 })
    expect(attachmentRoom(3, 3)).toEqual({ accept: 2, overflow: 1 })
    expect(attachmentRoom(5, 1)).toEqual({ accept: 0, overflow: 1 })
    expect(attachmentRoom(0, 8)).toEqual({ accept: 5, overflow: 3 })
    expect(attachmentRoom(4, 0)).toEqual({ accept: 0, overflow: 0 })
  })

  it('con otro tope y con números raros', () => {
    expect(attachmentRoom(0, 3, 1)).toEqual({ accept: 1, overflow: 2 })
    expect(attachmentRoom(9, 2)).toEqual({ accept: 0, overflow: 2 })
    expect(attachmentRoom(-1, -4)).toEqual({ accept: 0, overflow: 0 })
  })
})

describe('la ruta en el bucket', () => {
  it('<bar>/<comprobante>/<uuid>.<ext>, siempre en minúsculas', () => {
    expect(ATTACHMENT_BUCKET).toBe('acc-comprobantes')
    expect(buildAttachmentPath(TENANT, DOC, FILE, 'image/jpeg')).toBe(
      `${TENANT}/${DOC}/${FILE}.jpg`,
    )
    expect(
      buildAttachmentPath(TENANT, DOC.toUpperCase(), FILE.toUpperCase(), 'application/pdf'),
    ).toBe(`${TENANT}/${DOC}/${FILE}.pdf`)
  })

  it('no arma una ruta con un identificador que no es un uuid', () => {
    expect(() => buildAttachmentPath(TENANT, '../otro', FILE, 'image/png')).toThrow()
    expect(() => buildAttachmentPath('', DOC, FILE, 'image/png')).toThrow()
    expect(() => buildAttachmentPath(TENANT, DOC, 'foto', 'image/png')).toThrow()
  })

  it('lee las partes de una ruta bien formada', () => {
    expect(parseAttachmentPath(`${TENANT}/${DOC}/${FILE}.webp`)).toEqual({
      tenantId: TENANT,
      documentId: DOC,
      fileId: FILE,
      extension: 'webp',
    })
  })

  it('rechaza carpetas de más, `..`, mayúsculas, otra extensión y lo que no es texto', () => {
    for (const path of [
      `${TENANT}/${DOC}/${FILE}`,
      `${TENANT}/${DOC}/${FILE}.exe`,
      `${TENANT}/${DOC}/${FILE}.jpg.exe`,
      `${TENANT}/${DOC}/extra/${FILE}.jpg`,
      `${TENANT}/../${DOC}/${FILE}.jpg`,
      `${TENANT}/${DOC}/${FILE.toUpperCase()}.jpg`,
      `${TENANT}/${DOC}/${FILE}.JPG`,
      `/${TENANT}/${DOC}/${FILE}.jpg`,
      `${DOC}/${FILE}.jpg`,
      '',
      null,
      42,
    ]) {
      expect(parseAttachmentPath(path), String(path)).toBeNull()
    }
  })

  it('la ruta tiene que ser de ESE comprobante de ESE bar y con la extensión del tipo', () => {
    const path = buildAttachmentPath(TENANT, DOC, FILE, 'image/jpeg')
    const expected = { tenantId: TENANT, documentId: DOC, mimeType: 'image/jpeg' }
    expect(isAttachmentPathFor(path, expected)).toBe(true)
    expect(isAttachmentPathFor(path, { ...expected, documentId: DOC.toUpperCase() })).toBe(true)
    expect(isAttachmentPathFor(path, { ...expected, tenantId: OTHER_TENANT })).toBe(false)
    expect(isAttachmentPathFor(path, { ...expected, documentId: OTHER_DOC })).toBe(false)
    expect(isAttachmentPathFor(path, { ...expected, mimeType: 'application/pdf' })).toBe(false)
    expect(isAttachmentPathFor(path, { ...expected, mimeType: 'image/gif' })).toBe(false)
    expect(isAttachmentPathFor(`${TENANT}/${DOC}/x.jpg`, expected)).toBe(false)
  })
})

describe('el nombre que se guarda', () => {
  it('lleva la extensión de lo que de verdad se subió', () => {
    expect(attachmentFileName('IMG_0001.HEIC', 'image/webp')).toBe('IMG_0001.webp')
    expect(attachmentFileName('Factura Barracuda.pdf', 'application/pdf')).toBe(
      'Factura Barracuda.pdf',
    )
    expect(attachmentFileName('foto', 'image/jpeg')).toBe('foto.jpg')
    expect(attachmentFileName('remito.v2.final.png', 'image/avif')).toBe('remito.v2.final.avif')
  })

  it('sin carpetas, sin caracteres de control y con un nombre por defecto', () => {
    expect(attachmentFileName('C:\\Users\\caja\\Desktop\\tique.jpg', 'image/jpeg')).toBe(
      'tique.jpg',
    )
    expect(attachmentFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf')
    expect(attachmentFileName('  fac\ttura\n  A.jpg ', 'image/jpeg')).toBe('factura A.jpg')
    expect(attachmentFileName('', 'application/pdf')).toBe('comprobante.pdf')
    expect(attachmentFileName('.jpg', 'image/jpeg')).toBe('comprobante.jpg')
  })

  it('nunca pasa del largo que guarda la base', () => {
    const name = attachmentFileName(`${'a'.repeat(400)}.jpeg`, 'image/webp')
    expect(name.length).toBe(ATTACHMENT_NAME_MAX)
    expect(name.endsWith('.webp')).toBe(true)
  })
})

describe('textos', () => {
  it('el peso, en KB o MB', () => {
    expect(formatAttachmentSize(340 * 1024)).toBe('340 KB')
    expect(formatAttachmentSize(1.25 * MB)).toBe('1,3 MB')
    expect(formatAttachmentSize(10 * MB)).toBe('10,0 MB')
    expect(formatAttachmentSize(200)).toBe('1 KB')
    expect(formatAttachmentSize(0)).toBe('0 KB')
  })

  it('el aviso de un formulario que guardó y no pudo subir todo', () => {
    expect(pendingAttachmentsMessage(0, 3)).toBeNull()
    expect(pendingAttachmentsMessage(1, 1)).toContain('no pudimos subir el archivo')
    expect(pendingAttachmentsMessage(3, 3)).toContain('no pudimos subir los archivos')
    expect(pendingAttachmentsMessage(1, 3)).toContain('un archivo no se pudo subir')
    expect(pendingAttachmentsMessage(2, 3)).toContain('2 archivos no se pudieron subir')
    for (const [failed, total] of [
      [1, 1],
      [3, 3],
      [1, 3],
      [2, 3],
    ] as const) {
      expect(pendingAttachmentsMessage(failed, total)).toMatch(/^El comprobante se guardó/)
    }
  })
})

describe('dónde va «Comprobante adjunto» (attachmentsBlock)', () => {
  it('quien carga lo ve siempre en un comprobante vigente, y puede sumar', () => {
    for (const kind of ['purchase', 'expense', 'payment', 'sales_close', 'manual'] as const) {
      expect(attachmentsBlock({ kind, status: 'posted' }, true, 0), kind).toEqual({
        show: true,
        canEdit: true,
      })
    }
  })

  it('la contadora lo ve solo si hay archivos, y nunca suma ni quita', () => {
    expect(attachmentsBlock({ kind: 'purchase', status: 'posted' }, false, 0)).toEqual({
      show: false,
      canEdit: false,
    })
    expect(attachmentsBlock({ kind: 'purchase', status: 'posted' }, false, 2)).toEqual({
      show: true,
      canEdit: false,
    })
  })

  it('en un anulado se ve lo que tenía, sin cambios', () => {
    expect(attachmentsBlock({ kind: 'purchase', status: 'voided' }, true, 0)).toEqual({
      show: false,
      canEdit: false,
    })
    expect(attachmentsBlock({ kind: 'purchase', status: 'voided' }, true, 1)).toEqual({
      show: true,
      canEdit: false,
    })
  })

  it('los que arma el sistema no lo ofrecen', () => {
    for (const kind of ['reversal', 'fy_result', 'fy_closing', 'fy_opening'] as const) {
      expect(attachmentsBlock({ kind, status: 'posted' }, true, 0), kind).toEqual({
        show: false,
        canEdit: false,
      })
      expect(attachmentsBlock({ kind, status: 'posted' }, true, null), kind).toEqual({
        show: false,
        canEdit: false,
      })
    }
  })

  it('si la lista no se pudo leer, el bloque va igual con su aviso', () => {
    expect(attachmentsBlock({ kind: 'expense', status: 'posted' }, false, null)).toEqual({
      show: true,
      canEdit: false,
    })
    expect(attachmentsBlock({ kind: 'expense', status: 'posted' }, true, null)).toEqual({
      show: true,
      canEdit: true,
    })
  })
})

// ─── Paridad con la migración ────────────────────────────────────────────────

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/20261013120000_acc_adjuntos.sql', import.meta.url),
)

describe('la migración dice lo mismo que el código', () => {
  it.skipIf(!existsSync(MIGRATION))('bucket, tipos, extensiones, peso y cantidad', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain(`'${ATTACHMENT_BUCKET}'`)
    const extensions = ATTACHMENT_MIME_TYPES.map(attachmentExtension).join('|')
    // La misma lista de extensiones en la tabla y en la política de subida.
    expect(sql.split(`\\.(${extensions})$`).length - 1).toBe(2)
    for (const mime of ATTACHMENT_MIME_TYPES) {
      // En el bucket, en el check de la tabla y en la RPC.
      expect(sql.split(`'${mime}'`).length - 1, mime).toBeGreaterThanOrEqual(3)
      expect(sql, mime).toContain(`when '${mime}' then '${attachmentExtension(mime)}'`)
    }
    expect(sql.split(String(MAX_ATTACHMENT_BYTES)).length - 1).toBeGreaterThanOrEqual(3)
    expect(sql).toContain(`v_count >= ${MAX_ATTACHMENTS_PER_DOCUMENT}`)
    expect(sql).toContain(
      `left(btrim(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g')), ${ATTACHMENT_NAME_MAX})`,
    )
  })

  it('el error del tope tiene su texto', () => {
    expect(isAccErrorKey('attachment_limit')).toBe(true)
  })
})
