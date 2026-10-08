'use client'

import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Info,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchArcaLookupStatus, lookupCuit } from '@/lib/arca/actions'
import {
  arcaSettingsHref,
  ivaPlainText,
  type LookupFillChange,
  type LookupFillPatch,
  type LookupFillPlan,
  type LookupFormSpec,
  type LookupFormValues,
  lookupAnnouncement,
  lookupAppliedMessage,
  lookupFailureView,
  lookupPatch,
  lookupSourceText,
  padronAddressText,
  personKindText,
  planLookupFill,
} from '@/lib/arca/lookup-fill'
import {
  type ArcaLookupStatus,
  ivaConditionText,
  type PadronLookupData,
  type PadronLookupResult,
  type PadronPurpose,
} from '@/lib/arca/views'
import { formatCuit, parseCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { useAccountingOptional } from './accounting-provider'

/**
 * «Completar con ARCA» (diseño §3.1): con la CUIT escrita, trae de ARCA el nombre,
 * la condición frente al IVA y el domicilio, y completa el formulario sin pisar lo
 * que la persona escribió (lo distinto lo pregunta antes).
 *
 * Dos piezas que comparten el estado de `useArcaLookup`:
 * - `ArcaLookupTrigger`: el botón (al lado del campo CUIT si se lo pasa como hijo;
 *   si no, en su propia fila) o, sin ARCA conectado, el link «Conectá ARCA…». Acá
 *   vive también el anuncio para el lector de pantalla («Consultando ARCA…», lo que
 *   contestó), porque el trigger está siempre montado;
 * - `ArcaLookupPanel`: la espera larga, el problema con «Cómo arreglarlo» o la
 *   tarjeta «Según ARCA» con [Usar estos datos].
 *
 * Solo para quien carga: la contadora (modo lectura) no ve nada. Si la consulta de
 * si hay ARCA falla (p. ej. la base todavía no tiene las tablas), tampoco: el
 * formulario queda como siempre.
 *
 * La consulta puede tardar (ARCA a veces contesta lento): el formulario se puede
 * seguir usando y una respuesta que llega tarde para otra CUIT se descarta.
 */

// ─── ¿Hay ARCA para consultar? (una vez por minuto y por bar) ────────────────

const STATUS_TTL_MS = 60_000
const statusCache = new Map<string, { at: number; promise: Promise<ArcaLookupStatus | null> }>()

function loadLookupStatus(tenantSlug: string): Promise<ArcaLookupStatus | null> {
  const now = Date.now()
  const hit = statusCache.get(tenantSlug)
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.promise
  const promise = fetchArcaLookupStatus(tenantSlug).then(
    (outcome) => (outcome.ok ? outcome.data : null),
    () => null,
  )
  statusCache.set(tenantSlug, { at: now, promise })
  return promise
}

// ─── Estado ──────────────────────────────────────────────────────────────────

/** `hidden`: no se muestra nada · `pending`: averiguando si hay ARCA · `not_connected`: el link. */
export type ArcaLookupAvailability = 'hidden' | 'pending' | 'not_connected' | 'ready'

type Failure = Extract<PadronLookupResult, { ok: false }>

export type ArcaLookupState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly cuit: string; readonly slow: boolean }
  | {
      readonly kind: 'found'
      readonly cuit: string
      readonly data: PadronLookupData
      /** `review`: la tarjeta · `confirm`: la pregunta antes de pisar · `applied`: «Listo». */
      readonly phase: 'review' | 'confirm' | 'applied'
      /** Lo que se completó con lo de ARCA. */
      readonly applied: readonly LookupFillChange[]
      /** Lo distinto que la persona prefirió dejar como estaba. */
      readonly kept: readonly LookupFillChange[]
    }
  | { readonly kind: 'failed'; readonly cuit: string; readonly failure: Failure }

const IDLE: ArcaLookupState = { kind: 'idle' }

/** Pasado este tiempo, «ARCA está tardando…». */
const SLOW_MS = 6_000
/** Consulta sola: la CUIT quedó completa y el nombre está vacío (diseño §3.1). */
const AUTO_DELAY_MS = 500

