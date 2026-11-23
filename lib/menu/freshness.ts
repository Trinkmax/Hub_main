/**
 * La carta siempre al día: cuándo una carta abierta en el celular se vuelve a pedir.
 *
 * El problema: la carta no se guarda en el servidor (sale con `no-store`), la copia vieja vive en
 * el celular. La pestaña queda abierta días y el navegador la muestra de memoria, sin volver a
 * pedirla (lo mismo con el «atrás»). Cada bar tiene un número de versión de su carta
 * (`menu_revisions.rev`) que sube solo con cualquier cambio del menú; la carta abierta lo compara
 * al volver a primer plano y, si cambió, se refresca (`app/carta/[tenantSlug]/_components/carta-freshness.tsx`).
 *
 * Todo lo que decide vive acá, puro (sin React ni `server-only`) para poder probarlo:
 * `tests/lib/menu-freshness.test.ts`. Ver `docs/features/carta-al-dia.md`.
 */

/** Cada cuánto se pregunta mientras la carta está a la vista. */
export const CARTA_CHECK_INTERVAL_MS = 4 * 60 * 1000

/** Red de seguridad: si no se puede saber la versión, una carta de más de 12 h se vuelve a pedir igual. */
export const CARTA_MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * Después de pedir la carta nueva, cuánto se espera a que llegue antes de volver a preguntar. Es un
 * techo: si el render nuevo no llega (o llega con el mismo número) los chequeos no quedan trabados.
 */
export const CARTA_REFRESH_GRACE_MS = 6_000

/** Mínimo entre dos preguntas: volver a la pestaña dispara varios eventos juntos (visible, foco, `pageshow`). */
export const CARTA_MIN_CHECK_GAP_MS = 15_000

/** Cuánto se espera la respuesta: con más, la señal es mala y recargar tampoco andaría. */
export const CARTA_CHECK_TIMEOUT_MS = 8_000

/** Una pregunta sin respuesta después de esto se da por perdida (p. ej. el celular la congeló a la mitad). */
export const CARTA_CHECK_STUCK_MS = 20_000

/**
 * Los rubros con horario (`lib/menu/availability.ts`) cambian la carta sin que nadie la edite: a las
 * 12 aparece el menú del mediodía, a las 16 se va. El render dice en cuánto es el próximo cambio y la
 * carta abierta se vuelve a pedir un poco después: este margen cubre el viaje del render y los
 * segundos que el reloj del servidor pueda ir atrás (si llegara antes, el render nuevo trae otra vez
 * el mismo cambio y se vuelve a pedir: dos pedidos, no un bucle).
 */
export const CARTA_SCHEDULE_MARGIN_MS = 5_000

/** Un cambio de horario nunca está a más de un día (la medianoche cambia el día): más es un dato roto. */
const CARTA_SCHEDULE_MAX_MS = 25 * 60 * 60 * 1000

export type CartaRefreshDecision = 'refresh' | 'stay'

