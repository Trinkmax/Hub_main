/**
 * La guía «Conectar ARCA» como datos (diseño §5.1.3) y el estado de cada paso
 * (§5.1.1): qué pasos hay, quién los hace, cómo se verifica cada uno y en qué
 * estado está para un bar, a partir de la conexión, lo marcado a mano
 * (`acc_guide_progress`) y la última «Probar conexión» (`last_test`, §2.6).
 *
 * Estados (el texto lo pone la pantalla, nunca solo el color):
 * - `done` «Hecho» · `todo` «Te toca» (el primer paso obligatorio sin hacer) ·
 *   `pending` «Pendiente» · `check` «Revisar» (un paso que se hace en ARCA y la
 *   prueba dice que falta algo) · `failed` «No anduvo» (un paso de la plataforma
 *   que falló).
 * - Un paso marcado a mano **después** de la última prueba gana: la persona dice
 *   que ya lo arregló, y la próxima prueba lo confirma o lo vuelve a abrir.
 * - La prueba solo cuenta si sigue vigente: con la conexión en `connected` o
 *   `error`. Subir otro certificado la deja en `cert_ready` y la prueba vieja deja
 *   de valer.
 *
 * También define el contrato de «Probar conexión» que comparten la acción (WP5),
 * la base (`acc_arca_record_test`) y la pantalla: las claves de los chequeos y
 * cuáles hacen falta para quedar conectado.
 *
 * Puro: lo usan la página de la guía y la pestaña de Ajustes.
 */

import { ARCA_ERRORS, type ArcaErrorKey, isArcaErrorKey } from './errors'

// ─── Pasos ───────────────────────────────────────────────────────────────────

export const ARCA_GUIDE_STEP_IDS = [
  's0_prereq',
  's1_elegir_sas',
  's2_punto_venta',
  's3_factura_a',
  's4_certificados',
  's5_pedido',
  's6_certificado',
  's7_wsfe',
  's8_padron',
  's9_probar',
  's10_mis_comprobantes',
] as const
export type ArcaGuideStepId = (typeof ARCA_GUIDE_STEP_IDS)[number]

export function isArcaGuideStepId(value: unknown): value is ArcaGuideStepId {
  return typeof value === 'string' && (ARCA_GUIDE_STEP_IDS as readonly string[]).includes(value)
}

/**
 * Cómo se da por hecho un paso:
 * - `manual`: solo pasa en ARCA; la persona marca «Ya lo hice» (o lo deduce un
 *   paso posterior que la plataforma sí puede ver).
 * - `auto`: la plataforma lo ve sola (hay pedido, hay certificado, hay punto de venta).
 * - `test`: lo confirma «Probar conexión»; antes se puede marcar a mano.
 */
export type ArcaGuideVerification = 'manual' | 'auto' | 'test'

export type ArcaGuideStep = {
  readonly id: ArcaGuideStepId
  /** El número que ve la persona (paso 0 a paso 10). */
  readonly n: number
  readonly title: string
  /** Dónde se hace: el servicio de ARCA o «La plataforma». */
  readonly where: string
  readonly who: string
  /** Tiempo aproximado, en minutos. */
  readonly minutes: number
  readonly verification: ArcaGuideVerification
  /** Opcional: no cuenta para «5 de 9» ni para «Te toca». */
  readonly optional: boolean
  /** Cómo se entera la plataforma de que está hecho (el pie del paso). */
  readonly howVerified: string
}

const ADMIN = 'Quien maneja la clave fiscal de la SAS (administrador de relaciones)'
const ANYONE = 'Cualquiera con acceso de carga en Administración'