const OFFLINE_MESSAGE = 'Sin conexión: no pudimos consultar ARCA. Probá de nuevo.'

export type ArcaLookupOptions = {
  tenantSlug: string
  /** Proveedor o cliente: cambia los avisos (crédito fiscal, monotributo). */
  purpose: PadronPurpose
  /** Lo que está escrito en el campo CUIT (con o sin guiones). */
  cuit: string
  /** Lo que tiene hoy el formulario, para no pisar lo que escribió la persona. */
  values: LookupFormValues
  /** Las opciones del combo de IVA, lo que la persona eligió y los nombres de los campos. */
  spec?: LookupFormSpec
  /** Pone en el formulario los valores del parche (solo esos campos). */
  onApply: (patch: LookupFillPatch) => void
  /**
   * Si hay ARCA para consultar, del servidor (`getArcaLookupStatus`). Sin pasarlo se
   * pide con `fetchArcaLookupStatus`; `null` = no se pudo saber (no se muestra nada).
   */
  status?: ArcaLookupStatus | null
  /** `false`: no se consulta ni se muestra nada (p. ej. el documento es un DNI). */
  enabled?: boolean
  /** Sin ARCA conectado, el link «Conectá ARCA para completar esto solo» (por defecto, sí). */
  connectHint?: boolean
}

export type ArcaLookupController = {
  readonly tenantSlug: string
  readonly availability: ArcaLookupAvailability
  readonly connectHint: boolean
  /** La CUIT escrita es válida (11 números con el dígito verificador bien). */
  readonly cuitOk: boolean
  readonly cuitEmpty: boolean
  /** El estado de la CUIT que está escrita ahora (una respuesta de otra CUIT no se ve). */
  readonly state: ArcaLookupState
  /** Qué completaría [Usar estos datos] con lo que tiene hoy el formulario. */
  readonly plan: LookupFillPlan | null
  /** Lo último para el lector de pantalla. */
  readonly announcement: string
  /** Sube cuando la persona tocó algo que mueve el foco (la pregunta o el «Listo»). */
  readonly focusToken: number
  readonly ids: { readonly hint: string; readonly title: string; readonly question: string }
  /** Consulta la CUIT escrita (`refresh`: sin lo guardado del bar). */
  lookup: (refresh?: boolean) => void
  /** [Usar estos datos]: completa, o pregunta antes si pisa algo. */
  applyData: () => void
  /** La respuesta a la pregunta: `true` cambia también lo que escribió la persona. */
  resolve: (replace: boolean) => void
  /** Vuelve al estado inicial (al abrir de nuevo un diálogo). */
  reset: () => void
}

