'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import {
  CHECK_EVERY_MS,
  decide,
  FIRST_CHECK_MS,
  FRESH_CHECK_MS,
  HIDDEN_MS,
  isStale,
  nextLook,
  parseReloadMark,
  parseVersion,
  type ReloadMark,
  type Situation,
  type Workspace,
} from '@/lib/app-version/decide'
import { reloadHeld } from '@/lib/app-version/hold'

/**
 * La app se pone al día sola cuando hay una versión nueva publicada.
 *
 * Pregunta qué versión está publicada (al rato de cargar, una vez por minuto con la pantalla a la vista, al
 * volver a la app, al volver la red y al cambiar de pantalla) y, si es otra, recarga en un momento en que no
 * le saca nada de las manos a nadie. CUÁNDO es ese momento lo decide `lib/app-version/decide.ts`, que es puro
 * y tiene sus pruebas; esto solo junta los datos de la pantalla y obedece.
 *
 * `servedId` es la versión que sirvió la página (`null` en desarrollo: no hace nada).
 */

const ENDPOINT = '/api/version'
const MARK_KEY = 'hub:app-version:reloaded'
const TIMEOUT_MS = 8_000
/** Si una pregunta falla, no se repite antes de esto. */
const RETRY_GAP_MS = 1_500
/** Con una versión nueva esperando: cada cuánto se confirma que la propia todavía contesta. */
const ORPHAN_EVERY_MS = 5 * 60_000
/** «Recién volví»: se volvió a la app hace un instante y todavía no se tocó nada. */
const RESUME_GRACE_MS = 4_000

/**
 * La versión con la que se cargó este documento. Vive fuera del componente: se fija una vez y ni cambiar de
 * pantalla ni un layout que se vuelve a pedir la tocan (solo una recarga entera).
 */
let loaded: string | null | undefined
/** Si ya hubo una pantalla montada en este documento: la primera es la carga, las demás son cambios de pantalla. */
let mountedOnce = false

/** Lo que se sabe hasta ahora. También fuera del componente: pasar del panel al salón no lo pierde. */
const known = {
  latest: null as string | null,
  checkedAt: null as number | null,
  orphaned: false,
  orphanCheckedAt: null as number | null,
  asking: null as Promise<void> | null,
  lastAttemptAt: 0,
  lastInputAt: Date.now(),
  lastNavAt: null as number | null,
  hiddenAt: null as number | null,
  resumedAt: null as number | null,
  reloading: false,
  timer: null as number | null,
}

type Answer = { ok: true; id: string | null } | { ok: false; gone: boolean }

/** Pregunta la versión. Con `pin`, a la versión propia (así se sabe si todavía contesta). */
async function ask(pin: string | null): Promise<Answer> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(ENDPOINT, {
      cache: 'no-store',
      // Sin cookies: no hacen falta, y así nada ata la pregunta a una versión.
      credentials: 'omit',
      headers: pin ? { 'x-deployment-id': pin } : undefined,
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, gone: response.status === 404 || response.status === 410 }
    return { ok: true, id: parseVersion(await response.json()) }
  } catch {
    return { ok: false, gone: false }
  } finally {
    window.clearTimeout(timer)
  }
}

/** Pone al día lo que se sabe, si lo que se sabe ya no es reciente. Nunca dos preguntas a la vez. */
function check(mine: string): Promise<void> {
  if (known.asking) return known.asking
  const now = Date.now()
  if (known.checkedAt !== null && now - known.checkedAt < FRESH_CHECK_MS) return Promise.resolve()
  if (now - known.lastAttemptAt < RETRY_GAP_MS) return Promise.resolve()
  known.lastAttemptAt = now
  known.asking = (async () => {
    const answer = await ask(null)
    if (!answer.ok) return
    known.latest = answer.id
    known.checkedAt = Date.now()
    if (!isStale(mine, answer.id)) {
      known.orphaned = false
      known.orphanCheckedAt = null
      return
    }
    // Hay otra versión publicada. ¿La de esta app sigue contestando? (Vercel la mantiene un tiempo.)
    if (
      known.orphanCheckedAt !== null &&
      Date.now() - known.orphanCheckedAt < ORPHAN_EVERY_MS &&
      !known.orphaned
    ) {
      return
    }
    const own = await ask(mine)
    if (own.ok) {
      known.orphaned = own.id !== mine
      known.orphanCheckedAt = Date.now()
    } else if (own.gone) {
      known.orphaned = true
      known.orphanCheckedAt = Date.now()
    }
  })().finally(() => {
    known.asking = null
  })
  return known.asking
}

const TEXT_TYPES = new Set(['', 'text', 'search', 'tel', 'url', 'email', 'password', 'number'])

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && TEXT_TYPES.has(el.type)
  }
  return false
}

/** ¿Hay algo abierto, en uso o escrito? Recargar se lo llevaría puesto. */
function isBusy(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true
  const active = document.activeElement
  if (active) {
    if (isTextField(active) || active instanceof HTMLSelectElement) return true
    if (active instanceof HTMLElement && active.isContentEditable) return true
  }
  for (const field of document.querySelectorAll('input, textarea')) {
    if (isTextField(field) && field.value.trim() !== '') return true
  }
  return false
}

