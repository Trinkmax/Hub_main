/**
 * Foto del comprobante: las reglas de los archivos adjuntos de un comprobante
 * de Administración (pedido de los socios del 12/10/2026, punto 1.5).
 *
 * Puro: sin `server-only` y sin Supabase. Lo usan el selector de archivos (en
 * el navegador), las server actions y los tests, para que tipo, peso, cantidad
 * y ruta se decidan en un solo lugar. La base repite lo mismo (bucket
 * `acc-comprobantes` y `acc_attach_document_file`, migración 20261013120000).
 *
 * Dos momentos, dos chequeos:
 * - `checkAttachmentCandidate`: lo que la persona elige. Una foto puede pesar
 *   más que el tope porque se achica antes de subir.
 * - `checkAttachmentUpload`: lo que de verdad se sube (ya achicado). Es el que
 *   repite el servidor.
 */

/** Bucket privado de Storage. */
export const ATTACHMENT_BUCKET = 'acc-comprobantes'

export const MAX_ATTACHMENTS_PER_DOCUMENT = 5

/** Tope de cada archivo ya listo para subir (el mismo del bucket). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Tope del original de una foto: se achica en el navegador antes de subir. */
export const MAX_ORIGINAL_IMAGE_BYTES = 30 * 1024 * 1024

/** Largo máximo del nombre que se guarda para mostrar. */
export const ATTACHMENT_NAME_MAX = 120

/**
 * El `accept` del `<input type="file">`. Sin `capture`: en el celular deja
 * elegir entre sacar la foto, la galería o un archivo.
 */
export const ATTACHMENT_ACCEPT = 'image/*,application/pdf'

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
} as const

/** Lo que acepta el bucket. */
export type AttachmentMimeType = keyof typeof EXTENSION_BY_MIME

export const ATTACHMENT_MIME_TYPES = Object.keys(EXTENSION_BY_MIME) as AttachmentMimeType[]

/** Extensión del nombre → tipo, para cuando el navegador no informa el tipo (pasa con HEIC). */
const MIME_BY_EXTENSION: Readonly<Record<string, AttachmentMimeType>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

/** Cómo se muestra: con miniatura, como PDF o como archivo suelto (HEIC: el navegador no lo dibuja). */
export type AttachmentKind = 'image' | 'pdf' | 'file'

export type AttachmentFileInfo = { name: string; type: string; size: number }

export type AttachmentCandidateCheck =
  | { ok: true; kind: 'image' | 'pdf' }
  | { ok: false; message: string }

export type AttachmentUploadCheck =
  | { ok: true; mimeType: AttachmentMimeType }
  | { ok: false; message: string }

export const ATTACHMENT_MESSAGES = {
  empty: 'El archivo está vacío.',
  type: 'Solo se pueden adjuntar fotos o PDF.',
  pdfTooBig: 'El PDF pesa más de 10 MB. Achicalo o subí una foto.',
  imageTooBig: 'La foto pesa demasiado. Probá con otra o sacala de nuevo.',
  tooBig: 'El archivo pesa más de 10 MB.',
  unreadableImage: 'No pudimos leer esa imagen. Probá con una foto en JPG o PNG, o con un PDF.',
  limit: `Un comprobante lleva hasta ${MAX_ATTACHMENTS_PER_DOCUMENT} archivos.`,
  upload: 'No pudimos subir el archivo. Probá de nuevo.',
  offline: 'Sin conexión: no se subió. Probá de nuevo.',
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isAttachmentMimeType(value: unknown): value is AttachmentMimeType {
  return typeof value === 'string' && Object.hasOwn(EXTENSION_BY_MIME, value)
}

export function attachmentExtension(mimeType: AttachmentMimeType): string {
  return EXTENSION_BY_MIME[mimeType]
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * El tipo del archivo entre los que acepta el bucket, o `null`. Primero el que
 * informa el navegador; si viene vacío o genérico, la extensión del nombre.
 */
export function guessAttachmentMime(
  file: Pick<AttachmentFileInfo, 'name' | 'type'>,
): AttachmentMimeType | null {
  const type = file.type.trim().toLowerCase()
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg'
  if (isAttachmentMimeType(type)) return type
  if (type !== '' && type !== 'application/octet-stream') return null
  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? null
}

/** Con miniatura solo lo que cualquier navegador dibuja; HEIC/HEIF va como archivo. */
export function attachmentKind(mimeType: string): AttachmentKind {
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/avif'
  ) {
    return 'image'
  }
  return 'file'
}

/**
 * ¿Se puede elegir este archivo? Fotos (cualquier imagen que el navegador sepa
 * leer, menos SVG, que es contenido activo) y PDF. El PDF va tal cual, así que
 * su tope es el del bucket; la foto se achica después.
 */
export function checkAttachmentCandidate(file: AttachmentFileInfo): AttachmentCandidateCheck {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: ATTACHMENT_MESSAGES.empty }
  }
  const type = file.type.trim().toLowerCase()
  const guessed = guessAttachmentMime(file)
  if (guessed === 'application/pdf') {
    return file.size > MAX_ATTACHMENT_BYTES
      ? { ok: false, message: ATTACHMENT_MESSAGES.pdfTooBig }
      : { ok: true, kind: 'pdf' }
  }
  const isImage = guessed !== null || (type.startsWith('image/') && type !== 'image/svg+xml')
  if (!isImage) return { ok: false, message: ATTACHMENT_MESSAGES.type }
  return file.size > MAX_ORIGINAL_IMAGE_BYTES
    ? { ok: false, message: ATTACHMENT_MESSAGES.imageTooBig }
    : { ok: true, kind: 'image' }
}