export function useArcaLookup(options: ArcaLookupOptions): ArcaLookupController {
  const {
    tenantSlug,
    purpose,
    cuit,
    values,
    spec,
    onApply,
    enabled = true,
    connectHint = true,
  } = options
  const accounting = useAccountingOptional()
  const active = enabled && accounting?.readOnly !== true
  const serverStatus = options.status !== undefined
  const [fetched, setFetched] = useState<ArcaLookupStatus | null | undefined>(undefined)
  const [disconnected, setDisconnected] = useState(false)
  const [state, setState] = useState<ArcaLookupState>(IDLE)
  const [announcement, setAnnouncement] = useState('')
  const [focusToken, setFocusToken] = useState(0)
  const uid = useId()

  const parsed = parseCuit(cuit)
  const digits = parsed.ok ? parsed.cuit : null
  const status = serverStatus ? options.status : fetched

  useEffect(() => {
    if (!active || serverStatus) return
    let alive = true
    void loadLookupStatus(tenantSlug).then((next) => {
      if (alive) setFetched(next)
    })
    return () => {
      alive = false
    }
  }, [active, serverStatus, tenantSlug])

  const availability: ArcaLookupAvailability = !active
    ? 'hidden'
    : status === undefined
      ? 'pending'
      : status === null
        ? 'hidden'
        : status.environment === null || disconnected
          ? 'not_connected'
          : 'ready'

  // Lo último del formulario, para cuando vuelve la respuesta (que puede tardar).
  const latest = useRef({ values, spec, onApply, digits })
  useEffect(() => {
    latest.current = { values, spec, onApply, digits }
  })

  const seq = useRef(0)
  const lastAsked = useRef<string | null>(null)

  const run = useCallback(
    async (target: string, refresh: boolean) => {
      const mine = ++seq.current
      lastAsked.current = target
      setState({ kind: 'loading', cuit: target, slow: false })
      setAnnouncement('Consultando ARCA…')
      let result: PadronLookupResult
      try {
        result = await lookupCuit(tenantSlug, { cuit: target, purpose, refresh })
      } catch {
        result = { ok: false, code: 'error', message: OFFLINE_MESSAGE, step: null }
      }
      if (mine !== seq.current) return
      if (!result.ok) {
        if (result.code === 'arca_not_connected') {
          statusCache.delete(tenantSlug)
          setDisconnected(true)
        }
        setState({ kind: 'failed', cuit: target, failure: result })
        setAnnouncement(result.message)
        return
      }
      // «Si el nombre estaba vacío, se completa solo» (diseño §3.1): solo lo que no
      // pisa nada, y solo si la CUIT sigue siendo la consultada.
      const now = latest.current
      const nameEmpty = now.values.name !== undefined && (now.values.name ?? '').trim() === ''
      if (nameEmpty && now.digits === target) {
        const plan = planLookupFill(result.data, now.values, now.spec)
        if (plan.conflicts.length === 0 && plan.fills.length > 0) {
          now.onApply(plan.fill)
          setState({
            kind: 'found',
            cuit: target,
            data: result.data,
            phase: 'applied',
            applied: plan.fills,
            kept: [],
          })
          setAnnouncement(`${lookupAnnouncement(result)} ${lookupAppliedMessage(plan.fills)}`)
          return
        }
      }
      setState({
        kind: 'found',
        cuit: target,
        data: result.data,
        phase: 'review',
        applied: [],
        kept: [],
      })
      setAnnouncement(lookupAnnouncement(result))
    },
    [tenantSlug, purpose],
  )

  // «ARCA está tardando…» después de unos segundos.
  useEffect(() => {
    if (state.kind !== 'loading' || state.slow) return
    const timer = setTimeout(() => {
      setState((prev) => (prev.kind === 'loading' ? { ...prev, slow: true } : prev))
    }, SLOW_MS)
    return () => clearTimeout(timer)
  }, [state])

  // Consulta sola cuando la CUIT queda completa y el nombre está vacío.
  const nameEmpty = values.name !== undefined && (values.name ?? '').trim() === ''
  useEffect(() => {
    if (availability !== 'ready' || !digits || !nameEmpty || lastAsked.current === digits) return
    const timer = setTimeout(() => void run(digits, false), AUTO_DELAY_MS)
    return () => clearTimeout(timer)
  }, [availability, digits, nameEmpty, run])

  const visible: ArcaLookupState = state.kind !== 'idle' && state.cuit !== digits ? IDLE : state
  const plan = visible.kind === 'found' ? planLookupFill(visible.data, values, spec) : null

  const lookup = (refresh = false) => {
    if (availability !== 'ready' || !digits || visible.kind === 'loading') return
    void run(digits, refresh)
  }

  const finish = (found: Extract<ArcaLookupState, { kind: 'found' }>, replace: boolean) => {
    const { patch, changes, kept } = lookupPatch(planLookupFill(found.data, values, spec), replace)
    if (Object.keys(patch).length > 0) onApply(patch)
    setState({ ...found, phase: 'applied', applied: changes, kept })
    setAnnouncement(lookupAppliedMessage(changes, kept))
    setFocusToken((n) => n + 1)
  }

  const applyData = () => {
    if (visible.kind !== 'found' || !plan) return
    if (plan.conflicts.length > 0) {
      setState({ ...visible, phase: 'confirm' })
      setFocusToken((n) => n + 1)
      return
    }
    finish(visible, false)
  }

  const resolve = (replace: boolean) => {
    if (visible.kind !== 'found') return
    finish(visible, replace)
  }

  const reset = useCallback(() => {
    seq.current += 1
    lastAsked.current = null
    setState(IDLE)
    setAnnouncement('')
  }, [])

  return {
    tenantSlug,
    availability,
    connectHint,
    cuitOk: digits !== null,
    cuitEmpty: cuit.trim() === '',
    state: visible,
    plan,
    announcement,
    focusToken,
    ids: { hint: `${uid}-arca-hint`, title: `${uid}-arca-title`, question: `${uid}-arca-q` },
    lookup,
    applyData,
    resolve,
    reset,
  }
}

