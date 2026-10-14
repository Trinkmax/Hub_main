'use client'

import { ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { TEXT_LINK } from '@/components/administracion/acciones/sheet-parts'
import { StepCard, type StepState } from '@/components/administracion/kit/step'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { bootstrapAccounting } from '@/lib/accounting/actions/setup'
import { Callout } from '../../ajustes/_components/form-bits'
import {
  checkWizard,
  initialWizardState,
  isImplicitSubmit,
  isStepOneField,
  SERVER_KEY_FIELDS,
  type WizardSalesPoint,
  type WizardState,
  type WizardTreasury,
  wizardFieldKey,
  wizardPayload,
  wizardStateFromDraft,
} from '../_lib/wizard'
import {
  cajasSummary,
  cobrosSummary,
  errorsOfScreen,
  firstErrorScreen,
  puntosSummary,
  REVIEW_SCREEN,
  readWizardDraft,
  sasSummary,
  WIZARD_NEXT_LABEL,
  WIZARD_QUESTIONS,
  type WizardScreen,
  wizardDraftValue,
} from '../_lib/wizard-steps'
import { SetupRail } from './setup-rail'
import { StepCajas } from './wizard/step-cajas'
import { StepCobros } from './wizard/step-cobros'
import { StepPuntos } from './wizard/step-puntos'
import { StepReview } from './wizard/step-review'
import { StepSas } from './wizard/step-sas'
import { WizardWelcome } from './wizard/welcome'

type Banner = {
  tone: 'error' | 'info'
  message: string
  action?: { label: string; href: string }
}

function draftKey(slug: string): string {
  return `hub:acc:draft:configurar:${slug}`
}

/**
 * La puesta en marcha de un bar nuevo: bienvenida y cinco pasos chicos → UN
 * solo guardado (`bootstrapAccounting`). Antes eran dos pantallas, y la
 * segunda juntaba cajas, cobros y puntos de venta (unas treinta decisiones,
 * con los porcentajes plegados); ahí fue el Enter del 12/10 que cerró la
 * puesta en marcha de un bar a medias.
 *
 * Lo que se manda no cambió: el mismo `WizardState`, la misma validación
 * (`checkWizard`, con el esquema del servidor) y `wizardPayload`. Cambió el
 * recorrido: cada paso pregunta una cosa, lo hecho queda plegado con su
 * resumen y «Cambiar», y recién el último paso guarda. Todo va dentro de UN
 * formulario que no deja que un Enter suelto lo envíe; «Seguir» nunca guarda.
 *
 * Cada paso queda como borrador en este navegador (`localStorage`) hasta
 * guardar: la misma clave y versión de siempre, más en qué paso se estaba.
 */
export function SetupWizard({
  tenantSlug,
  today,
  tenantName,
  defaultDisplayName,
  haveAtHand,
}: {
  tenantSlug: string
  today: string
  tenantName: string
  defaultDisplayName: string
  /** «Tené a mano», de la guía «Cómo arrancar». */
  haveAtHand: readonly string[]
}) {
  const router = useRouter()
  const base = `/${tenantSlug}/administracion`
  const initial = useMemo(
    () => initialWizardState({ tenantName, displayName: defaultDisplayName, today }),
    [tenantName, defaultDisplayName, today],
  )
  /** 0 = la bienvenida; 1 a 5 = el paso abierto. */
  const [screen, setScreen] = useState<0 | WizardScreen>(0)
  /** El último paso que ya se resolvió (lo que queda tildado al volver atrás). */
  const [doneUpTo, setDoneUpTo] = useState(0)
  const [state, setState] = useState<WizardState>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<Banner | null>(null)
  const [restored, setRestored] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const draftReady = useRef(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  // ─── Borrador ──────────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: se lee una sola vez al abrir
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(tenantSlug))
      if (raw) {
        const draft = readWizardDraft(JSON.parse(raw) as unknown)
        const restoredState = draft ? wizardStateFromDraft(draft.state, initial) : null
        if (draft && restoredState) {
          setState(restoredState)
          setScreen(draft.screen)
          setDoneUpTo(draft.screen - 1)
          setRestored(true)
        }
      }
    } catch {
      // Sin localStorage o un borrador roto: se arranca de cero.
    }
    draftReady.current = true
  }, [])

  useEffect(() => {
    if (!draftReady.current || saved || screen === 0) return
    try {
      window.localStorage.setItem(
        draftKey(tenantSlug),
        JSON.stringify(wizardDraftValue(screen, state)),
      )
    } catch {
      // Sin espacio o sin permiso: el asistente sigue andando igual.
    }
  }, [state, screen, saved, tenantSlug])

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey(tenantSlug))
    } catch {
      // nada que limpiar
    }
  }

  // ─── Foco ──────────────────────────────────────────────────────────────────
  // Al cambiar de paso, queda arriba el paso que se abre.
  useEffect(() => {
    if (screen === 0) return
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`paso-${screen}`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [screen])

  // Con errores, el foco va al primer campo marcado.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  // ─── Cambios ───────────────────────────────────────────────────────────────
  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }))
  const clearError = (...fields: string[]) =>
    setErrors((prev) => {
      if (!fields.some((f) => f in prev)) return prev
      const next = { ...prev }
      for (const f of fields) delete next[f]
      return next
    })
  const updateTreasury = (key: string, patch: Partial<WizardTreasury>) =>
    setState((s) => ({
      ...s,
      treasuries: s.treasuries.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }))
  const removeTreasury = (key: string) =>
    setState((s) => ({ ...s, treasuries: s.treasuries.filter((t) => t.key !== key) }))
  const updatePoint = (id: string, patch: Partial<WizardSalesPoint>) =>
    setState((s) => ({
      ...s,
      salesPoints: s.salesPoints.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  const removePoint = (id: string) =>
    setState((s) => ({ ...s, salesPoints: s.salesPoints.filter((p) => p.id !== id) }))

  const addTreasury = () =>
    setState((s) => {
      const used = s.treasuries
        .map((t) => /^extra_(\d+)$/.exec(t.key)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
      const n = (used.length > 0 ? Math.max(...used) : 0) + 1
      return {
        ...s,
        treasuries: [
          ...s.treasuries,
          {
            key: `extra_${n}`,
            preset: null,
            enabled: true,
            name: '',
            kind: 'bank',
            alias: '',
            bankName: '',
            cbuCvu: '',
          },
        ],
      }
    })

  const addPoint = () =>
    setState((s) => {
      const used = s.salesPoints.map((p) => Number(/^sp_(\d+)$/.exec(p.id)?.[1] ?? 0))
      const n = (used.length > 0 ? Math.max(...used) : 0) + 1
      return {
        ...s,
        salesPoints: [...s.salesPoints, { id: `sp_${n}`, number: '', label: '', channel: 'salon' }],
      }
    })

  // ─── Pasos ─────────────────────────────────────────────────────────────────
  /** Deja el paso abierto y sigue. Valida con el esquema del servidor; nunca guarda. */
  const goNext = () => {
    if (screen === 0 || screen === REVIEW_SCREEN) return
    setBanner(null)
    const check = checkWizard(state, today, screen === 1 ? 1 : 2)
    if (!check.ok) {
      // Solo los errores del paso que se está dejando: lo que todavía no se vio no salta.
      const mine = errorsOfScreen(check.errors, screen)
      if (Object.keys(mine).length > 0) {
        setErrors(mine)
        return
      }
    }
    setErrors({})
    const done = Math.max(doneUpTo, screen)
    setDoneUpTo(done)
    // Si se había vuelto atrás a cambiar algo, sigue donde había quedado.
    setScreen(Math.min(done + 1, REVIEW_SCREEN) as WizardScreen)
  }

  /** Lleva al paso del primer error, con cada mensaje en su campo. */
  const showErrors = (next: Record<string, string>) => {
    setErrors(next)
    const target = firstErrorScreen(next)
    if (target !== null && !(target === 1 && Object.keys(next).every((f) => f === 'form'))) {
      setScreen(target)
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    // Solo guarda el botón del último paso.
    if (pending || saved || screen !== REVIEW_SCREEN) return
    setBanner(null)
    const check = checkWizard(state, today, 2)
    if (!check.ok) {
      showErrors(check.errors)
      return
    }
    setErrors({})
    const payload = wizardPayload(state)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof bootstrapAccounting>>
      try {
        result = await bootstrapAccounting(tenantSlug, payload.raw)
      } catch {
        setBanner({ tone: 'error', message: ACC_UNREACHABLE.offline })
        return
      }
      if (result.ok) {
        clearDraft()
        toast.success(result.message)
        // La página pasa sola a los saldos iniciales (el paso 6).
        setSaved(true)
        router.refresh()
        return
      }
      const mapped: Record<string, string> = {}
      for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
        const field = wizardFieldKey(path, payload)
        if (!(field in mapped)) mapped[field] = message
      }
      const key = typeof result.detail?.key === 'string' ? result.detail.key : null
      if (Object.keys(mapped).length === 0 && key && SERVER_KEY_FIELDS[key]) {
        mapped[SERVER_KEY_FIELDS[key]] = result.message
      }
      if (key === 'already_set_up') {
        clearDraft()
        setBanner({
          tone: 'info',
          message: 'Otro dueño terminó de configurarla recién.',
          action: { label: 'Ir a Administración', href: base },
        })
        return
      }
      if (Object.keys(mapped).length > 0) {
        showErrors(mapped)
        // Como siempre: en los datos de la SAS cada error va en su campo; en los demás pasos,
        // además, el aviso del servidor queda arriba del botón (no todo error tiene un campo a la vista).
        if (!Object.keys(mapped).some(isStepOneField)) {
          setBanner({ tone: 'error', message: result.message })
        }
        return
      }
      setBanner({ tone: 'error', message: result.message })
    })
  }

  const discardDraft = () => {
    clearDraft()
    setState(initial)
    setErrors({})
    setRestored(false)
    setDoneUpTo(0)
    setScreen(1)
  }

  // ─── Bienvenida ────────────────────────────────────────────────────────────
  if (screen === 0) {
    return <WizardWelcome haveAtHand={haveAtHand} onStart={() => setScreen(1)} />
  }

  const err = (field: string) => errors[field] ?? null
  const stateOf = (n: WizardScreen): StepState =>
    n === screen ? 'current' : n <= doneUpTo ? 'done' : 'todo'
  const summaries: Record<number, string> = {
    1: sasSummary(state),
    2: cajasSummary(state),
    3: cobrosSummary(state),
    4: puntosSummary(state),
  }
  const locked = pending || saved
  const change = (n: WizardScreen) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-11 px-3 md:h-9"
      disabled={locked}
      onClick={() => {
        setBanner(null)
        setScreen(n)
      }}
    >
      Cambiar
      <span className="sr-only"> {WIZARD_QUESTIONS[n]}</span>
    </Button>
  )
  const next = (n: 1 | 2 | 3 | 4) => (
    <>
      {/* El aviso del servidor al guardar, cuando el error cae en este paso (del 2 al 4). */}
      {banner && banner.tone === 'error' && n !== 1 ? (
        <Callout tone="error" className="mt-5">
          {banner.message}
        </Callout>
      ) : null}
      <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        {n === 4 ? (
          <button
            type="button"
            className={TEXT_LINK}
            onClick={() => {
              // Sin renglones no viaja ningún punto de venta: se sigue al resumen.
              setState((s) => ({ ...s, salesPoints: [] }))
              setErrors({})
              setBanner(null)
              setDoneUpTo((d) => Math.max(d, 4))
              setScreen(REVIEW_SCREEN)
            }}
          >
            Todavía no facturamos: seguir sin cargar ninguno
          </button>
        ) : (
          <span />
        )}
        {/* `type="button"`: «Seguir» nunca envía el formulario. */}
        <Button type="button" className="h-12 gap-2 px-6 text-base" onClick={goNext}>
          {WIZARD_NEXT_LABEL[n]}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <SetupRail
        current={screen}
        doneUpTo={doneUpTo}
        summaries={summaries}
        className="lg:sticky lg:top-20"
      />
      <div className="min-w-0 space-y-4">
        {restored ? (
          <Callout
            tone="info"
            action={
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={discardDraft}
              >
                Descartar
              </Button>
            }
          >
            Recuperamos lo que estabas cargando.
          </Callout>
        ) : null}
        <form
          ref={formRef}
          onSubmit={save}
          // La puesta en marcha se guarda con el botón del último paso, nunca con un Enter
          // suelto en un campo: vale para los cinco pasos.
          onKeyDown={(event) => {
            const el = event.target
            if (
              el instanceof HTMLInputElement &&
              isImplicitSubmit(event.key, el.tagName, el.type)
            ) {
              event.preventDefault()
            }
          }}
          noValidate
          className="space-y-3"
        >
          <StepCard
            id="paso-1"
            n={1}
            title={WIZARD_QUESTIONS[1]}
            state={stateOf(1)}
            summary={summaries[1]}
            action={stateOf(1) === 'done' ? change(1) : undefined}
            keepMounted={false}
          >
            <StepSas
              state={state}
              errors={errors}
              today={today}
              update={update}
              setState={setState}
              setErrors={setErrors}
              clearError={clearError}
            />
            {err('form') ? (
              <Callout tone="error" className="mt-5">
                {err('form')}
              </Callout>
            ) : null}
            {next(1)}
          </StepCard>

          <StepCard
            id="paso-2"
            n={2}
            title={WIZARD_QUESTIONS[2]}
            state={stateOf(2)}
            summary={summaries[2]}
            action={stateOf(2) === 'done' ? change(2) : undefined}
            keepMounted={false}
          >
            <StepCajas
              state={state}
              errors={errors}
              updateTreasury={updateTreasury}
              removeTreasury={removeTreasury}
              addTreasury={addTreasury}
              clearError={clearError}
            />
            {next(2)}
          </StepCard>

          <StepCard
            id="paso-3"
            n={3}
            title={WIZARD_QUESTIONS[3]}
            state={stateOf(3)}
            summary={summaries[3]}
            action={stateOf(3) === 'done' ? change(3) : undefined}
            keepMounted={false}
          >
            <StepCobros
              state={state}
              errors={errors}
              proposed={initial.rates}
              setState={setState}
              update={update}
              clearError={clearError}
            />
            {next(3)}
          </StepCard>

          <StepCard
            id="paso-4"
            n={4}
            title={WIZARD_QUESTIONS[4]}
            state={stateOf(4)}
            summary={summaries[4]}
            action={stateOf(4) === 'done' ? change(4) : undefined}
            keepMounted={false}
          >
            <StepPuntos
              state={state}
              errors={errors}
              updatePoint={updatePoint}
              removePoint={removePoint}
              addPoint={addPoint}
              clearError={clearError}
            />
            {next(4)}
          </StepCard>

          <StepCard
            id="paso-5"
            n={5}
            title={WIZARD_QUESTIONS[5]}
            state={stateOf(5)}
            keepMounted={false}
          >
            <StepReview
              state={state}
              pending={pending}
              saved={saved}
              banner={banner}
              formError={err('form')}
              continueHref={`${base}/configurar`}
            />
          </StepCard>
        </form>
      </div>
    </div>
  )
}
