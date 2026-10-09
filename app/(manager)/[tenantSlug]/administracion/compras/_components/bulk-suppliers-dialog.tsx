'use client'

import { ListPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useMemo, useState, useTransition } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { createPartiesBulk } from '@/lib/accounting/actions/master'
import { parseNameList } from '../_lib/bulk'

/**
 * «Cargar una lista» de proveedores (pedido de los socios, 09/10/2026): se
 * pega un nombre por renglón (una columna de una planilla, un mensaje) y se
 * cargan todos de una. Los que ya están no se repiten. El resto de la ficha
 * (CUIT, contactos, días de entrega) se completa después en cada uno.
 */
export function BulkSuppliersDialog({
  tenantSlug,
  existingNames,
  className,
}: {
  tenantSlug: string
  existingNames: readonly string[]
  className?: string
}) {
  const router = useRouter()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const parsed = useMemo(
    () => parseNameList(text, { existing: existingNames }),
    [text, existingNames],
  )

  const submit = () => {
    setError(null)
    if (parsed.names.length === 0) {
      setError(
        parsed.existing.length > 0
          ? 'Todos los de la lista ya están cargados.'
          : 'Pegá al menos un nombre, uno por renglón.',
      )
      return
    }
    start(async () => {
      try {
        const result = await createPartiesBulk(tenantSlug, {
          kind: 'supplier',
          names: parsed.names,
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        toast.success(result.message)
        setOpen(false)
        setText('')
        router.refresh()
      } catch {
        setError(ACC_UNREACHABLE.offline)
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={className ?? 'h-11 gap-2 md:h-9'}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <ListPlus className="size-4" aria-hidden />
        Cargar una lista
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cargar una lista de proveedores</DialogTitle>
            <DialogDescription>
              Pegá los nombres, uno por renglón. Después completás el CUIT, los contactos y los días
              de entrega de cada uno.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-names`}>Proveedores</Label>
            <Textarea
              id={`${uid}-names`}
              value={text}
              rows={10}
              placeholder={'Coca Cola\nQuilmes\nLa Virginia'}
              aria-describedby={`${uid}-summary`}
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              className="text-base md:text-sm"
            />
            <p id={`${uid}-summary`} aria-live="polite" className="text-xs text-muted-foreground">
              {summary(parsed)}
            </p>
            {parsed.invalid.length > 0 ? (
              <p className="text-xs text-warning-text">
                No se cargan (muy cortos o muy largos): {parsed.invalid.join(', ')}.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 min-w-[160px] md:h-9"
              disabled={pending || parsed.names.length === 0}
              onClick={submit}
            >
              {pending
                ? 'Cargando…'
                : parsed.names.length === 1
                  ? 'Cargar 1 proveedor'
                  : `Cargar ${parsed.names.length} proveedores`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function summary(parsed: ReturnType<typeof parseNameList>): string {
  if (parsed.names.length === 0 && parsed.existing.length === 0) return 'Un nombre por renglón.'
  const parts = [
    parsed.names.length === 1 ? '1 nuevo' : `${parsed.names.length} nuevos`,
    parsed.existing.length > 0
      ? `${parsed.existing.length} ya ${parsed.existing.length === 1 ? 'estaba' : 'estaban'} (no se repiten)`
      : null,
    parsed.repeated.length > 0
      ? `${parsed.repeated.length} ${parsed.repeated.length === 1 ? 'repetido' : 'repetidos'} en la lista`
      : null,
  ]
  return `${parts.filter(Boolean).join(' · ')}.`
}