// ─── El botón (o el link) ────────────────────────────────────────────────────

function NewTabNote() {
  return <span className="sr-only"> (se abre en otra pestaña)</span>
}

function ConnectLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:min-h-0"
    >
      <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
      Conectá ARCA para completar esto solo
      <NewTabNote />
      <ArrowUpRight className="size-3 shrink-0" aria-hidden />
    </Link>
  )
}

function LookupButton({ lookup }: { lookup: ArcaLookupController }) {
  const loading = lookup.state.kind === 'loading'
  const showHint = lookup.cuitEmpty && lookup.availability === 'ready'
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-full gap-2 sm:w-auto md:h-10"
      disabled={lookup.availability !== 'ready' || !lookup.cuitOk}
      aria-disabled={loading ? true : undefined}
      aria-describedby={showHint ? lookup.ids.hint : undefined}
      onClick={() => lookup.lookup()}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <BadgeCheck className="size-4" aria-hidden />
      )}
      {loading ? 'Consultando ARCA…' : 'Completar con ARCA'}
    </Button>
  )
}

/**
 * El botón «Completar con ARCA». Con el campo CUIT como hijo, el botón va a su
 * derecha desde `sm` (en el celular, abajo y a todo el ancho); sin hijo, en su
 * propia fila. Sin ARCA conectado: el link a Ajustes › ARCA (en otra pestaña, para
 * no perder lo cargado). Para la contadora, o si no se pudo saber, solo el hijo.
 *
 * Con hijo, el campo queda siempre en el mismo lugar del árbol (cambia lo de al
 * lado, no lo de arriba): así no se vuelve a montar ni pierde el foco cuando llega
 * la respuesta de si hay ARCA.
 */
export function ArcaLookupTrigger({
  lookup,
  children,
  className,
}: {
  lookup: ArcaLookupController
  children?: ReactNode
  className?: string
}) {
  const { availability } = lookup
  const ready = availability === 'ready'
  const link =
    availability === 'not_connected' && lookup.connectHint ? (
      <ConnectLink href={arcaSettingsHref(lookup.tenantSlug)} />
    ) : null
  const hint =
    ready && lookup.cuitEmpty ? (
      <p id={lookup.ids.hint} className="text-xs text-muted-foreground text-pretty">
        Con la CUIT traemos el resto de ARCA (ex AFIP).
      </p>
    ) : null
  // El anuncio para el lector de pantalla (fuera del flujo: no ocupa lugar).
  const live =
    ready || availability === 'not_connected' ? (
      <p role="status" className="sr-only">
        {lookup.announcement}
      </p>
    ) : null

  if (children) {
    return (
      <div className={cn('grid gap-1.5', className)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">{children}</div>
          {ready ? <LookupButton lookup={lookup} /> : null}
        </div>
        {link}
        {hint}
        {live}
      </div>
    )
  }

  // Sin hijo: sin nada para mostrar no ocupa lugar en el formulario.
  if (!ready && !link) return null
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3', className)}>
      {ready ? <LookupButton lookup={lookup} /> : null}
      {hint}
      {link}
      {live}
    </div>
  )
}

// ─── La respuesta ────────────────────────────────────────────────────────────

const ACTION_BUTTON = 'h-11 w-full gap-1.5 sm:w-auto md:h-8'