function isHeld(): boolean {
  return reloadHeld() || document.querySelector('[data-no-reload]') !== null
}

function readMark(): { mark: ReloadMark | null; canRemember: boolean } {
  try {
    return { mark: parseReloadMark(window.sessionStorage.getItem(MARK_KEY)), canRemember: true }
  } catch {
    return { mark: null, canRemember: false }
  }
}

function writeMark(mark: ReloadMark): void {
  try {
    window.sessionStorage.setItem(MARK_KEY, JSON.stringify(mark))
  } catch {
    // Sin dónde anotar: el bucle se cuida con la edad de la página (ver `decide`).
  }
}

function situation(mine: string, workspace: Workspace): Situation {
  const now = Date.now()
  const visible = document.visibilityState === 'visible'
  const { mark, canRemember } = readMark()
  return {
    mine,
    latest: known.latest,
    workspace,
    now,
    checkedAt: known.checkedAt,
    online: navigator.onLine !== false,
    visible,
    hiddenMs: visible || known.hiddenAt === null ? 0 : now - known.hiddenAt,
    resumed:
      known.resumedAt !== null &&
      now - known.resumedAt <= RESUME_GRACE_MS &&
      known.lastInputAt <= known.resumedAt,
    idleMs: now - known.lastInputAt,
    sinceNavigationMs: known.lastNavAt === null ? null : now - known.lastNavAt,
    touchedSinceNavigation: known.lastNavAt !== null && known.lastInputAt > known.lastNavAt,
    busy: isBusy(),
    held: isHeld(),
    orphaned: known.orphaned,
    lastReload: mark,
    canRemember,
    pageAgeMs: performance.now(),
  }
}

function schedule(ms: number | null, again: () => void): void {
  if (known.timer !== null) window.clearTimeout(known.timer)
  known.timer = ms === null ? null : window.setTimeout(again, ms)
}

/** Pregunta (si hace falta) y decide. Es lo único que recarga. */
async function look(mine: string, workspace: Workspace): Promise<void> {
  if (known.reloading) return
  await check(mine)
  if (known.reloading) return
  // Al día (o todavía sin saber): no hay nada que decidir ni que mirar en la pantalla.
  if (!isStale(mine, known.latest)) {
    schedule(null, () => {})
    return
  }
  const now = situation(mine, workspace)
  const verdict = decide(now)
  if (verdict.reload && now.latest !== null) {
    known.reloading = true
    writeMark({ id: now.latest, at: Date.now() })
    window.location.reload()
    return
  }
  schedule(nextLook(now, verdict), () => void look(mine, workspace))
}

export function AppVersionWatcher({
  servedId,
  workspace,
}: {
  servedId: string | null
  workspace: Workspace
}) {
  const pathname = usePathname()
  const first = useRef(true)

  // La versión propia: la que sirvió este layout la PRIMERA vez que se montó en este documento. Sale de la misma
  // función del servidor que contesta `/api/version` (`currentDeploymentId`), así que las dos puntas comparan
  // exactamente lo mismo: si fueran dos fuentes distintas y difirieran en algo, la app se creería siempre
  // desactualizada.
  if (loaded === undefined && typeof window !== 'undefined') loaded = servedId
  const mine = typeof window === 'undefined' ? null : (loaded ?? null)

  useEffect(() => {
    if (!mine) return
    const run = () => void look(mine, workspace)

    const onInput = () => {
      known.lastInputAt = Date.now()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        known.hiddenAt = Date.now()
        // Con una versión nueva esperando: si sigue escondida un rato (otra pestaña de la compu), se recarga
        // sin que nadie lo vea. Un celular congela la página antes: ahí se recarga al volver.
        if (isStale(mine, known.latest)) schedule(HIDDEN_MS + 250, run)
        return
      }
      known.hiddenAt = null
      known.resumedAt = Date.now()
      run()
      // La red de un celular tarda en volver al desbloquearlo: si la primera pregunta falla, una más.
      window.setTimeout(() => {
        if (known.checkedAt === null || Date.now() - known.checkedAt > FRESH_CHECK_MS) run()
      }, 2_000)
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      known.resumedAt = Date.now()
      run()
    }

    const inputs = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
    for (const name of inputs) {
      window.addEventListener(name, onInput, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', run)
    const firstCheck = window.setTimeout(run, FIRST_CHECK_MS)
    const every = window.setInterval(() => {
      if (!document.hidden) run()
    }, CHECK_EVERY_MS)

    return () => {
      for (const name of inputs) window.removeEventListener(name, onInput, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', run)
      window.clearTimeout(firstCheck)
      window.clearInterval(every)
      schedule(null, run)
    }
  }, [mine, workspace])

  // Cambió la pantalla (o se pasó del panel al salón): lo anterior ya se dejó. Es el momento más seguro.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` es justamente lo que dispara esto
  useEffect(() => {
    if (!mine) return
    if (first.current) {
      first.current = false
      // La primera vez que algo se monta en este documento no es un cambio de pantalla: es la carga. (Pasar
      // del panel al salón monta de nuevo, y eso sí lo es.)
      const wasLoaded = mountedOnce
      mountedOnce = true
      if (!wasLoaded) return
    }
    known.lastNavAt = Date.now()
    void look(mine, workspace)
  }, [pathname, mine, workspace])

  return null
}
