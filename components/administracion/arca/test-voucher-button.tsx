'use client'

import { CircleCheck, FlaskConical, Printer } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { describedBy, Field, GroupLabel } from '@/components/administracion/cajas-ventas/field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ACC_UNREACHABLE, type AccFailureState } from '@/lib/accounting/action-state'
import { emitArcaTestVoucher } from '@/lib/arca/emit-actions'
import {
  ARCA_TEST_KIND_LABELS,
  type ArcaTestKind,
  type ArcaTestVoucherResult,
  arcaPrintHref,
} from '@/lib/arca/emit-form'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit, parseCuit } from '@/lib/fiscal'
import { ArcaProblem } from './arca-problem'

const KIND_OPTIONS: ChoiceChip<ArcaTestKind>[] = [
  { value: 'factura_b', label: ARCA_TEST_KIND_LABELS.factura_b },
  { value: 'factura_a', label: ARCA_TEST_KIND_LABELS.factura_a },
  { value: 'nota_credito_b', label: ARCA_TEST_KIND_LABELS.nota_credito_b },
]

const KIND_HINT: Readonly<Record<ArcaTestKind, string>> = {
  factura_b: 'La más común: una venta a alguien que no pide factura con sus datos.',
  factura_a: 'Para probar una venta a una empresa: poné la CUIT de un cliente de prueba.',
  nota_credito_b: 'Anula la última Factura B de prueba (primero emití una).',
}

/**
 * «Emitir una factura de prueba» (diseño §3.2.8, contrato C3): solo en
 * homologación, el ARCA de pruebas. Pide el CAE (el código con el que ARCA
 * autoriza una factura) de una Factura B a consumidor final por $ 121 (o una A, o
 * una nota de crédito B), muestra el resultado y nunca toca los libros. Sirve para
 * confirmar, antes de facturar de verdad, que la plataforma puede emitir.
 */
