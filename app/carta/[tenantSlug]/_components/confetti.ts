/**
 * Papel picado para la inauguración de una sucursal (docs/features/carta-por-sucursal.md).
 *
 * Un solo lienzo encima de todo, que no se toca (`pointer-events: none`), se arma con el primer tiro y se saca solo
 * cuando cae el último papel. Vive en `document.body` y no en el árbol de React: el papel que sale al cortar la cinta
 * en el selector sigue cayendo sobre la carta que se abre. Quien pidió menos movimiento no ve nada.
 *
 * Solo para el navegador: se llama desde efectos y toques, nunca al renderizar.
 */

type Piece = {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  spin: number
  /** Fase del giro sobre sí mismo: el papel se ve de frente, de canto y de vuelta de frente. */
  flip: number
  flipSpeed: number
  width: number
  height: number
  color: string
  shape: 'paper' | 'dot' | 'streamer'
}

/** Terracota del Cerro, dorado de la cinta, crema y los verdes de la marca. */
const COLORS = ['#a8452d', '#d9714f', '#e0b24f', '#f3d98b', '#f6efe3', '#2f5d50', '#144d36']
const MAX_PIECES = 420
const GRAVITY = 0.2
const DRAG = 0.986
const TERMINAL = 4.4

let canvas: HTMLCanvasElement | null = null
let context: CanvasRenderingContext2D | null = null
let pieces: Piece[] = []
let frame = 0
let last = 0

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function resize(): void {
  if (!canvas) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(window.innerWidth * ratio)
  canvas.height = Math.round(window.innerHeight * ratio)
  context = canvas.getContext('2d')
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)
}

function ensureCanvas(): boolean {
  if (canvas) return context !== null
  canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.confetti = ''
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '90',
  })
  document.body.appendChild(canvas)
  resize()
  window.addEventListener('resize', resize)
  return context !== null
}

function teardown(): void {
  cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('resize', resize)
  canvas?.remove()
  canvas = null
  context = null
  pieces = []
}

function draw(ctx: CanvasRenderingContext2D, piece: Piece): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rotation)
  // De canto el papel casi desaparece y al darse vuelta se ve un poco más oscuro: eso es lo que lo hace «aletear».
  const face = Math.cos(piece.flip)
  ctx.scale(1, Math.max(Math.abs(face), 0.08))
  ctx.fillStyle = piece.color
  ctx.globalAlpha = face < 0 ? 0.82 : 1
  if (piece.shape === 'dot') {
    ctx.beginPath()
    ctx.arc(0, 0, piece.width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height)
  }
  ctx.restore()
}

function tick(now: number): void {
  const ctx = context
  if (!ctx) {
    teardown()
    return
  }
  // Pasos de un cuadro de 60 Hz: en un celular que va a 120 o que se trabó un momento, cae igual de rápido.
  const step = last === 0 ? 1 : Math.min(3, (now - last) / 16.67)
  last = now
  const width = window.innerWidth
  const height = window.innerHeight
  ctx.clearRect(0, 0, width, height)

  const alive: Piece[] = []
  for (const piece of pieces) {
    piece.vx *= DRAG ** step
    piece.vy = Math.min(piece.vy * DRAG ** step + GRAVITY * step, TERMINAL)
    piece.x += (piece.vx + Math.sin(piece.flip) * 0.7) * step
    piece.y += piece.vy * step
    piece.rotation += piece.spin * step
    piece.flip += piece.flipSpeed * step
    if (piece.y > height + 30 || piece.x < -60 || piece.x > width + 60) continue
    alive.push(piece)
    draw(ctx, piece)
  }
  pieces = alive
  if (pieces.length === 0) {
    teardown()
    return
  }
  frame = requestAnimationFrame(tick)
}

function newPiece(x: number, y: number, vx: number, vy: number): Piece {
  const shape = Math.random() < 0.16 ? 'dot' : Math.random() < 0.2 ? 'streamer' : 'paper'
  const width = shape === 'streamer' ? between(3, 4.5) : between(6, 10)
  return {
    x,
    y,
    vx,
    vy,
    rotation: between(0, Math.PI * 2),
    spin: between(-0.12, 0.12),
    flip: between(0, Math.PI * 2),
    flipSpeed: between(0.06, 0.16),
    width,
    height: shape === 'streamer' ? between(14, 22) : width * between(0.45, 0.75),
    color: pick(COLORS),
    shape,
  }
}

function launch(batch: Piece[]): void {
  pieces = pieces.concat(batch).slice(-MAX_PIECES)
  if (frame === 0) {
    last = 0
    frame = requestAnimationFrame(tick)
  }
}

/** Un estallido desde un punto (en píxeles de la pantalla): el corte de la cinta. */
export function confettiBurst(origin: { x: number; y: number }, count = 150): void {
  if (typeof window === 'undefined' || prefersReducedMotion() || !ensureCanvas()) return
  const batch: Piece[] = []
  for (let i = 0; i < count; i++) {
    // Hacia arriba y abierto como un abanico: el papel sube, se frena y cae.
    const angle = -Math.PI / 2 + between(-1.25, 1.25)
    const speed = between(5, 14)
    batch.push(newPiece(origin.x, origin.y, Math.cos(angle) * speed, Math.sin(angle) * speed))
  }
  launch(batch)
}

/** Una lluvia desde arriba de la pantalla: la bienvenida a la carta del día de la inauguración. */
export function confettiShower(count = 170): void {
  if (typeof window === 'undefined' || prefersReducedMotion() || !ensureCanvas()) return
  const width = window.innerWidth
  const height = window.innerHeight
  const batch: Piece[] = []
  for (let i = 0; i < count; i++) {
    // Arrancan escalonados por encima de la pantalla: entran de a poco durante un par de segundos.
    batch.push(
      newPiece(between(0, width), -between(10, height * 0.9), between(-1.2, 1.2), between(1, 3)),
    )
  }
  launch(batch)
}
