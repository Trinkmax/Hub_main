/**
 * El arte de la entrada: puro, sin React ni DOM. Lo usan la pantalla y la imagen
 * que se guarda, así los dos papeles salen iguales.
 */

/** El QR de la entrada, ya dibujado (lo arma `buildTicketQr` en el server). */
export type TicketQr = {
  /** Lo que lee el escáner: la URL /e/<código>. */
  url: string
  /** Módulos por lado, sin margen. */
  size: number
  /** Trazo de los módulos de datos: 1 unidad = 1 módulo, para `stroke-linecap: round`. */
  path: string
  /** Módulos por lado del hueco central. */
  hole: number
}

/** Largo de un ojo del QR, en módulos. */
export const QR_EYE = 7

/** Un número estable a partir del id del pedido: el mismo pedido, el mismo dibujo. */
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Generador chico y reproducible (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Guilloche = {
  /** Curva cerrada alrededor de (0, 0). */
  path: string
  /** Giro entre cada copia de la curva, en grados. */
  step: number
  /** Copias de la curva. */
  copies: number
}

/**
 * La roseta de seguridad del talón, como la de un billete: una curva que se
 * repite girando. La forma sale del id del pedido, así que no hay dos entradas
 * con el mismo dibujo.
 */
export function guillocheFor(id: string, radius: number): Guilloche {
  const rnd = seededRandom(seedFromId(id))
  const lobes = 5 + Math.floor(rnd() * 5)
  const ripple = lobes * (2 + Math.floor(rnd() * 2)) + 1
  const amp = 0.17 + rnd() * 0.07
  const amp2 = 0.05 + rnd() * 0.04
  const points = 220
  let path = ''
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2
    const r = radius * (1 - amp - amp2 + amp * Math.sin(lobes * t) + amp2 * Math.sin(ripple * t))
    const x = (r * Math.cos(t)).toFixed(1)
    const y = (r * Math.sin(t)).toFixed(1)
    path += `${i === 0 ? 'M' : 'L'}${x} ${y}`
  }
  const copies = 18
  return { path: `${path}Z`, step: 360 / lobes / copies, copies }
}

/**
 * El texto que gira alrededor del sello. Se repite hasta dar la vuelta: con un
 * nombre corto («Hub») las letras quedarían separadísimas.
 */
export function stampRing(tenantName: string): string {
  const piece = `${tenantName} ✦ Boletería ✦ `.toUpperCase()
  let ring = piece
  while ([...ring].length < 30) ring += piece
  return ring
}

/** La ✦ de HUB, centrada en (0, 0) con radio 1 (el trazo, no la tipografía). */
export const STAR_PATH =
  'M0 -1C.09 -.38 .38 -.09 1 0C.38 .09 .09 .38 0 1C-.09 .38 -.38 .09 -1 0C-.38 -.09 -.09 -.38 0 -1Z'

/**
 * El borde de un corte a mano: los dientes del rasgado, en px. Devuelve las
 * alturas (0 = línea del troquel) de izquierda a derecha.
 */
export function tornProfile(id: string, teeth = 46, depth = 7): number[] {
  const rnd = seededRandom(seedFromId(`${id}:corte`))
  return Array.from({ length: teeth + 1 }, (_, i) => {
    const up = i % 2 === 0
    const size = depth * (0.35 + rnd() * 0.65)
    return Number((up ? size : size * 0.15).toFixed(1))
  })
}

/** `clip-path` de la parte de ARRIBA de la entrada una vez cortada: sobreviven los dientes. */
export function tornClipTop(profile: number[]): string {
  const last = profile.length - 1
  const points = profile.map((h, i) => `${((i / last) * 100).toFixed(2)}% calc(100% - ${h}px)`)
  return `polygon(0 0, 100% 0, ${points.reverse().join(', ')})`
}

/** `clip-path` del talón que cae: el mismo rasgado, visto del otro lado. */
export function tornClipBottom(profile: number[]): string {
  const last = profile.length - 1
  const depth = Math.max(...profile)
  const points = profile.map(
    (h, i) => `${((i / last) * 100).toFixed(2)}% ${(depth - h).toFixed(1)}px`,
  )
  return `polygon(${points.join(', ')}, 100% 100%, 0 100%)`
}
