import { paymentTypeLabel } from './copy'
import { formatLongDate } from './dates'
import { formatShortCode } from './door'
import { formatPesos } from './pricing'
import { guillocheFor, QR_EYE, STAR_PATH, seededRandom, seedFromId, stampRing } from './ticket-art'
import type { PublicOrder } from './types'

/**
 * La imagen que se guarda en el celular: la entrada con su QR y el comprobante,
 * dibujados a mano en un canvas para que salga igual en todos los navegadores
 * (pasar el DOM a imagen falla en Safari justo con máscaras y SVG). Usa los mismos
 * trazos que la pantalla: el QR, la roseta y la ✦.
 *
 * Solo del navegador.
 */
export type TicketImageInput = {
  order: PublicOrder
  tenantName: string
  address: string | null
  paidCents: number
  balanceCents: number
}

const W = 1080
const MARGIN = 54
const TICKET_W = W - MARGIN * 2
const NIGHT = '#090d0b'
const PAPER = '#f6efdc'
const INK = '#1a251f'
const INK_2 = '#4b5850'
const RUST = '#a3442e'
const THERMAL = '#f6f6f1'
const THERMAL_INK = '#27292b'
const MONO = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace'

type Fonts = { serif: string; sans: string }

function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value ? `${value}, ${fallback}` : fallback
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.arcTo(x + w, y, x + w, y + h, tr)
  ctx.arcTo(x + w, y + h, x, y + h, br)
  ctx.arcTo(x, y + h, x, y, bl)
  ctx.arcTo(x, y, x + w, y, tl)
  ctx.closePath()
}

/** Espaciado de letras a mano: `ctx.letterSpacing` todavía no anda en todos los Safari. */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  const chars = [...text]
  const width =
    chars.reduce((sum, c) => sum + ctx.measureText(c).width, 0) + tracking * (chars.length - 1)
  let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
  const previous = ctx.textAlign
  ctx.textAlign = 'left'
  for (const c of chars) {
    ctx.fillText(c, cursor, y)
    cursor += ctx.measureText(c).width + tracking
  }
  ctx.textAlign = previous
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

/** Corta con «…» lo que no entra en el renglón. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  // Igual que `object-position: 50% 20%` en pantalla: se ven las caras, no los pies.
  ctx.drawImage(img, (w - dw) / 2, (h - dh) * 0.2, dw, dh)
}

/** La tinta del QR: la película oscurecida, igual que `color-mix` en pantalla. */
function darken(hex: string, keep: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return INK
  const base = [10, 15, 12]
  const mix = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) =>
    Math.round(c * keep + (base[i] as number) * (1 - keep)),
  )
  return `rgb(${mix.join(' ')})`
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(r, r)
  ctx.fill(new Path2D(STAR_PATH))
  ctx.restore()
}