function FailureNotice({ lookup, failure }: { lookup: ArcaLookupController; failure: Failure }) {
  const view = lookupFailureView(lookup.tenantSlug, failure)
  const warning = view.tone === 'warning'
  // Siempre apilado: vive en diálogos angostos aunque la pantalla sea ancha.
  return (
    <div
      className={cn(
        'grid gap-3 rounded-xl border p-3 text-sm',
        warning ? 'border-warning/40 bg-warning/10' : 'border-destructive/30 bg-destructive/10',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <TriangleAlert
          aria-hidden
          className={cn('mt-0.5 size-4 shrink-0', warning ? 'text-warning' : 'text-destructive')}
        />
        <p className={cn('text-pretty', warning ? 'text-warning-text' : 'text-destructive')}>
          {view.message}
        </p>
      </div>
      {view.fixHref || view.connectHref || view.retry ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {view.fixHref ? (
            <Button asChild variant="outline" size="sm" className={ACTION_BUTTON}>
              <Link href={view.fixHref} target="_blank" rel="noopener noreferrer">
                Cómo arreglarlo
                <NewTabNote />
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {view.connectHref ? (
            <Button asChild variant="outline" size="sm" className={ACTION_BUTTON}>
              <Link href={view.connectHref} target="_blank" rel="noopener noreferrer">
                Conectar ARCA
                <NewTabNote />
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {view.retry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={ACTION_BUTTON}
              onClick={() => lookup.lookup(view.retry === 'refresh')}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {view.retry === 'refresh' ? 'Consultar de nuevo' : 'Probar de nuevo'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DataItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-pretty">{children}</dd>
    </div>
  )
}

const TEST_DATA_TEXT =
  'Son datos de prueba de homologación: ARCA está conectado solo en su ambiente de pruebas, así que pueden no ser los reales.'

function FoundCard({
  lookup,
  found,
}: {
  lookup: ArcaLookupController
  found: Extract<ArcaLookupState, { kind: 'found' }>
}) {
  const { data, phase } = found
  const plan = lookup.plan
  const questionRef = useRef<HTMLParagraphElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const focusToken = lookup.focusToken
  const handledToken = useRef(focusToken)

  // Lo que tocó la persona mueve el foco a lo nuevo (la pregunta o el «Listo»); lo
  // que se completó solo no le saca el foco a nadie.
  useEffect(() => {
    if (focusToken === handledToken.current) return
    handledToken.current = focusToken
    if (phase === 'confirm') questionRef.current?.focus()
    else if (phase === 'applied') doneRef.current?.focus()
  }, [focusToken, phase])

  const address = padronAddressText(data)
  const kind = personKindText(data.personKind)
  const iva = ivaConditionText(data.ivaCondition) ?? 'Sin datos de IVA'
  const warnings = data.warnings.filter((w) => w.key !== 'test_data')
  const hasChanges = plan !== null && (plan.fills.length > 0 || plan.conflicts.length > 0)

  return (
    <section
      aria-labelledby={lookup.ids.title}
      className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
        <h3 id={lookup.ids.title} className="text-sm font-medium">
          Según ARCA
        </h3>
        {data.testData ? (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-text">
            Datos de prueba
          </Badge>
        ) : null}
      </header>

      <div className="grid gap-0.5">
        <p className="break-words font-medium text-pretty">{data.name}</p>
        <p className="text-xs text-muted-foreground">
          <span className="inline-block">
            CUIT {formatCuit(data.cuit)} ({data.active ? 'activa' : 'inactiva'})
          </span>
          {kind ? <span className="inline-block">&nbsp;· {kind}</span> : null}
        </p>
      </div>

      <dl className="grid gap-2.5">
        <DataItem label="Condición frente al IVA">
          {iva}
          {data.monotributoCategory ? ` · ${data.monotributoCategory}` : null}
          <span className="block text-xs text-muted-foreground">
            {ivaPlainText(data.ivaCondition)}
          </span>
        </DataItem>
        {address ? <DataItem label="Dirección">{address}</DataItem> : null}
        {data.activity ? (
          <DataItem label="A qué se dedica">
            {data.activity.description ?? `Actividad ${data.activity.code}`}
          </DataItem>
        ) : null}
      </dl>

      {warnings.map((warning) => {
        const info = warning.key === 'monotributo'
        return (
          <p
            key={warning.key}
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-sm',
              info ? 'border-info/30 bg-info/10' : 'border-warning/40 bg-warning/10',
            )}
          >
            {info ? (
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            )}
            <span className={cn('text-pretty', !info && 'text-warning-text')}>
              {warning.message}
            </span>
          </p>
        )
      })}
      {data.testData ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="text-pretty text-warning-text">{TEST_DATA_TEXT}</span>
        </p>
      ) : null}
      {plan?.notes.map((note) => (
        <p key={note} className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="text-pretty">{note}</span>
        </p>
      ))}

      {phase === 'confirm' && plan ? (
        <fieldset
          aria-labelledby={lookup.ids.question}
          className="grid min-w-0 gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
        >
          <p
            id={lookup.ids.question}
            ref={questionRef}
            tabIndex={-1}
            className="text-sm font-medium text-warning-text text-pretty outline-none"
          >
            Esto ya estaba completo y ARCA dice otra cosa. ¿Lo cambiamos?
          </p>
          <ul className="grid gap-1.5 text-sm">
            {plan.conflicts.map((c) => (
              <li key={c.field} className="break-words text-pretty">
                <span className="font-medium">{c.label}:</span>{' '}
                {`acá dice «${c.from ?? ''}» y ARCA dice «${c.to}».`}
              </li>
            ))}
          </ul>
          {plan.fills.length > 0 ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Lo que está vacío se completa igual.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="h-11 md:h-9" onClick={() => lookup.resolve(true)}>
              Usar lo de ARCA
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => lookup.resolve(false)}
            >
              Dejar lo mío
            </Button>
          </div>
        </fieldset>
      ) : null}

      {phase === 'applied' ? (
        <p
          ref={doneRef}
          tabIndex={-1}
          className="flex items-start gap-1.5 text-sm text-success outline-none"
        >
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="text-pretty">{lookupAppliedMessage(found.applied, found.kept)}</span>
        </p>
      ) : null}

      {phase === 'review' ? (
        hasChanges ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2 justify-self-start sm:w-auto md:h-9"
            onClick={lookup.applyData}
          >
            <Check className="size-4" aria-hidden />
            Usar estos datos
          </Button>
        ) : (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span className="text-pretty">Ya coincide con lo que tenés cargado.</span>
          </p>
        )
      ) : null}

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{lookupSourceText(data)}</span>
        {data.source === 'cache' ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-foreground hover:underline md:min-h-0"
            onClick={() => lookup.lookup(true)}
          >
            <RefreshCw className="size-3" aria-hidden />
            Volver a consultar
          </button>
        ) : null}
      </p>
    </section>
  )
}

/**
 * Lo que contestó ARCA, debajo del campo CUIT (o de la fila donde está): la espera
 * larga, el problema con su arreglo o la tarjeta «Según ARCA». Sin nada que mostrar
 * no ocupa lugar en el formulario.
 */
export function ArcaLookupPanel({
  lookup,
  className,
}: {
  lookup: ArcaLookupController
  className?: string
}) {
  const state = lookup.state
  if (lookup.availability === 'hidden' || lookup.availability === 'pending') return null
  if (state.kind === 'idle') return null
  // «No está conectado»: ya lo dice el link de al lado del campo.
  if (
    state.kind === 'failed' &&
    state.failure.code === 'arca_not_connected' &&
    lookup.availability === 'not_connected' &&
    lookup.connectHint
  ) {
    return null
  }
  if (state.kind === 'loading') {
    return state.slow ? (
      <p className={cn('text-xs text-muted-foreground text-pretty', className)}>
        ARCA está tardando en contestar: puede llevar hasta un minuto.
      </p>
    ) : null
  }
  return (
    <div className={className}>
      {state.kind === 'failed' ? (
        <FailureNotice lookup={lookup} failure={state.failure} />
      ) : (
        <FoundCard lookup={lookup} found={state} />
      )}
    </div>
  )
}
