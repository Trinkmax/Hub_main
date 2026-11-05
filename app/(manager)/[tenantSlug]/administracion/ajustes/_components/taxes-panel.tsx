'use client'

import { type KeyboardEvent, useRef, useState } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  CELL_INPUT,
  Planilla,
  PlanillaBar,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
} from '@/components/administracion/planilla'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ACC_UNREACHABLE, type AccSimpleState } from '@/lib/accounting/action-state'
import { saveTaxSettings } from '@/lib/accounting/actions/taxes'
import { bpLabel, type TaxSettings } from '@/lib/accounting/taxes'
import { cn } from '@/lib/utils'
import {
  IVA_NOTE,
  IVA_RATE_BP,
  isTaxBase,
  municipalNote,
  percentCellText,
  readPercentCell,
  TAX_BASE_LABELS,
  TAX_BASE_OPTIONS,
  TAX_ROWS,
  type TaxField,
} from '../_lib/taxes-view'
import { useMasterAction } from './use-master-action'

type CellTexts = Record<TaxField, string>

function textsOf(settings: TaxSettings): CellTexts {
  return {
    iibbBp: percentCellText(settings.iibbBp),
    municipalBp: percentCellText(settings.municipalBp),
    bankTaxBp: percentCellText(settings.bankTaxBp),
  }
}

/** Las celdas en el orden de la tabla: Enter baja a la de abajo. */
const CELL_ORDER = TAX_ROWS.flatMap((row) => (row.field ? [row.field] : []))

/**
 * Ajustes › Impuestos: con qué porcentajes se calculan solos Ingresos Brutos y Comercio e Industria
 * (adentro de cada cierre del día) y el impuesto al cheque (en cada pago con banco o billetera).
 *
 * Una planilla: se escribe en la celda y se guarda al salir de ella; Enter baja a la de abajo. «Sobre
 * qué» es un único dato para los dos impuestos del cierre: cambiarlo en uno cambia el otro. La
 * contadora lee lo mismo sin ningún control (la base tampoco la deja guardar).
 */
