/**
 * Las reglas de los archivos de una tarea de marketing: qué tipos entran, cuánto
 * pesan, dónde se guardan y cómo se muestran. Puro (sin `server-only` ni
 * Supabase): lo usan el selector del navegador, las server actions y los tests.
 * La base repite lo mismo (bucket `marketing-files`, migración
 * 20261115230118_marketing_tasks_board_v2).
 *
 * No se achican las imágenes: lo que se sube acá suele ser el arte final de un
 * diseño, y tiene que llegar tal cual.
 */

export const TASK_FILES_BUCKET = 'marketing-files'

/** El tope del bucket. Lo más pesado (un reel en crudo) va como link de Drive. */
export const MAX_TASK_FILE_BYTES = 50 * 1024 * 1024

/** Cuántos archivos se suben de una vez (arrastrando o eligiendo). */
export const MAX_FILES_PER_BATCH = 10

/** Los minutos que dura el link firmado para ver o bajar un archivo. */
export const SIGNED_URL_SECONDS = 60 * 60

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
} as const

export type TaskFileMime = keyof typeof EXTENSION_BY_MIME

export const TASK_FILE_MIMES = Object.keys(EXTENSION_BY_MIME) as TaskFileMime[]

/** Para el `accept` del `<input type="file">`. */
export const TASK_FILE_ACCEPT = [
  'image/*',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
  '.zip',
  '.docx',
  '.xlsx',
  '.pptx',
  '.heic',
].join(',')

const MIME_BY_EXTENSION: Readonly<Record<string, TaskFileMime>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function isTaskFileMime(value: unknown): value is TaskFileMime {
  return typeof value === 'string' && Object.hasOwn(EXTENSION_BY_MIME, value)
}

export function extensionFor(mime: TaskFileMime): string {
  return EXTENSION_BY_MIME[mime]
}

export const TASK_FILE_MESSAGES = {
  empty: 'El archivo está vacío.',
  type: 'Ese tipo de archivo no entra. Subí fotos, videos, PDF, Office o zip; lo demás, como link.',
  tooBig: 'Pesa más de 50 MB. Subilo a Drive y pegá el link.',
  tooMany: `Hasta ${MAX_FILES_PER_BATCH} archivos por vez.`,
  upload: 'No se pudo subir. Probá de nuevo.',
  offline: 'Se cortó la conexión. Probá de nuevo.',
} as const

export type TaskFileCheck =
  | { ok: true; mimeType: TaskFileMime; extension: string }
  | { ok: false; message: string }

/**
 * Qué tipo es de verdad: el que dice el navegador o, si no dice nada (pasa con
 * HEIC y con algunos zip en Windows), el de la extensión.
 */
export function resolveTaskFileMime(file: { name: string; type: string }): TaskFileMime | null {
  const type = file.type.trim().toLowerCase()
  if (isTaskFileMime(type)) return type
  if (type === 'application/x-zip-compressed') return 'application/zip'
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  // `hasOwn`: un archivo «nota.constructor» no tiene que encontrar la función `Object`.
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? (MIME_BY_EXTENSION[extension] ?? null) : null
}

export function checkTaskFile(file: { name: string; type: string; size: number }): TaskFileCheck {
  if (file.size <= 0) return { ok: false, message: TASK_FILE_MESSAGES.empty }
  const mimeType = resolveTaskFileMime(file)
  if (!mimeType) return { ok: false, message: TASK_FILE_MESSAGES.type }
  if (file.size > MAX_TASK_FILE_BYTES) return { ok: false, message: TASK_FILE_MESSAGES.tooBig }
  return { ok: true, mimeType, extension: extensionFor(mimeType) }
}

/** `<bar>/<tarea>/<uuid>.<ext>`: lo único que aceptan el bucket y la tabla. */
export function taskFilePath(
  tenantId: string,
  taskId: string,
  fileId: string,
  extension: string,
): string {
  return `${tenantId}/${taskId}/${fileId}.${extension}`
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** ¿Es una ruta de ESA tarea de ESE bar, con la extensión del tipo dicho? */
export function isTaskFilePath(
  path: string,
  tenantId: string,
  taskId: string,
  mime: TaskFileMime,
): boolean {
  const prefix = `${tenantId}/${taskId}/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return new RegExp(`^${UUID_RE}\\.${extensionFor(mime)}$`).test(rest)
}

export type TaskFileKind = 'image' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'zip' | 'link'

export function taskFileKind(kind: 'file' | 'link', mime: string | null): TaskFileKind {
  if (kind === 'link') return 'link'
  if (!mime) return 'doc'
  if (mime === 'image/heic' || mime === 'image/heif') return 'doc'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('spreadsheetml')) return 'sheet'
  if (mime.includes('presentationml')) return 'slides'
  if (mime === 'application/zip') return 'zip'
  return 'doc'
}

/** `1.234.567` bytes → «1,2 MB». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  // 1.048.575 bytes redondea a «1024 KB»: desde ahí ya es «1 MB».
  if (Math.round(kb) < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb.toLocaleString('es-AR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}

/** El nombre que se muestra de un link: el dominio, sin «www.». */
export function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host || 'Link'
  } catch {
    return 'Link'
  }
}

/** Nombre prolijo para guardar (sin rutas ni caracteres de control, hasta 160). */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  // Sin caracteres de control (un nombre con un salto de línea rompería la lista).
  const clean = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
  return (clean || 'archivo').slice(0, 160)
}