export function ArcaTestVoucherButton({
  slug,
  disabled = false,
}: {
  slug: string
  disabled?: boolean
}) {
  const router = useRouter()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ArcaTestKind>('factura_b')
  const [cuit, setCuit] = useState('')
  const [cuitError, setCuitError] = useState<string | null>(null)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const [result, setResult] = useState<ArcaTestVoucherResult | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setFailure(null)
    setResult(null)
    setCuitError(null)
  }

  function emit() {
    reset()
    let receiverCuit: string | null = null
    if (kind === 'factura_a') {
      const parsed = parseCuit(cuit)
      if (!parsed.ok) {
        setCuitError('Poné una CUIT válida (11 números) de un cliente responsable inscripto.')
        return
      }
      receiverCuit = parsed.cuit
    }
    start(async () => {
      try {
        const res = await emitArcaTestVoucher(slug, { kind, receiverCuit })
        if (res.ok) {
          setResult(res.data)
          toast.success(res.message)
          router.refresh()
          return
        }
        if (res.fieldErrors?.receiverCuit) setCuitError(res.fieldErrors.receiverCuit)
        setFailure(res)
      } catch {
        setFailure({ ok: false, code: 'error', message: ACC_UNREACHABLE.offline })
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 sm:w-auto md:h-9"
        disabled={disabled}
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <FlaskConical className="size-4" aria-hidden />
        Emitir una factura de prueba
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next)
        }}
      >
        <DialogContent
          className="max-h-[88vh] overflow-y-auto sm:max-w-lg"
          showCloseButton={!pending}
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-pretty">Factura de prueba</DialogTitle>
            <DialogDescription className="text-pretty">
              Se emite en el ARCA de pruebas (homologación): no tiene validez fiscal y nunca va a
              los libros. Sirve para confirmar que la plataforma ya puede pedir el CAE, el código
              con el que ARCA autoriza cada factura.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <TestResult slug={slug} result={result} />
          ) : (
            <form
              noValidate
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                emit()
              }}
            >
              <div className="grid gap-2">
                <GroupLabel id={`${id}-kind`}>¿Qué querés probar?</GroupLabel>
                <ChoiceChips<ArcaTestKind>
                  labelledBy={`${id}-kind`}
                  value={kind}
                  onChange={(next) => {
                    setKind(next)
                    reset()
                  }}
                  options={KIND_OPTIONS}
                />
                <p className="text-xs text-muted-foreground text-pretty">{KIND_HINT[kind]}</p>
              </div>

              {kind === 'factura_a' ? (
                <Field
                  id={`${id}-cuit`}
                  label="CUIT del cliente de prueba"
                  required
                  error={cuitError}
                  hint="En homologación ARCA usa su propio padrón de prueba: si la rechaza, probá con otra."
                >
                  <Input
                    id={`${id}-cuit`}
                    value={cuit}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="20-12345678-6"
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                    aria-invalid={cuitError ? true : undefined}
                    aria-describedby={describedBy(`${id}-cuit`, { hint: true, error: cuitError })}
                    onChange={(event) => {
                      setCuit(event.target.value)
                      setCuitError(null)
                    }}
                    onBlur={() => {
                      const parsed = parseCuit(cuit)
                      if (parsed.ok) setCuit(formatCuit(parsed.cuit))
                    }}
                  />
                </Field>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-secondary/30 p-4 text-sm">
                <dt className="text-muted-foreground">Neto</dt>
                <dd className="text-right tabular-nums">$ 100,00</dd>
                <dt className="text-muted-foreground">IVA 21 %</dt>
                <dd className="text-right tabular-nums">$ 21,00</dd>
                <dt className="font-medium">Total</dt>
                <dd className="text-right font-medium tabular-nums">$ 121,00</dd>
                <dt className="text-muted-foreground">Fecha</dt>
                <dd className="text-right">Hoy</dd>
              </dl>

              <div aria-live="polite" className="min-h-0">
                {pending ? (
                  <p className="text-sm text-muted-foreground">Pidiendo el CAE a ARCA…</p>
                ) : null}
              </div>
              {failure ? <ArcaProblem slug={slug} state={failure} /> : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 md:h-9"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="h-11 min-w-[180px] md:h-9" disabled={pending}>
                  {pending ? 'Pidiendo el CAE…' : 'Emitir la prueba'}
                </Button>
              </DialogFooter>
            </form>
          )}

          {result ? (
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="h-11 md:h-9"
                onClick={() => {
                  reset()
                }}
              >
                Emitir otra
              </Button>
              <Button type="button" className="h-11 md:h-9" onClick={() => setOpen(false)}>
                Listo
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function TestResult({ slug, result }: { slug: string; result: ArcaTestVoucherResult }) {
  return (
    <div role="status" className="grid gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 space-y-1 text-pretty">
          <p className="font-medium">ARCA autorizó la {result.label} de prueba.</p>
          <p className="text-muted-foreground">
            La plataforma ya puede emitir: el certificado, el punto de venta y la numeración andan.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">CAE</dt>
        <dd className="break-all font-mono tabular-nums">{result.cae}</dd>
        <dt className="text-muted-foreground">Vence el CAE</dt>
        <dd className="tabular-nums">{formatIsoDay(result.caeDue)}</dd>
        <dt className="text-muted-foreground">Número</dt>
        <dd className="tabular-nums">{result.label}</dd>
      </dl>
      {result.observations.length > 0 ? (
        <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <p className="font-medium">ARCA agregó estos avisos (no frenan la factura):</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {result.observations.map((o) => (
              <li key={o} className="text-pretty">
                {o}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-fit md:h-9">
        <Link href={arcaPrintHref(slug, result.voucherId)} target="_blank" rel="noopener">
          <Printer className="size-4" aria-hidden />
          Ver cómo sale impresa
        </Link>
      </Button>
    </div>
  )
}
