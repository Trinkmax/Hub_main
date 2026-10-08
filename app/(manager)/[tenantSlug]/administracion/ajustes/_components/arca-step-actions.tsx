'use client'

import { Check, Save, TriangleAlert, Undo2 } from 'lucide-react'
import { useId, useState } from 'react'
import {
  ARCA_CLASS_CHOICES,
  type ArcaClassChoice,
  allowedClassesFor,
  classChoiceFor,
  type GuideStepStatus,
} from '@/components/administracion/guias/arca-guide-model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { markGuideStep, saveArcaPointOfSale, saveArcaSettings } from '@/lib/arca/actions'
import type { ArcaEnvironment } from '@/lib/arca/endpoints'
import type { ArcaGuideStepId } from '@/lib/arca/guide'
import type { ArcaConnectionView, ArcaPointOfSaleResult } from '@/lib/arca/views'
import { padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { ArcaFailureNotice, useArcaRun, useFocusWhen } from './arca-shared'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS } from './inputs'

/** El nombre con que la plataforma da de alta su punto de venta en Ajustes › Puntos de venta. */
const PLATFORM_LABEL = 'Plataforma (ARCA)'

// ─── «Ya lo hice» ────────────────────────────────────────────────────────────

/**
 * «Ya lo hice» de un paso que pasa solo en ARCA (`markGuideStep`). Si la prueba lo volvió a abrir
 * («Revisar»), dice «Ya lo arreglé» y renueva la marca (la base guarda la primera: hay que sacarla
 * y volver a ponerla para que cuente después de la prueba). Un paso marcado a mano se puede
 * desmarcar; uno que la plataforma vio sola, no.
 */
export function ArcaMarkStepButton({
  slug,
  step,
  status,
  source,
  label = 'Ya lo hice',
}: {
  slug: string
  step: ArcaGuideStepId
  status: GuideStepStatus
  source: 'manual' | 'auto' | 'test' | null
  label?: string
}) {
  const { pending, run } = useArcaRun()
  if (status === 'done') {
    if (source !== 'manual') return null
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-11 gap-2 text-muted-foreground md:h-9"
        disabled={pending}
        onClick={() => run(() => markGuideStep(slug, { guide: 'arca', step, done: false }))}
      >
        <Undo2 className="size-4" aria-hidden />
        {pending ? 'Guardando…' : 'Desmarcar'}
      </Button>
    )
  }
  const text = status === 'check' ? 'Ya lo arreglé' : label
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 gap-2 md:h-9"
      disabled={pending}
      onClick={() =>
        run(async () => {
          if (status === 'check') {
            const off = await markGuideStep(slug, { guide: 'arca', step, done: false })
            if (!off.ok) return off
          }
          return markGuideStep(slug, { guide: 'arca', step, done: true })
        })
      }
    >
      <Check className="size-4" aria-hidden />
      {pending ? 'Guardando…' : text}
    </Button>
  )
}

// ─── Paso 2: el punto de venta ───────────────────────────────────────────────

export type SalesPointBrief = { readonly number: number; readonly label: string }

function pointClash(number: number, existing: readonly SalesPointBrief[]): SalesPointBrief | null {
  return existing.find((p) => p.number === number && p.label !== PLATFORM_LABEL) ?? null
}

/**
 * «Qué te traés» del paso 2: el número del punto de venta que creaste en ARCA. En producción,
 * además, queda en Ajustes › Puntos de venta como «Plataforma (ARCA)». Avisa antes de guardar si
 * el número ya es de otro sistema (los puntos de venta que ya están cargados).
 */