export type CartaRefreshInput = {
  /** La versión que esta carta ya tiene (la del render, o la que ya se pidió). */
  renderedRev: number
  /** La que contestó `carta_menu_rev` recién; `null` si no se pudo saber. */
  latestRev: number | null
  /** Cuándo se armó la página en el servidor (ms, reloj del servidor). */
  renderedAt: number
  /** Cuándo la vio por primera vez este celular (ms, reloj del celular). */
  seenAt?: number | null
  /** Ahora (ms, reloj del celular). */
  now: number
  /** Edad máxima para la red de seguridad. Default: 12 h. */
  maxAgeMs?: number
  /**
   * No se llegó al servidor: sin señal, se cortó por tiempo o Supabase anda mal. Ahí nunca se
   * refresca, ni por edad: si el pedido de la carta falla, Next cae a una navegación completa y el
   * celular mostraría una página de error en vez de la carta (vieja, pero carta).
   */
  unreachable?: boolean
  /**
   * Ya pasó la hora en que un rubro con horario aparece o se va (`cartaScheduleDue`): la carta se
   * vuelve a pedir aunque nadie la haya editado.
   */
  scheduleDue?: boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Lee un número de versión: entero, 0 o más. `null` si no lo es (error, NaN, negativo, texto raro).
 * Un guard alcanza para un entero; zod sumaría peso al bundle de la carta pública.
 */
export function parseMenuRev(value: unknown): number | null {
  let n = Number.NaN
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim())
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * ¿Hay que volver a pedir la carta?
 *
 * - Si se sabe la versión: se refresca solo si es MÁS NUEVA que la que la carta ya tiene. Igual o
 *   menor (una réplica atrasada, un render que no pudo leer la suya) nunca: así no hay bucle.
 * - Si no se sabe (la consulta falló): red de seguridad, se refresca si la carta tiene más de
 *   `maxAgeMs`, salvo que no se haya llegado al servidor.
 * - Si pasó la hora de un rubro con horario (`scheduleDue`): se refresca, siempre que se haya llegado
 *   al servidor. Quien llama lo marca una sola vez por render, así tampoco hay bucle.
 *
 * La edad se cuenta desde lo más reciente entre el render (reloj del servidor) y cuando la vio este
 * celular (su reloj): con el reloj del celular adelantado, la hora del servidor sola dispararía la red
 * de seguridad apenas abre. Atrasado, la red llega más tarde, nunca de más.
 */
export function decideCartaRefresh(input: CartaRefreshInput): CartaRefreshDecision {
  const renderedRev = parseMenuRev(input.renderedRev) ?? 0
  const latestRev = parseMenuRev(input.latestRev)
  if (latestRev !== null && latestRev > renderedRev) return 'refresh'
  if (input.unreachable) return 'stay'
  // La hora de un rubro ya pasó y el servidor contesta: se pide la carta de esta hora.
  if (input.scheduleDue === true) return 'refresh'
  if (latestRev !== null) return 'stay'

  const maxAgeMs =
    isFiniteNumber(input.maxAgeMs) && input.maxAgeMs > 0 ? input.maxAgeMs : CARTA_MAX_AGE_MS
  const since = [input.renderedAt, input.seenAt].filter(isFiniteNumber)
  if (since.length === 0 || !isFiniteNumber(input.now)) return 'stay'
  const age = input.now - Math.max(...since)
  return age > maxAgeMs ? 'refresh' : 'stay'
}

/**
 * Cuándo vence el horario de este render, en el reloj del celular: cuando lo vio + lo que el servidor
 * dijo que faltaba + el margen. `null` si ningún rubro tiene horario (o el dato no sirve).
 */
export function cartaScheduleDueAt(
  changeInMs: number | null | undefined,
  seenAt: number,
  marginMs: number = CARTA_SCHEDULE_MARGIN_MS,
): number | null {
  if (!isFiniteNumber(changeInMs) || !isFiniteNumber(seenAt)) return null
  if (changeInMs < 0 || changeInMs > CARTA_SCHEDULE_MAX_MS) return null
  return seenAt + changeInMs + marginMs
}

/** ¿Ya pasó? Con el reloj del celular para atrás (antes de haberlo visto) nunca vence. */
export function cartaScheduleDue(dueAt: number | null, now: number): boolean {
  return dueAt !== null && isFiniteNumber(now) && now >= dueAt
}

/** Lo que contestó `carta_menu_rev`, ya clasificado. */
export type CartaRevAnswer =
  | { kind: 'rev'; rev: number }
  /** El servidor contestó, pero con un error o algo que no es una versión. */
  | { kind: 'rejected' }
  /** No hubo respuesta (sin señal, se cortó por tiempo) o Supabase anda mal (5xx). */
  | { kind: 'unreachable' }

/**
 * Clasifica la respuesta de supabase-js. Ante un corte de red o un `abort`, supabase-js no tira:
 * devuelve `status: 0` con el error adentro.
 */
export function readCartaRevAnswer(res: {
  data: unknown
  error: unknown
  status: number
}): CartaRevAnswer {
  if (!isFiniteNumber(res.status) || res.status <= 0 || res.status >= 500) {
    return { kind: 'unreachable' }
  }
  if (res.error) return { kind: 'rejected' }
  const rev = parseMenuRev(res.data)
  return rev === null ? { kind: 'rejected' } : { kind: 'rev', rev }
}

export type CartaCheckGate = {
  now: number
  /** La pestaña no se ve: nadie mira la carta. */
  hidden: boolean
  /** `navigator.onLine === false`: ni se intenta. */
  offline: boolean
  /** Ya se pidió la carta nueva y se está esperando (dentro de la gracia). */
  refreshing: boolean
  /** Cuándo salió la pregunta que todavía no volvió, o `null`. */
  inFlightSince: number | null
  /** Cuándo contestó el servidor por última vez (bien o con error), o `null`. */
  lastAnswerAt: number | null
  minGapMs?: number
  stuckMs?: number
}

/**
 * ¿Se puede preguntar ahora? Evita los chequeos duplicados: volver a la pestaña dispara
 * `visibilitychange`, `focus` y a veces `pageshow` juntos. El mínimo se cuenta desde la última
 * RESPUESTA: un intento sin señal no cuenta, así el `online` de cuando vuelve la señal sí pregunta.
 * Si el reloj del celular fue para atrás, la marca vieja no bloquea.
 */
export function shouldCheckCarta(gate: CartaCheckGate): boolean {
  if (gate.hidden || gate.offline || gate.refreshing) return false
  const within = (since: number | null, ms: number) => {
    if (since === null) return false
    const elapsed = gate.now - since
    return elapsed >= 0 && elapsed < ms
  }
  if (within(gate.inFlightSince, gate.stuckMs ?? CARTA_CHECK_STUCK_MS)) return false
  if (within(gate.lastAnswerAt, gate.minGapMs ?? CARTA_MIN_CHECK_GAP_MS)) return false
  return true
}
