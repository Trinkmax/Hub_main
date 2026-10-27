'use client'

import { CalendarPlus, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createExperience } from '@/lib/ticketing/actions'
import { cn } from '@/lib/utils'
import { parsePesosInput, pesosToInput } from '../_lib/experience-form'
import { PesosField } from './pesos-field'

export type TemplateOption = { id: string; name: string; color: string }

type Props = {
  tenantSlug: string
  /** Formatos del calendario que todavía no tienen página. */
  templates: TemplateOption[]
  /** Precios (en pesos) de la última película: la próxima arranca igual. */
  defaults: { price: number; deposit: number } | null
  className?: string
}

/** «Agregar película»: abre el alta. Remonta el diálogo en cada apertura para que arranque limpio. */
export function NewExperienceButton({ className, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)
  return (
    <>
      <Button
        type="button"
        className={cn('h-11 sm:h-9', className)}
        onClick={() => {
          setSession((n) => n + 1)
          setOpen(true)
        }}
      >
        <Plus className="size-4" aria-hidden />
        Agregar película
      </Button>
      <NewExperienceDialog key={session} {...props} open={open} onOpenChange={setOpen} />
    </>
  )
}

type Errors = { template?: string; price?: string; deposit?: string }

function NewExperienceDialog({
  tenantSlug,
  templates,
  defaults,
  open,
  onOpenChange,
}: Omit<Props, 'className'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState(
    templates.length === 1 ? (templates[0]?.id ?? '') : '',
  )
  const [price, setPrice] = useState(defaults ? pesosToInput(defaults.price) : '')
  const [deposit, setDeposit] = useState(defaults ? pesosToInput(defaults.deposit) : '')
  const [errors, setErrors] = useState<Errors>({})
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const priceValue = parsePesosInput(price)
    // Vacía = sin seña (solo se vende el total).
    const depositValue = deposit.trim() === '' ? 0 : parsePesosInput(deposit)
    const next: Errors = {}
    if (!templateId) next.template = 'Elegí el formato del calendario.'
    if (priceValue === null || priceValue < 1) next.price = 'Poné el precio por persona.'
    if (depositValue === null) {
      next.deposit = 'Escribí la seña en pesos (o dejala vacía si no hay seña).'
    } else if (priceValue !== null && depositValue > 0 && depositValue >= priceValue) {
      next.deposit = 'La seña tiene que ser menor que el precio.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || priceValue === null || depositValue === null) return

    startTransition(async () => {
      const result = await createExperience(tenantSlug, {
        template_id: templateId,
        price: priceValue,
        deposit: depositValue,
      })
      const id = result.ok && typeof result.data?.id === 'string' ? result.data.id : null
      if (result.ok && id) {
        toast.success('Página creada. Completala y publicala cuando esté lista.')
        onOpenChange(false)
        router.push(`/${tenantSlug}/entradas/${id}`)
        return
      }
      if (!result.ok) {
        if (result.field === 'price' || result.field === 'deposit') {
          setErrors({ [result.field]: result.message })
        }
        toast.error(result.message)
      }
    })
  }

  const noTemplates = templates.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Agregar película</DialogTitle>
          <DialogDescription>
            Elegí el formato del calendario y los precios por persona. Los textos, el afiche y el
            menú los completás en la pantalla siguiente.
          </DialogDescription>
        </DialogHeader>

        {noTemplates ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-dashed border-border/80 bg-card/50 p-4 text-sm text-muted-foreground text-pretty">
              Todos los formatos activos del calendario ya tienen su página. Para sumar otra
              película, primero creala como formato en Calendario → Formatos y programá sus fechas.
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
              <Button asChild>
                <Link href={`/${tenantSlug}/eventos/programados?tab=eventos`}>
                  <CalendarPlus className="size-4" aria-hidden />
                  Ir a Formatos
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <fieldset
              className="min-w-0"
              aria-describedby={
                errors.template ? 'new-exp-template-error' : 'new-exp-template-hint'
              }
            >
              <legend className="mb-2 flex items-center gap-1 text-sm font-medium">
                Formato del calendario
                <span aria-hidden className="text-destructive">
                  *
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <label key={template.id} className="cursor-pointer">
                    <input
                      type="radio"
                      name="template_id"
                      value={template.id}
                      checked={templateId === template.id}
                      onChange={() => {
                        setTemplateId(template.id)
                        setErrors((current) => ({ ...current, template: undefined }))
                      }}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                        'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                        'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                        'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                        style={{ backgroundColor: template.color }}
                      />
                      {template.name}
                    </span>
                  </label>
                ))}
              </div>
              {errors.template ? (
                <p
                  id="new-exp-template-error"
                  role="alert"
                  className="mt-2 text-xs text-destructive"
                >
                  {errors.template}
                </p>
              ) : (
                <p id="new-exp-template-hint" className="mt-2 text-xs text-muted-foreground">
                  Las fechas a la venta son las que tenga ese formato en el Calendario. ¿No está?{' '}
                  <Link
                    href={`/${tenantSlug}/eventos/programados?tab=eventos`}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Crealo en Formatos
                  </Link>
                  .
                </p>
              )}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <PesosField
                id="new-exp-price"
                label="Precio por persona"
                required
                value={price}
                onChange={(value) => {
                  setPrice(value)
                  setErrors((current) => ({ ...current, price: undefined }))
                }}
                placeholder="35.000"
                hint="Lo que paga cada persona si paga todo online."
                error={errors.price}
              />
              <PesosField
                id="new-exp-deposit"
                label="Seña por persona"
                value={deposit}
                onChange={(value) => {
                  setDeposit(value)
                  setErrors((current) => ({ ...current, deposit: undefined }))
                }}
                placeholder="5.000"
                hint="El resto se paga en efectivo en el bar. Vacía o 0: solo pago total."
                error={errors.deposit}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="h-11 sm:h-9"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" className="h-11 sm:h-9" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? 'Creando…' : 'Crear y completar la página'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