export function ArcaPointOfSaleForm({
  slug,
  environment,
  connection,
  existing = [],
  guideHref,
}: {
  slug: string
  environment: ArcaEnvironment
  connection: ArcaConnectionView | null
  /** Los puntos de venta de Ajustes (para avisar si el número ya es de otro sistema). */
  existing?: readonly SalesPointBrief[]
  guideHref?: string
}) {
  const inputId = useId()
  const saved = connection?.pointOfSale ?? null
  const [value, setValue] = useState(saved ? String(saved) : '')
  const [seen, setSeen] = useState(saved)
  if (saved !== seen) {
    setSeen(saved)
    setValue(saved ? String(saved) : '')
  }
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const [result, setResult] = useState<ArcaPointOfSaleResult | null>(null)
  const { pending, run } = useArcaRun()
  const resultRef = useFocusWhen<HTMLDivElement>(result)

  const number = /^\d{1,5}$/.test(value) ? Number(value) : null
  const clash = number !== null ? pointClash(number, existing) : null
  const others = existing.filter((p) => p.label !== PLATFORM_LABEL)
  const hint =
    environment === 'produccion'
      ? 'El número que creaste en ARCA en este paso (por ejemplo, 5).'
      : 'En pruebas sirve cualquier número. Si ARCA no lo acepta, usá el mismo de producción.'

  const save = () => {
    setFailure(null)
    setResult(null)
    if (number === null || number < 1 || number > 99_998) {
      setError('Revisá el punto de venta: va de 1 a 99998.')
      return
    }
    setError(null)
    run(
      () =>
        saveArcaPointOfSale(slug, {
          environment,
          pointOfSale: number,
          expectedUpdatedAt: connection?.updatedAt || null,
        }),
      {
        onSuccess: (data) => setResult(data),
        onFailure: (f) => {
          const field = f.fieldErrors?.pointOfSale
          if (field) setError(field)
          else setFailure(f)
        },
      },
    )
  }

  return (
    <div className="space-y-3">
      {/* El botón se alinea con el campo (alto de la etiqueta: 14 px + 6 de separación), no con
          el pie: la ayuda ocupa dos renglones y con `items-end` el botón quedaba más abajo. */}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field
          id={inputId}
          label="Número del punto de venta"
          hint={hint}
          error={error}
          className="sm:max-w-xs sm:flex-1"
        >
          <Input
            id={inputId}
            value={value}
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            placeholder="5"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(inputId, hint, error)}
            onChange={(event) => {
              setValue(event.target.value.replace(/\D/g, ''))
              setError(null)
            }}
            className={cn(INPUT_CLASS, 'tabular-nums')}
          />
        </Field>
        <Button type="submit" className="h-11 gap-2 sm:mt-5 md:h-10" disabled={pending}>
          <Save className="size-4" aria-hidden />
          {pending ? 'Guardando…' : saved ? 'Guardar el cambio' : 'Guardar'}
        </Button>
      </form>

      {saved ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Guardado
          </Badge>
          El punto de venta de la plataforma es el{' '}
          <span className="font-medium tabular-nums text-foreground">{padPv(saved, 4)}</span>.
        </p>
      ) : null}

      {environment === 'produccion' && others.length > 0 ? (
        <p className="text-xs text-muted-foreground text-pretty">
          Ya tenés cargados en Ajustes › Puntos de venta:{' '}
          {others.map((p, i) => (
            <span key={p.number}>
              {i > 0 ? ' · ' : ''}
              <span className="font-medium tabular-nums text-foreground">{padPv(p.number, 4)}</span>{' '}
              {p.label}
            </span>
          ))}
          . No uses esos números.
        </p>
      ) : null}

      {clash ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="text-pretty">
            El {padPv(clash.number, 4)} ya está cargado como «{clash.label}». Si es del sistema de
            caja que usás hoy, creá otro en ARCA: la plataforma necesita uno propio para no chocar
            la numeración.
          </span>
        </p>
      ) : null}

      <div aria-live="polite">
        {result ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="space-y-1.5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm outline-none"
          >
            <p className="font-medium text-success">
              Listo: guardamos el punto de venta{' '}
              {result.connection?.pointOfSale ? padPv(result.connection.pointOfSale, 4) : ''}.
            </p>
            {result.salesPoint?.status === 'created' ? (
              <p className="text-muted-foreground text-pretty">
                Lo sumamos a Ajustes › Puntos de venta como «{PLATFORM_LABEL}», canal Eventos, para
                que aparezca al cargar ventas.
              </p>
            ) : null}
            {result.salesPoint?.status === 'failed' ? (
              <p className="text-muted-foreground text-pretty">
                No pudimos sumarlo a Ajustes › Puntos de venta: cargalo a mano ahí, con el canal
                Eventos.
              </p>
            ) : null}
            {result.warnings.map((w) => (
              <p key={w} className="text-warning-text text-pretty">
                {w}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <ArcaFailureNotice failure={failure} slug={slug} guideHref={guideHref} />
    </div>
  )
}

// ─── Paso 3: qué Factura A autorizó ARCA ─────────────────────────────────────

/** «¿Qué Factura A te autorizó ARCA?»: cambia las letras que ofrece la emisión. */
export function ArcaClassesSelect({
  slug,
  environment,
  connection,
  readOnly = false,
}: {
  slug: string
  environment: ArcaEnvironment
  connection: ArcaConnectionView | null
  readOnly?: boolean
}) {
  const id = useId()
  const current = classChoiceFor(connection?.allowedClasses)
  const [value, setValue] = useState<ArcaClassChoice>(current)
  // Lo guardado cambió (otra persona, o la pantalla se recargó): se muestra lo de la base.
  const [seen, setSeen] = useState(current)
  if (current !== seen) {
    setSeen(current)
    setValue(current)
  }
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const { pending, run } = useArcaRun()
  const chosen = ARCA_CLASS_CHOICES.find((c) => c.value === value) ?? ARCA_CLASS_CHOICES[0]

  if (readOnly) {
    return (
      <div className="grid gap-0.5">
        <p className="text-xs text-muted-foreground">Factura A autorizada por ARCA</p>
        {/* «Todavía no tengo Factura A» habla en primera persona: sirve para quien elige, no
            para la contadora que lo lee. */}
        <p className="text-sm">
          {value === 'none' ? 'Ninguna todavía: solo Factura B.' : chosen?.label}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Field id={id} label="¿Qué Factura A te autorizó ARCA?" hint={chosen?.hint}>
        <Select
          value={value}
          disabled={pending}
          onValueChange={(next) => {
            const choice = next as ArcaClassChoice
            setValue(choice)
            setFailure(null)
            run(
              () =>
                saveArcaSettings(slug, {
                  environment,
                  allowedClasses: allowedClassesFor(choice),
                  expectedUpdatedAt: connection?.updatedAt || null,
                }),
              {
                onFailure: (f) => {
                  setValue(current)
                  setFailure(f)
                },
              },
            )
          }}
        >
          <SelectTrigger
            id={id}
            aria-describedby={`${id}-hint`}
            className="w-full data-[size=default]:h-11 sm:max-w-md md:data-[size=default]:h-10"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ARCA_CLASS_CHOICES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <ArcaFailureNotice failure={failure} slug={slug} />
    </div>
  )
}