export function TaxesPanel({
  tenantSlug,
  settings,
  readOnly,
}: {
  tenantSlug: string
  settings: TaxSettings
  readOnly: boolean
}) {
  const { run } = useMasterAction()
  // Lo que se ve: cambia al toque y vuelve a lo último guardado si la base no lo acepta.
  const [current, setCurrent] = useState(settings)
  const [texts, setTexts] = useState<CellTexts>(() => textsOf(settings))
  const [cellErrors, setCellErrors] = useState<Partial<Record<TaxField, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const lastGood = useRef(settings)
  const cells = useRef<Partial<Record<TaxField, HTMLInputElement | null>>>({})
  // De a un guardado por vez: el segundo espera al primero y lleva todo lo escrito hasta ahí. Sin
  // esto, dos que se cruzan en el camino podían dejar guardado el más viejo.
  const sending = useRef(false)
  const queued = useRef<TaxSettings | null>(null)

  const send = (next: TaxSettings) => {
    sending.current = true
    const settle = () => {
      sending.current = false
      const waiting = queued.current
      queued.current = null
      if (waiting) send(waiting)
    }
    run(
      async (): Promise<AccSimpleState<TaxSettings>> => {
        try {
          return await saveTaxSettings(tenantSlug, next)
        } catch {
          return { ok: false, code: 'error', message: ACC_UNREACHABLE.offline }
        }
      },
      {
        quiet: true,
        onSuccess: (data) => {
          lastGood.current = data
          if (!queued.current) setStatus('saved')
          settle()
        },
        onFailure: (state) => {
          queued.current = null
          setCurrent(lastGood.current)
          setTexts(textsOf(lastGood.current))
          setSaveError(state.message)
          setStatus('idle')
          settle()
        },
      },
    )
  }

  const commit = (next: TaxSettings) => {
    setCurrent(next)
    setSaveError(null)
    setStatus('saving')
    if (sending.current) queued.current = next
    else send(next)
  }

  const leaveCell = (field: TaxField, text: string) => {
    const read = readPercentCell(text, current[field])
    if (read.kind === 'invalid') {
      setCellErrors((errors) => ({ ...errors, [field]: read.message }))
      return
    }
    setCellErrors(({ [field]: _gone, ...rest }) => rest)
    const bp = read.kind === 'changed' ? read.bp : current[field]
    setTexts((before) => ({ ...before, [field]: percentCellText(bp) }))
    if (read.kind === 'changed') commit({ ...current, [field]: bp })
  }

  const onCellKey = (event: KeyboardEvent<HTMLInputElement>, field: TaxField) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const next = CELL_ORDER[CELL_ORDER.indexOf(field) + 1]
    const below = next ? cells.current[next] : null
    if (below) below.focus()
    else event.currentTarget.blur()
  }

  const note = municipalNote(current, { readOnly })
  const errors = [...new Set(Object.values(cellErrors))]

  return (
    <div className="grid gap-3.5">
      <PlanillaBar className="justify-between">
        {readOnly ? (
          <StatusPill tone={current.auto ? 'ok' : 'muted'}>
            {current.auto ? 'Se calculan solos' : 'No se calculan solos'}
          </StatusPill>
        ) : (
          <div className="flex min-h-11 items-center gap-2.5 sm:min-h-0">
            <Switch
              id="aj-impuestos-auto"
              checked={current.auto}
              onCheckedChange={(auto) => commit({ ...current, auto })}
            />
            <Label htmlFor="aj-impuestos-auto" className="text-sm font-medium">
              Calcular solos
            </Label>
          </div>
        )}
        {readOnly ? null : (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {status === 'saving' ? 'Guardando…' : status === 'saved' ? 'Guardado.' : ''}
          </p>
        )}
      </PlanillaBar>

      <Planilla>
        <PTable label="Los impuestos y cómo se calculan" minWidth={640}>
          <thead>
            <tr>
              <PTh>Impuesto</PTh>
              <PTh align="right">%</PTh>
              <PTh>Sobre qué</PTh>
              <PTh>Cuándo se calcula</PTh>
            </tr>
          </thead>
          <tbody>
            {TAX_ROWS.map((row) => {
              const field = row.field
              const invalid = field ? cellErrors[field] !== undefined : false
              return (
                <PRow key={row.key}>
                  <PTd>
                    <span className="font-medium">{row.name}</span>
                    {row.key === 'iva' ? (
                      <span className="block text-xs text-muted-foreground text-pretty">
                        {IVA_NOTE}
                      </span>
                    ) : null}
                  </PTd>
                  <PTd align="right">
                    {field === null ? (
                      bpLabel(IVA_RATE_BP)
                    ) : readOnly ? (
                      bpLabel(current[field])
                    ) : (
                      <>
                        <input
                          ref={(node) => {
                            cells.current[field] = node
                          }}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Porcentaje de ${row.name}`}
                          aria-invalid={invalid ? true : undefined}
                          value={texts[field]}
                          onChange={(event) => {
                            const text = event.target.value
                            setTexts((before) => ({ ...before, [field]: text }))
                          }}
                          onBlur={(event) => leaveCell(field, event.currentTarget.value)}
                          onKeyDown={(event) => onCellKey(event, field)}
                          onFocus={(event) => event.currentTarget.select()}
                          className={cn(
                            CELL_INPUT,
                            'w-16 max-sm:h-10',
                            invalid && 'border-b-destructive text-destructive',
                          )}
                        />
                        <span aria-hidden className="ml-1 text-muted-foreground">
                          %
                        </span>
                      </>
                    )}
                  </PTd>
                  <PTd className="text-muted-foreground">
                    {row.over !== null ? (
                      row.over
                    ) : readOnly ? (
                      TAX_BASE_LABELS[current.base]
                    ) : (
                      <Select
                        value={current.base}
                        onValueChange={(value) => {
                          if (isTaxBase(value) && value !== current.base) {
                            commit({ ...current, base: value })
                          }
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Sobre qué se calcula ${row.name}`}
                          className="max-sm:h-10"
                        >
                          <SelectValue>{TAX_BASE_LABELS[current.base]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TAX_BASE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </PTd>
                  <PTd className="text-muted-foreground">
                    {row.automatic && !current.auto ? 'Apagado' : row.when}
                  </PTd>
                </PRow>
              )
            })}
          </tbody>
        </PTable>
        {note || errors.length > 0 || saveError ? (
          <PlanillaFoot className="block space-y-1">
            {errors.map((message) => (
              <p key={message} role="alert" className="text-xs text-destructive">
                {message}
              </p>
            ))}
            {saveError ? (
              <p role="alert" className="text-xs text-destructive">
                {saveError}
              </p>
            ) : null}
            {note ? <p className="text-xs text-muted-foreground text-pretty">{note}</p> : null}
          </PlanillaFoot>
        ) : null}
      </Planilla>
    </div>
  )
}