export const ARCA_GUIDE_STEPS: readonly ArcaGuideStep[] = [
  {
    id: 's0_prereq',
    n: 0,
    title: 'Antes de empezar',
    where: 'ARCA',
    who: ADMIN,
    minutes: 10,
    verification: 'manual',
    optional: false,
    howVerified:
      'Lo marcás vos con «Ya revisé todo»; si ya subiste el certificado, lo damos por hecho. La CUIT de la SAS la vemos sola en Datos de la SAS.',
  },
  {
    id: 's1_elegir_sas',
    n: 1,
    title: 'Entrá a ARCA y elegí la SAS',
    where: 'Administrador de Relaciones de Clave Fiscal',
    who: ADMIN,
    minutes: 2,
    verification: 'manual',
    optional: false,
    howVerified: 'Lo marcás vos. Si después subís un certificado de la SAS, lo damos por hecho.',
  },
  {
    id: 's2_punto_venta',
    n: 2,
    title: 'Creá el punto de venta de la plataforma',
    where: 'Administración de puntos de venta y domicilios',
    who: ADMIN,
    minutes: 5,
    verification: 'auto',
    optional: false,
    howVerified: 'Se marca cuando guardás el número acá; lo confirmamos al probar la conexión.',
  },
  {
    id: 's3_factura_a',
    n: 3,
    title: 'Habilitá la Factura A (solo si la vas a usar)',
    where: 'Regímenes de Facturación y Registración',
    who: 'El administrador, con los socios y la contadora',
    minutes: 15,
    verification: 'manual',
    optional: true,
    howVerified: 'Se marca cuando elegís qué Factura A te autorizó ARCA.',
  },
  {
    id: 's4_certificados',
    n: 4,
    title: 'Habilitá «Administración de Certificados Digitales» para la SAS',
    where: 'Administrador de Relaciones de Clave Fiscal',
    who: ADMIN,
    minutes: 3,
    verification: 'manual',
    optional: false,
    howVerified: 'Lo marcás vos. Si después subís el certificado, lo damos por hecho.',
  },
  {
    id: 's5_pedido',
    n: 5,
    title: 'Generá el pedido de certificado',
    where: 'La plataforma',
    who: ANYONE,
    minutes: 1,
    verification: 'auto',
    optional: false,
    howVerified: 'Se marca solo cuando generás el pedido (.csr).',
  },
  {
    id: 's6_certificado',
    n: 6,
    title: 'Creá el certificado en ARCA y bajalo',
    where: 'Administración de Certificados Digitales',
    who: ADMIN,
    minutes: 3,
    verification: 'auto',
    optional: false,
    howVerified:
      'Se marca solo cuando subís un certificado válido, de la clave correcta y de la CUIT de la SAS.',
  },
  {
    id: 's7_wsfe',
    n: 7,
    title: 'Autorizá el certificado a «Facturación Electrónica»',
    where: 'Administrador de Relaciones de Clave Fiscal',
    who: ADMIN,
    minutes: 3,
    verification: 'test',
    optional: false,
    howVerified: 'Lo confirmamos al probar la conexión. Antes se puede marcar «Ya lo hice».',
  },
  {
    id: 's8_padron',
    n: 8,
    title: 'Autorizá también «Consulta de constancia de inscripción»',
    where: 'Administrador de Relaciones de Clave Fiscal',
    who: ADMIN,
    minutes: 2,
    verification: 'test',
    optional: false,
    howVerified: 'Lo confirmamos al probar la conexión. Antes se puede marcar «Ya lo hice».',
  },
  {
    id: 's9_probar',
    n: 9,
    title: 'Probá la conexión',
    where: 'La plataforma',
    who: ANYONE,
    minutes: 1,
    verification: 'auto',
    optional: false,
    howVerified: 'Se marca solo cuando todos los chequeos dan bien.',
  },
  {
    id: 's10_mis_comprobantes',
    n: 10,
    title: 'Habilitá «Mis Comprobantes» para quien baje las compras',
    where: 'Administrador de Relaciones de Clave Fiscal',
    who: ADMIN,
    minutes: 3,
    verification: 'manual',
    optional: true,
    howVerified: 'Lo marcás vos.',
  },
]

const STEP_BY_ID: ReadonlyMap<ArcaGuideStepId, ArcaGuideStep> = new Map(
  ARCA_GUIDE_STEPS.map((s) => [s.id, s]),
)

export function guideStep(id: ArcaGuideStepId): ArcaGuideStep {
  const step = STEP_BY_ID.get(id)
  if (!step) throw new RangeError(`Paso desconocido: ${id}`)
  return step
}

/** Los pasos que cuentan para el progreso («5 de 9»). */
export const ARCA_REQUIRED_STEPS: readonly ArcaGuideStepId[] = ARCA_GUIDE_STEPS.filter(
  (s) => !s.optional,
).map((s) => s.id)

