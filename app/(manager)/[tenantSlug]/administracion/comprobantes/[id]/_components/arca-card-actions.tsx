'use client'

import { BookPlus, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PostVoucherDialog } from '@/components/administracion/arca/post-voucher-dialog'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { reconcileArcaVoucher } from '@/lib/arca/emit-actions'

/** «Verificar con ARCA» de un comprobante en verificación (diseño §3.2.5). */
export function ArcaReconcileButton({ slug, voucherId }: { slug: string; voucherId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [status, setStatus] = useState('')
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 sm:w-auto md:h-9"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const res = await reconcileArcaVoucher(slug, { voucherId })
              setStatus(res.message)
              if (!res.ok) {
                toast.error(res.message)
                return
              }
              if (res.data.status === 'needs_reconcile' || res.data.status === 'requesting') {
                toast.info(res.message)
              } else {
                toast.success(res.message)
                router.refresh()
              }
            } catch {
              toast.error(ACC_UNREACHABLE.offline)
            }
          })
        }
      >
        <RefreshCw
          className={pending ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
          aria-hidden
        />
        {pending ? 'Verificando…' : 'Verificar con ARCA'}
      </Button>
      <span aria-live="polite" className="sr-only">
        {status}
      </span>
    </>
  )
}

/** «Cargarla ahora» (o vincularla, si el asiento ya está) de una autorizada sin asiento. */
export function ArcaPostButton({
  slug,
  voucherId,
  label,
}: {
  slug: string
  voucherId: string
  label: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        className="h-11 w-full gap-2 sm:w-auto md:h-9"
        onClick={() => setOpen(true)}
      >
        <BookPlus className="size-4" aria-hidden />
        Cargarla ahora
      </Button>
      <PostVoucherDialog
        slug={slug}
        voucherId={voucherId}
        label={label}
        open={open}
        onOpenChange={setOpen}
        onPosted={() => router.refresh()}
      />
    </>
  )
}

/** «Reintentar» de un bloque que no cargó (vuelve a pedir la página). */
export function RefreshButton({ label = 'Reintentar' }: { label?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-11 md:h-8"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {label}
    </Button>
  )
}