function drawQr(
  ctx: CanvasRenderingContext2D,
  qr: NonNullable<PublicOrder['qr']>,
  x: number,
  y: number,
  size: number,
  ink: string,
) {
  const unit = size / qr.size
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(unit, unit)
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.86
  ctx.stroke(new Path2D(qr.path))
  const half = QR_EYE / 2
  const eyes = [
    [half, half],
    [qr.size - half, half],
    [half, qr.size - half],
  ] as const
  ctx.lineWidth = 1
  for (const [ex, ey] of eyes) {
    ctx.beginPath()
    ctx.arc(ex, ey, 3, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ex, ey, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  drawStar(ctx, qr.size / 2, qr.size / 2, qr.hole * 0.46)
  ctx.restore()
}

/** El sello de goma: en un canvas aparte, para gastarle la tinta sin tocar el papel. */
function drawStamp(input: TicketImageInput, size: number): HTMLCanvasElement {
  const { order, tenantName } = input
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  const u = size / 120
  ctx.scale(u, u)
  ctx.strokeStyle = RUST
  ctx.fillStyle = RUST
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.arc(60, 60, 57, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(60, 60, 38.5, 0, Math.PI * 2)
  ctx.stroke()

  // El anillo de texto, letra por letra.
  const ring = stampRing(tenantName)
  ctx.font = `700 9.5px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chars = [...ring]
  chars.forEach((char, i) => {
    const angle = (i / chars.length) * Math.PI * 2 - Math.PI / 2
    ctx.save()
    ctx.translate(60 + 47 * Math.cos(angle), 60 + 47 * Math.sin(angle))
    ctx.rotate(angle + Math.PI / 2)
    ctx.fillText(char, 0, 0)
    ctx.restore()
  })

  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 17px ${MONO}`
  if (order.option === 'deposit') {
    tracked(ctx, 'SEÑA', 60, 53, 1.2, 'center')
    tracked(ctx, 'PAGA', 60, 71, 1.2, 'center')
  } else {
    ctx.font = `800 15px ${MONO}`
    tracked(ctx, 'PAGADA', 60, 66, 0.6, 'center')
  }
  if (order.paidAtLabel) {
    ctx.font = `700 7px ${MONO}`
    tracked(ctx, order.paidAtLabel.slice(0, 10), 60, 84, 0.6, 'center')
  }

  // La tinta gastada: picaduras al azar, siempre las mismas para el mismo pedido.
  const rnd = seededRandom(seedFromId(`${order.id}:sello`))
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 520; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.75
    ctx.beginPath()
    ctx.arc(rnd() * 120, rnd() * 120, 0.12 + rnd() * 0.55, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  fonts: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  valueX: number,
  strong = false,
) {
  ctx.fillStyle = INK_2
  ctx.font = `400 22px ${MONO}`
  tracked(ctx, label.toUpperCase(), x, y, 3)
  ctx.fillStyle = INK
  ctx.font = `${strong ? 700 : 500} 34px ${fonts.sans}`
  ctx.fillText(value, valueX, y + 1)
}

function capitalize(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}

export async function renderTicketImage(input: TicketImageInput): Promise<Blob> {
  const { order, tenantName, address, paidCents, balanceCents } = input
  const qr = order.qr
  if (!qr) throw new Error('la entrada no tiene QR')

  const fonts: Fonts = {
    serif: cssFont('--font-fraunces', 'Georgia, serif'),
    sans: cssFont('--font-inter', 'system-ui, sans-serif'),
  }
  await Promise.all([
    document.fonts.load(`600 90px ${fonts.serif}`),
    document.fonts.load(`500 34px ${fonts.sans}`),
    document.fonts.load(`700 34px ${fonts.sans}`),
  ]).catch(() => undefined)
  const poster = order.posterUrl ? await loadImage(order.posterUrl) : null
  const deposit = order.option === 'deposit'

  // ── Medidas ──
  const POSTER_H = 440
  const BODY_H = 512
  const STUB_H = 900
  const TICKET_H = POSTER_H + BODY_H + STUB_H

  // El comprobante se mide antes de dibujar: las condiciones pueden ser largas.
  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  measure.font = `400 24px ${MONO}`
  const RECEIPT_W = TICKET_W - 80
  const RECEIPT_TEXT_W = RECEIPT_W - 96
  const termsLines = order.terms ? wrap(measure, order.terms, RECEIPT_TEXT_W) : []
  const LINE = 44
  const RULE = 26
  // Las mismas alturas con las que se dibuja abajo: encabezado, renglones, reglas y cierre.
  const receiptLines = 7 + (order.mpPaymentId ? 1 : 0) + (order.paidAtLabel ? 1 : 0)
  const receiptRules = 4 + (termsLines.length ? 1 : 0)
  const RECEIPT_H =
    178 +
    receiptLines * LINE +
    receiptRules * RULE +
    (termsLines.length ? termsLines.length * 34 + 10 : 0) +
    72

  const FOOTER_H = 180
  const H = MARGIN + TICKET_H + RECEIPT_H - 40 + FOOTER_H

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.textBaseline = 'alphabetic'

  // ── La sala ──
  ctx.fillStyle = NIGHT
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 700, 40, W / 2, 700, 1000)
  glow.addColorStop(0, `${order.accent}66`)
  glow.addColorStop(1, `${order.accent}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const top = MARGIN
  const seamY = top + POSTER_H + BODY_H

  // ── El comprobante: va atrás de la entrada ──
  const receiptX = MARGIN + 40
  const receiptY = top + TICKET_H - 40
  ctx.save()
  ctx.fillStyle = THERMAL
  ctx.shadowColor = 'rgb(0 0 0 / 0.5)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 18
  const zig = 26
  ctx.beginPath()
  ctx.moveTo(receiptX, receiptY)
  ctx.lineTo(receiptX + RECEIPT_W, receiptY)
  ctx.lineTo(receiptX + RECEIPT_W, receiptY + RECEIPT_H - zig / 2)
  const teeth = Math.floor(RECEIPT_W / zig)
  const toothW = RECEIPT_W / teeth
  for (let i = teeth; i > 0; i--) {
    ctx.lineTo(receiptX + toothW * (i - 0.5), receiptY + RECEIPT_H)
    ctx.lineTo(receiptX + toothW * (i - 1), receiptY + RECEIPT_H - zig / 2)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  const rx = receiptX + 48
  const rRight = receiptX + RECEIPT_W - 48
  let ry = receiptY + 96
  const rule = () => {
    ctx.save()
    ctx.strokeStyle = 'rgb(39 41 43 / 0.34)'
    ctx.lineWidth = 3
    ctx.setLineDash([9, 7])
    ctx.beginPath()
    ctx.moveTo(rx, ry - 12)
    ctx.lineTo(rRight, ry - 12)
    ctx.stroke()
    ctx.restore()
    ry += RULE
  }
  const line = (label: string, value?: string, bold = false) => {
    ctx.fillStyle = THERMAL_INK
    ctx.font = `${bold ? 700 : 400} ${bold ? 32 : 26}px ${MONO}`
    ctx.textAlign = 'left'
    ctx.fillText(label, rx, ry)
    if (value) {
      ctx.textAlign = 'right'
      const room = rRight - rx - ctx.measureText(label).width - 24
      ctx.fillText(fitText(ctx, value, room), rRight, ry)
      ctx.textAlign = 'left'
    }
    ry += LINE
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = THERMAL_INK
  ctx.font = `700 28px ${MONO}`
  ctx.fillText(order.sample ? `${tenantName} · MUESTRA` : tenantName, receiptX + RECEIPT_W / 2, ry)
  ry += 38
  ctx.fillText(
    deposit ? 'COMPROBANTE DE SEÑA' : 'COMPROBANTE DE PAGO',
    receiptX + RECEIPT_W / 2,
    ry,
  )
  ctx.textAlign = 'left'
  ry += 44
  rule()
  line('Función', order.title)
  line('A nombre de', order.guestShortName)
  line('Entrada', formatShortCode(order.shortCode))
  rule()
  line(
    `${order.partySize} × ${deposit ? 'seña' : 'entrada'} ${formatPesos(order.unitPriceCents)}`,
    formatPesos(order.totalCents),
  )
  rule()
  line('PAGASTE', formatPesos(paidCents), true)
  if (balanceCents > 0) {
    line(
      order.balanceCashOnly ? 'Resta, en efectivo' : 'Resta, en el local',
      formatPesos(balanceCents),
    )
  } else {
    line('La entrada ya está paga.')
  }
  rule()
  line(`${paymentTypeLabel(order.mpPaymentType)} · Mercado Pago`)
  if (order.mpPaymentId) line(`Operación ${order.mpPaymentId}`)
  if (order.paidAtLabel) line(`${order.paidAtLabel} hs`)
  if (termsLines.length) {
    rule()
    ctx.fillStyle = THERMAL_INK
    ctx.font = `400 24px ${MONO}`
    for (const l of termsLines) {
      ctx.fillText(l, rx, ry)
      ry += 34
    }
    ry += 10
  }
  ctx.fillStyle = THERMAL_INK
  ctx.font = `400 22px ${MONO}`
  ctx.textAlign = 'center'
  ctx.fillText('Documento no válido como factura.', receiptX + RECEIPT_W / 2, ry + 6)
  ctx.textAlign = 'left'

  // ── La entrada ──
  ctx.save()
  ctx.shadowColor = 'rgb(0 0 0 / 0.6)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 30
  ctx.fillStyle = PAPER
  rounded(ctx, MARGIN, top, TICKET_W, TICKET_H, 64)
  ctx.fill()
  ctx.restore()

  // El afiche
  ctx.save()
  rounded(ctx, MARGIN, top, TICKET_W, POSTER_H, [64, 64, 0, 0])
  ctx.clip()
  ctx.translate(MARGIN, top)
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, TICKET_W, POSTER_H)
  if (poster) drawCover(ctx, poster, TICKET_W, POSTER_H)
  const shade = ctx.createLinearGradient(0, POSTER_H, 0, 0)
  shade.addColorStop(0.03, darken(order.accent, 0.75))
  shade.addColorStop(0.72, 'rgb(0 0 0 / 0.2)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, TICKET_W, POSTER_H)
  ctx.restore()

  // Título (se achica hasta entrar) y «Admite N»
  ctx.fillStyle = PAPER
  ctx.font = `400 22px ${MONO}`
  const admit = `ADMITE ${order.partySize}`
  const admitW = [...admit].reduce((s, c) => s + ctx.measureText(c).width + 3, 0)
  const admitX = MARGIN + TICKET_W - 52 - admitW - 28
  const admitY = top + POSTER_H - 88
  ctx.save()
  ctx.strokeStyle = 'rgb(246 239 220 / 0.45)'
  ctx.lineWidth = 2
  rounded(ctx, admitX, admitY, admitW + 28, 50, 12)
  ctx.stroke()
  ctx.restore()
  tracked(ctx, admit, admitX + 14, admitY + 33, 3)
  let titleSize = 96
  ctx.font = `600 ${titleSize}px ${fonts.serif}`
  const titleMax = admitX - MARGIN - 52 - 24
  while (ctx.measureText(order.title).width > titleMax && titleSize > 44) {
    titleSize -= 4
    ctx.font = `600 ${titleSize}px ${fonts.serif}`
  }
  ctx.fillText(order.title, MARGIN + 52, top + POSTER_H - 44)

  // El cuerpo
  let y = top + POSTER_H + 92
  const x = MARGIN + 60
  // La fecha termina antes del sello: una larga («Miércoles 30 de septiembre») se achica.
  const dateText = capitalize(formatLongDate(order.date))
  const STAMP = 240
  const stampX = MARGIN + TICKET_W - 150
  const dateMax = stampX - STAMP / 2 - 24 - x
  let dateSize = 58
  ctx.fillStyle = INK
  ctx.font = `600 ${dateSize}px ${fonts.serif}`
  while (ctx.measureText(dateText).width > dateMax && dateSize > 34) {
    dateSize -= 2
    ctx.font = `600 ${dateSize}px ${fonts.serif}`
  }
  ctx.fillText(dateText, x, y)
  y += 56
  ctx.fillStyle = INK_2
  ctx.font = `500 34px ${fonts.sans}`
  ctx.fillText(`${order.time} hs`, x, y)
  y += 84
  const valueX = x + 340
  drawRow(
    ctx,
    fonts,
    'Admite',
    `${order.partySize} ${order.partySize === 1 ? 'persona' : 'personas'}`,
    x,
    y,
    valueX,
  )
  y += 62
  drawRow(ctx, fonts, 'A nombre de', order.guestShortName, x, y, valueX)
  y += 62
  drawRow(
    ctx,
    fonts,
    'Pagaste',
    `${formatPesos(paidCents)} ${deposit ? '(seña)' : '(total)'}`,
    x,
    y,
    valueX,
  )
  y += 62
  drawRow(
    ctx,
    fonts,
    balanceCents > 0 && !order.balanceCashOnly ? 'El día del evento' : 'En el bar',
    balanceCents <= 0
      ? 'La entrada ya está paga'
      : `${formatPesos(balanceCents)}${order.balanceCashOnly ? ' en efectivo' : ', en el local'}`,
    x,
    y,
    valueX,
    balanceCents > 0,
  )

  // El sello
  const stamp = drawStamp(input, STAMP)
  ctx.save()
  ctx.translate(stampX, top + POSTER_H + 78)
  ctx.rotate((-13 * Math.PI) / 180)
  ctx.drawImage(stamp, -STAMP / 2, -STAMP / 2)
  ctx.restore()

  // La roseta del talón
  ctx.save()
  rounded(ctx, MARGIN, seamY, TICKET_W, STUB_H, [0, 0, 64, 64])
  ctx.clip()
  const rosette = guillocheFor(order.id, 600)
  const curve = new Path2D(rosette.path)
  ctx.translate(W / 2, seamY + STUB_H / 2 - 40)
  ctx.strokeStyle = order.accent
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 1.5
  for (let k = 0; k < rosette.copies; k++) {
    ctx.save()
    ctx.rotate((k * rosette.step * Math.PI) / 180)
    ctx.stroke(curve)
    ctx.restore()
  }
  ctx.restore()

  // El troquel: las muescas y los agujeritos
  ctx.fillStyle = NIGHT
  for (const nx of [MARGIN, MARGIN + TICKET_W]) {
    ctx.beginPath()
    ctx.arc(nx, seamY, 32, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let dx = MARGIN + 52; dx < MARGIN + TICKET_W - 40; dx += 27) {
    ctx.beginPath()
    ctx.arc(dx, seamY, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // La chapa y el QR
  const plate = 640
  const plateX = (W - plate) / 2
  const plateY = seamY + 74
  ctx.save()
  ctx.shadowColor = 'rgb(26 37 31 / 0.4)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 22
  ctx.fillStyle = '#fffcf2'
  rounded(ctx, plateX, plateY, plate, plate, 50)
  ctx.fill()
  ctx.restore()
  const pad = 40
  drawQr(ctx, qr, plateX + pad, plateY + pad, plate - pad * 2, darken(order.accent, 0.32))

  ctx.fillStyle = RUST
  ctx.font = `700 36px ${MONO}`
  tracked(ctx, formatShortCode(order.shortCode), W / 2, plateY + plate + 66, 8, 'center')
  ctx.fillStyle = INK
  ctx.font = `600 34px ${fonts.sans}`
  ctx.textAlign = 'center'
  ctx.fillText('Mostrá este QR en la puerta.', W / 2, plateY + plate + 120)
  ctx.textAlign = 'left'

  // ── Al pie ──
  ctx.fillStyle = 'rgb(243 236 218 / 0.9)'
  ctx.font = `600 40px ${fonts.serif}`
  ctx.textAlign = 'center'
  ctx.fillText(tenantName, W / 2, H - 92)
  if (address) {
    ctx.fillStyle = 'rgb(243 236 218 / 0.6)'
    ctx.font = `400 26px ${fonts.sans}`
    ctx.fillText(address, W / 2, H - 50)
  }
  ctx.textAlign = 'left'

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('sin imagen'))), 'image/png')
  })
}