// ─── «Probar conexión» (§2.6) ────────────────────────────────────────────────

export const ARCA_CHECK_KEYS = [
  'service',
  'wsfe_ticket',
  'relations',
  'point_of_sale',
  'numbering',
  'padron',
  'certificate',
] as const
export type ArcaCheckKey = (typeof ARCA_CHECK_KEYS)[number]

export type ArcaCheckDef = {
  /** Orden en pantalla (1 a 7). */
  readonly n: number
  readonly label: string
  /** Hace falta que dé bien para quedar `connected` (igual que `acc_arca_record_test`). */
  readonly required: boolean
  /** Si falla, la prueba se corta acá. */
  readonly stopsOnFail: boolean
}

export const ARCA_CHECKS: Readonly<Record<ArcaCheckKey, ArcaCheckDef>> = {
  service: { n: 1, label: 'ARCA responde', required: true, stopsOnFail: true },
  wsfe_ticket: {
    n: 2,
    label: 'El certificado es válido y está autorizado para Facturación Electrónica',
    required: true,
    stopsOnFail: true,
  },
  relations: {
    n: 3,
    label: 'La SAS está dentro del certificado',
    required: true,
    stopsOnFail: true,
  },
  point_of_sale: {
    n: 4,
    label: 'El punto de venta está habilitado',
    required: true,
    stopsOnFail: true,
  },
  numbering: { n: 5, label: 'Numeración', required: false, stopsOnFail: false },
  padron: {
    n: 6,
    label: 'Padrón (constancia de inscripción)',
    required: true,
    stopsOnFail: false,
  },
  certificate: { n: 7, label: 'Certificado', required: false, stopsOnFail: false },
}

/** Los chequeos que tienen que dar bien para quedar conectado. */
export const ARCA_REQUIRED_CHECKS: readonly ArcaCheckKey[] = ARCA_CHECK_KEYS.filter(
  (k) => ARCA_CHECKS[k].required,
)

export function isArcaCheckKey(value: unknown): value is ArcaCheckKey {
  return typeof value === 'string' && (ARCA_CHECK_KEYS as readonly string[]).includes(value)
}

/**
 * Un chequeo como lo guarda `acc_arca_connections.last_test` (y como lo valida
 * `acc_arca_record_test`: `detail` es un objeto o nada; `error`, una clave).
 */
export type ArcaTestCheck = {
  readonly key: string
  readonly ok: boolean
  readonly detail?: Readonly<Record<string, unknown>> | null
  readonly error?: string | null
}

export type ArcaTestResult = {
  /** ISO. */
  readonly at: string
  readonly environment: string
  readonly status: 'connected' | 'error'
  readonly checks: readonly ArcaTestCheck[]
}

/** `connected` si dieron bien todos los obligatorios (la misma regla que la base). */
export function arcaTestStatus(checks: readonly ArcaTestCheck[]): 'connected' | 'error' {
  const ok = new Set(checks.filter((c) => c.ok).map((c) => c.key))
  return ARCA_REQUIRED_CHECKS.every((k) => ok.has(k)) ? 'connected' : 'error'
}

/**
 * Qué paso arregla un chequeo que falló con tal error. Los errores que no se
 * arreglan en un paso (ARCA caído, un bug) no apuntan a ninguno. El padrón usa el
 * paso 8 para la autorización.
 */
export function stepForFailedCheck(
  key: string,
  error: string | null | undefined,
): ArcaGuideStepId | null {
  if (!isArcaErrorKey(error)) return null
  const step = ARCA_ERRORS[error].step
  // La autorización del padrón (y su representación) se hace en el paso 8, no en el 7.
  return key === 'padron' && step === 's7_wsfe' ? 's8_padron' : step
}

// ─── Estado de la guía ───────────────────────────────────────────────────────

export const ARCA_CONNECTION_STATUSES = [
  'draft',
  'key_ready',
  'cert_ready',
  'connected',
  'error',
  'disconnected',
] as const
export type ArcaConnectionStatus = (typeof ARCA_CONNECTION_STATUSES)[number]

