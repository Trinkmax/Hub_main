/**
 * Leer el QR de una foto o de un PDF, en el navegador.
 *
 * El QR de una factura es chico en una foto: se prueba la imagen entera y varios recortes, cada uno
 * agrandado o achicado a un tamaño que el lector se banque (`qrScanPlan`). Primero con
 * `BarcodeDetector` si el navegador lo trae; si no, o si no encontró nada, con `jsqr`.
 *
 * `jsqr` y `pdfjs-dist` se cargan con `import()` recién cuando hacen falta: no suman peso a la
 * pantalla. Si nada se pudo leer vuelve `null`, sin error: la foto queda adjunta y se tipea.
 */

import { type ArcaQrData, parseArcaQr } from '@/lib/accounting/arca-qr'

/** Un recorte de la imagen, en fracciones de su ancho y su alto, y a qué lado mayor se lee. */
export type QrScanStep = { x: number; y: number; w: number; h: number; side: number }

/** Por encima de esto, un intento más no vale la espera. */
const TIME_BUDGET_MS = 6_000
const WHOLE_SIDES = [1600, 1000] as const
/** Los recortes se leen agrandados: en una foto de 1600 px, a `jsqr` no le alcanzan 2 px por módulo. */
const CROP_SIDE = 1600

/**
 * El orden en que se mira una imagen. Entera primero; después los cuartos, con el de abajo a la
 * izquierda adelante (ahí lo pone casi todo el mundo); después una grilla de 3 × 3. Los recortes se
 * pisan un poco, para que un QR que cae justo en un borde entre entero en alguno.
 */
export function qrScanPlan(): QrScanStep[] {
  const whole = WHOLE_SIDES.map((side) => ({ x: 0, y: 0, w: 1, h: 1, side }))
  const quarter = 0.6
  const far = 1 - quarter
  const quarters: QrScanStep[] = [
    { x: 0, y: far, w: quarter, h: quarter, side: CROP_SIDE },
    { x: far, y: far, w: quarter, h: quarter, side: CROP_SIDE },
    { x: 0, y: 0, w: quarter, h: quarter, side: CROP_SIDE },
    { x: far, y: 0, w: quarter, h: quarter, side: CROP_SIDE },
  ]
  const tile = 0.4
  const tiles: QrScanStep[] = []
  // De abajo hacia arriba, por la misma razón.
  for (const row of [2, 1, 0]) {
    for (const column of [0, 1, 2]) {
      tiles.push({ x: column * 0.3, y: row * 0.3, w: tile, h: tile, side: CROP_SIDE })
    }
  }
  return [...whole, ...quarters, ...tiles]
}

/** El tamaño al que se dibuja un recorte: el lado mayor en `side`, sin deformar. */
export function scanCanvasSize(
  sourceWidth: number,
  sourceHeight: number,
  side: number,
): { width: number; height: number } {
  const ratio = side / Math.max(sourceWidth, sourceHeight, 1)
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  }
}

// ─── Los lectores ────────────────────────────────────────────────────────────

/** Lo que usamos de `BarcodeDetector`, que todavía no está en los tipos del DOM. */
type DetectedCode = { rawValue?: string }
type QrDetector = { detect: (source: CanvasImageSource) => Promise<DetectedCode[]> }
type BarcodeDetectorStatic = {
  new (options: { formats: string[] }): QrDetector
  getSupportedFormats?: () => Promise<string[]>
}