/** Lo que de verdad se sube: tipo de la lista del bucket y hasta 10 MB. */
export function checkAttachmentUpload(file: {
  mimeType: string
  sizeBytes: number
}): AttachmentUploadCheck {
  if (!isAttachmentMimeType(file.mimeType)) return { ok: false, message: ATTACHMENT_MESSAGES.type }
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
    return { ok: false, message: ATTACHMENT_MESSAGES.empty }
  }
  if (file.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: ATTACHMENT_MESSAGES.tooBig }
  }
  return { ok: true, mimeType: file.mimeType }
}

/**
 * Cuántos de los archivos elegidos entran (`accept`) y cuántos quedan afuera
 * (`overflow`) con los que el comprobante ya tiene.
 */
export function attachmentRoom(
  existing: number,
  incoming: number,
  max: number = MAX_ATTACHMENTS_PER_DOCUMENT,
): { accept: number; overflow: number } {
  const free = Math.max(0, Math.trunc(max) - Math.max(0, Math.trunc(existing)))
  const wanted = Math.max(0, Math.trunc(incoming))
  const accept = Math.min(free, wanted)
  return { accept, overflow: wanted - accept }
}

/** `<tenant_id>/<document_id>/<uuid>.<ext>`: una carpeta por bar y, adentro, una por comprobante. */
export function buildAttachmentPath(
  tenantId: string,
  documentId: string,
  fileId: string,
  mimeType: AttachmentMimeType,
): string {
  const parts = [tenantId, documentId, fileId].map((part) => part.toLowerCase())
  if (!parts.every((part) => UUID_RE.test(part))) {
    throw new Error('buildAttachmentPath: identificador inválido')
  }
  return `${parts.join('/')}.${attachmentExtension(mimeType)}`
}

export type AttachmentPathParts = {
  tenantId: string
  documentId: string
  fileId: string
  extension: string
}

/** Las partes de una ruta bien formada, o `null` (mayúsculas, `..`, carpetas de más, otra extensión). */
export function parseAttachmentPath(path: unknown): AttachmentPathParts | null {
  if (typeof path !== 'string' || path.length > 160) return null
  const segments = path.split('/')
  if (segments.length !== 3) return null
  const [tenantId = '', documentId = '', file = ''] = segments
  const dot = file.indexOf('.')
  if (dot <= 0) return null
  const fileId = file.slice(0, dot)
  const extension = file.slice(dot + 1)
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(documentId) || !UUID_RE.test(fileId)) return null
  if (!Object.values(EXTENSION_BY_MIME).some((ext) => ext === extension)) return null
  return { tenantId, documentId, fileId, extension }
}

/** ¿La ruta es de ESE comprobante de ESE bar y su extensión es la del tipo declarado? */
export function isAttachmentPathFor(
  path: unknown,
  expected: { tenantId: string; documentId: string; mimeType: string },
): boolean {
  const parts = parseAttachmentPath(path)
  if (!parts || !isAttachmentMimeType(expected.mimeType)) return false
  return (
    parts.tenantId === expected.tenantId.toLowerCase() &&
    parts.documentId === expected.documentId.toLowerCase() &&
    parts.extension === attachmentExtension(expected.mimeType)
  )
}

function isControlChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return code < 32 || code === 127
}

/**
 * El nombre que se guarda para mostrar: sin carpetas ni caracteres de control,
 * con la extensión de lo que de verdad se subió (una foto HEIC que se achicó a
 * WebP pasa de `IMG_1.HEIC` a `IMG_1.webp`) y hasta 120 caracteres.
 */
export function attachmentFileName(rawName: string, mimeType: AttachmentMimeType): string {
  const extension = attachmentExtension(mimeType)
  const last = rawName.split(/[\\/]/).pop() ?? ''
  const clean = Array.from(last)
    .filter((char) => !isControlChar(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const stem = clean.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
  const room = ATTACHMENT_NAME_MAX - extension.length - 1
  const base = Array.from(stem === '' ? 'comprobante' : stem)
    .slice(0, room)
    .join('')
    .trim()
  return `${base === '' ? 'comprobante' : base}.${extension}`
}

/** «340 KB», «1,2 MB». */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** «PDF», «Foto» o «Archivo», para decir qué es con palabras. */
export function attachmentKindLabel(kind: AttachmentKind): string {
  return kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Foto' : 'Archivo'
}

/**
 * Para un formulario que guardó el comprobante y después subió los archivos:
 * qué decir si alguno no se pudo subir (el comprobante ya está guardado).
 */
export function pendingAttachmentsMessage(failed: number, total: number): string | null {
  if (failed <= 0) return null
  if (total <= 1) {
    return 'El comprobante se guardó, pero no pudimos subir el archivo. Sumalo desde el comprobante.'
  }
  if (failed >= total) {
    return 'El comprobante se guardó, pero no pudimos subir los archivos. Sumalos desde el comprobante.'
  }
  return failed === 1
    ? 'El comprobante se guardó, pero un archivo no se pudo subir. Sumalo desde el comprobante.'
    : `El comprobante se guardó, pero ${failed} archivos no se pudieron subir. Sumalos desde el comprobante.`
}