/** Lo que la guía necesita de la conexión (sin secretos). */
export type GuideConnection = {
  /** `null`: todavía no hay conexión. */
  readonly status: ArcaConnectionStatus | null
  /** Hay CUIT en Datos de la SAS. */
  readonly hasSasCuit: boolean
  /** Hay pedido (`csr_pem`). */
  readonly hasCsr: boolean
  /** Hay certificado subido (`certificate_pem`). */
  readonly hasCertificate: boolean
  /** `cert_not_after`, ISO. */
  readonly certNotAfter: string | null
  readonly pointOfSale: number | null
  /** `allowed_classes`: `B`, `A`, `A51`, `ACBU`. */
  readonly allowedClasses: readonly string[]
  /** `last_error_key`. */
  readonly lastErrorKey?: string | null
}

/** Una fila de `acc_guide_progress` (guía `arca`). */
export type GuideProgressRow = {
  readonly step: string
  /** ISO. */
  readonly doneAt: string
  readonly doneByName?: string | null
}

export type ArcaStepStatus = 'done' | 'todo' | 'pending' | 'check' | 'failed'

/** Motivos propios de la guía (los demás son claves de `ARCA_ERRORS`). */
export const ARCA_GUIDE_REASONS = {
  sas_cuit_missing: 'Falta la CUIT de la SAS en Ajustes › Datos de la SAS.',
  cert_expired: 'El certificado venció: renovalo (paso 6).',
} as const
export type ArcaGuideReason = keyof typeof ARCA_GUIDE_REASONS

export type ArcaStepState = {
  readonly id: ArcaGuideStepId
  readonly n: number
  readonly status: ArcaStepStatus
  /** Por qué está en `check` o `failed`: una clave de `ARCA_ERRORS` o de `ARCA_GUIDE_REASONS`. */
  readonly reason: ArcaErrorKey | ArcaGuideReason | null
  /** De dónde salió el «Hecho». */
  readonly source: 'manual' | 'auto' | 'test' | null
  /** Cuándo y quién lo marcó a mano (para «Hecho el 08/10 por Nacho»). */
  readonly doneAt: string | null
  readonly doneBy: string | null
}

type Draft = {
  readonly done: boolean
  readonly source: ArcaStepState['source']
  readonly flag: 'check' | 'failed' | null
  readonly reason: ArcaStepState['reason']
}

const NOT_DONE: Draft = { done: false, source: null, flag: null, reason: null }
const doneBy = (source: 'manual' | 'auto' | 'test'): Draft => ({
  done: true,
  source,
  flag: null,
  reason: null,
})
const flagged = (flag: 'check' | 'failed', reason: ArcaStepState['reason']): Draft => ({
  done: false,
  source: null,
  flag,
  reason,
})

/**
 * El estado de cada paso de la guía para un bar. `now` sirve para ver si el
 * certificado venció.
 */