async function nativeDetector(): Promise<QrDetector | null> {
  const ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorStatic })
    .BarcodeDetector
  if (!ctor) return null
  try {
    const formats = await ctor.getSupportedFormats?.()
    if (formats && !formats.includes('qr_code')) return null
    return new ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

type JsQr = typeof import('jsqr').default

let jsQrModule: Promise<JsQr | null> | null = null

function loadJsQr(): Promise<JsQr | null> {
  jsQrModule ??= import('jsqr')
    .then((module) => {
      // Es un módulo CommonJS: según el empaquetador, la función llega en uno u otro lugar.
      const first: unknown = module.default
      if (typeof first === 'function') return first as JsQr
      const nested = (first as { default?: unknown } | null)?.default
      return typeof nested === 'function' ? (nested as JsQr) : null
    })
    .catch(() => {
      jsQrModule = null
      return null
    })
  return jsQrModule
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function drawStep(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  step: QrScanStep,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const sw = sourceWidth * step.w
  const sh = sourceHeight * step.h
  const { width, height } = scanCanvasSize(sw, sh, step.side)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Fondo blanco: un PNG o un PDF con transparencia se leería negro sobre negro.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, sourceWidth * step.x, sourceHeight * step.y, sw, sh, 0, 0, width, height)
  return { canvas, ctx }
}

/** Busca un QR de ARCA en una imagen ya cargada. Se detiene en el primero que sirve. */
export async function scanForArcaQr(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: { signal?: AbortSignal; budgetMs?: number } = {},
): Promise<ArcaQrData | null> {
  const deadline = Date.now() + (options.budgetMs ?? TIME_BUDGET_MS)
  const detector = await nativeDetector()
  const jsQr = await loadJsQr()
  if (!detector && !jsQr) return null

  for (const step of qrScanPlan()) {
    if (options.signal?.aborted || Date.now() > deadline) return null
    // La pantalla no se traba mientras se prueba: el escaneo de la foto se sigue moviendo.
    await nextTask()
    const drawn = drawStep(source, sourceWidth, sourceHeight, step)
    if (!drawn) continue
    if (detector) {
      try {
        for (const code of await detector.detect(drawn.canvas)) {
          const read = parseArcaQr(code.rawValue)
          if (read) return read
        }
      } catch {
        // Hay navegadores que lo anuncian y después fallan: queda `jsqr`.
      }
    }
    if (jsQr) {
      const { width, height } = drawn.canvas
      const image = drawn.ctx.getImageData(0, 0, width, height)
      const code = jsQr(image.data, width, height, { inversionAttempts: 'dontInvert' })
      const read = code ? parseArcaQr(code.data) : null
      if (read) return read
    }
  }
  return null
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** A qué lado mayor se dibuja la página de un PDF. Un QR impreso queda nítido de sobra. */
const PDF_SIDE = 2000

/**
 * La primera página de un PDF, dibujada en un canvas. Corre en el hilo principal: cargar el worker
 * de pdf.js deja `globalThis.pdfjsWorker` y pdf.js lo usa solo, sin armar un `Worker` (no depende de
 * cómo el empaquetador sirva ese archivo). Una factura es una página: se termina enseguida.
 */
async function renderPdfFirstPage(file: File): Promise<HTMLCanvasElement | null> {
  const [pdfjs] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs'),
  ])
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorkerRendering: true,
    // Correr en el hilo principal es a propósito: que no lo avise en la consola.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({
      scale: Math.min(4, PDF_SIDE / Math.max(base.width, base.height)),
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    return canvas
  } finally {
    await task.destroy().catch(() => {})
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

// ─── Lo que usa el panel ─────────────────────────────────────────────────────

export type ComprobanteReading = {
  /** Lo que dice su QR de ARCA. `null`: no tiene, o no se pudo leer. */
  qr: ArcaQrData | null
  /** La primera página de un PDF, para mostrarla. Quien la recibe libera la URL. */
  previewUrl: string | null
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/**
 * Lee un comprobante. Nunca tira: una foto que el navegador no sabe abrir (HEIC fuera de Safari) o
 * un PDF con contraseña vuelven sin QR.
 */
export async function readComprobante(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<ComprobanteReading> {
  try {
    if (isPdf(file)) {
      const canvas = await renderPdfFirstPage(file)
      if (!canvas) return { qr: null, previewUrl: null }
      const qr = await scanForArcaQr(canvas, canvas.width, canvas.height, options)
      const blob = await canvasToBlob(canvas)
      return { qr, previewUrl: blob ? URL.createObjectURL(blob) : null }
    }
    const bitmap = await createImageBitmap(file)
    try {
      const qr = await scanForArcaQr(bitmap, bitmap.width, bitmap.height, options)
      return { qr, previewUrl: null }
    } finally {
      bitmap.close()
    }
  } catch {
    return { qr: null, previewUrl: null }
  }
}