export function arcaGuideState(
  conn: GuideConnection,
  progress: readonly GuideProgressRow[],
  lastTest: ArcaTestResult | null,
  now: Date = new Date(),
): ArcaStepState[] {
  const manual = new Map<string, GuideProgressRow>()
  for (const row of progress) if (isArcaGuideStepId(row.step)) manual.set(row.step, row)

  const status = conn.status
  const connected = status === 'connected'
  const testIsCurrent = lastTest !== null && (status === 'connected' || status === 'error')
  const testAt = testIsCurrent ? Date.parse(lastTest.at) : Number.NaN
  const checks = new Map<string, ArcaTestCheck>()
  if (testIsCurrent) for (const c of lastTest.checks) checks.set(c.key, c)
  const checkOk = (key: ArcaCheckKey) => checks.get(key)?.ok === true

  // Qué paso señala cada chequeo que falló (el primer error por paso).
  const failures = new Map<ArcaGuideStepId, ArcaErrorKey>()
  if (testIsCurrent) {
    for (const c of lastTest.checks) {
      if (c.ok) continue
      const step = stepForFailedCheck(c.key, c.error)
      if (step && isArcaErrorKey(c.error) && !failures.has(step)) failures.set(step, c.error)
    }
  }

  const hasCertificate = conn.hasCertificate && status !== null && status !== 'disconnected'
  const certExpired =
    hasCertificate && conn.certNotAfter !== null && Date.parse(conn.certNotAfter) <= now.getTime()
  const hasAClass = conn.allowedClasses.some((c) => c !== 'B')

  /** «Hecho» por algo que la plataforma ve (`auto`), por la prueba (`test`) o a mano. */
  const base = (
    id: ArcaGuideStepId,
    seen: { auto?: boolean; test?: boolean; implied?: boolean },
  ): Draft => {
    const mark = manual.get(id)
    const markedAfterTest =
      mark !== undefined && (Number.isNaN(testAt) || Date.parse(mark.doneAt) > testAt)
    const failure = failures.get(id)
    if (failure && !markedAfterTest) {
      return flagged(guideStep(id).verification === 'auto' ? 'failed' : 'check', failure)
    }
    if (seen.test) return doneBy('test')
    if (seen.auto) return doneBy('auto')
    if (mark) return doneBy('manual')
    if (seen.implied) return doneBy('auto')
    return NOT_DONE
  }

  // Si ya hay un certificado, los pasos previos en ARCA se hicieron (no se crea sin clave nivel 3).
  const prereq = base('s0_prereq', { implied: hasCertificate || connected })
  let probar: Draft = NOT_DONE
  if (connected) probar = doneBy('test')
  else if (status === 'error') {
    const firstError = testIsCurrent
      ? lastTest.checks.find((c) => !c.ok && isArcaErrorKey(c.error))?.error
      : null
    probar = flagged(
      'failed',
      isArcaErrorKey(firstError)
        ? firstError
        : isArcaErrorKey(conn.lastErrorKey)
          ? conn.lastErrorKey
          : 'arca_unknown',
    )
  }

  const drafts: Record<ArcaGuideStepId, Draft> = {
    s0_prereq: prereq.done && !conn.hasSasCuit ? flagged('check', 'sas_cuit_missing') : prereq,
    s1_elegir_sas: base('s1_elegir_sas', { implied: hasCertificate || connected }),
    s2_punto_venta: base('s2_punto_venta', {
      auto: conn.pointOfSale !== null,
      test: checkOk('point_of_sale'),
    }),
    s3_factura_a: base('s3_factura_a', { auto: hasAClass }),
    s4_certificados: base('s4_certificados', { implied: hasCertificate || connected }),
    s5_pedido: base('s5_pedido', { auto: conn.hasCsr || hasCertificate }),
    s6_certificado: certExpired
      ? flagged('failed', 'cert_expired')
      : base('s6_certificado', { auto: hasCertificate }),
    s7_wsfe: base('s7_wsfe', { test: checkOk('wsfe_ticket') && checkOk('relations') }),
    s8_padron: base('s8_padron', { test: checkOk('padron') }),
    s9_probar: probar,
    s10_mis_comprobantes: base('s10_mis_comprobantes', {}),
  }

  let todoGiven = false
  return ARCA_GUIDE_STEPS.map((step) => {
    const d = drafts[step.id]
    const mark = manual.get(step.id)
    let stepStatus: ArcaStepStatus
    if (d.done) stepStatus = 'done'
    else if (d.flag) stepStatus = d.flag
    else if (!step.optional && !todoGiven) {
      stepStatus = 'todo'
      todoGiven = true
    } else stepStatus = 'pending'
    return {
      id: step.id,
      n: step.n,
      status: stepStatus,
      reason: d.reason,
      source: d.done ? d.source : null,
      doneAt: d.done && d.source === 'manual' && mark ? mark.doneAt : null,
      doneBy: d.done && d.source === 'manual' && mark ? (mark.doneByName ?? null) : null,
    }
  })
}

/** «5 de 9»: los pasos obligatorios hechos, el total y el primero que falta. */
export function guideProgressSummary(states: readonly ArcaStepState[]): {
  done: number
  total: number
  next: ArcaGuideStepId | null
} {
  const required = states.filter((s) => ARCA_REQUIRED_STEPS.includes(s.id))
  const next =
    required.find((s) => s.status === 'check' || s.status === 'failed' || s.status === 'todo') ??
    null
  return {
    done: required.filter((s) => s.status === 'done').length,
    total: required.length,
    next: next ? next.id : null,
  }
}
