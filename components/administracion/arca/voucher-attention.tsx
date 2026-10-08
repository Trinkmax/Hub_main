'use client'

import { BookPlus, Printer, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { reconcileArcaVoucher } from '@/lib/arca/emit-actions'
import { type ArcaAttentionVoucher, arcaPrintHref } from '@/lib/arca/emit-form'
import { formatCents } from '@/lib/money'
import { PostVoucherDialog } from './post-voucher-dialog'

/** Un «no existe» recién cuenta pasado este rato (`RECONCILE_SAFE_AFTER_MS` del servidor). */
const AUTO_VERIFY_AFTER_MS = 95_000
/** Uno que quedó pidiendo el CAE se verifica pasado este rato (`STALE_REQUESTING_MS`). */
const AUTO_VERIFY_REQUESTING_MS = 125_000
const AUTO_VERIFY_MAX = 3

function verifiable(item: ArcaAttentionVoucher, now: number): boolean {
  const since = Date.parse(item.since)
  if (!Number.isFinite(since)) return false
  if (item.status === 'needs_reconcile') return now - since >= AUTO_VERIFY_AFTER_MS
  if (item.status === 'requesting') return now - since >= AUTO_VERIFY_REQUESTING_MS
  return false
}

/**
 * Las facturas de ARCA que necesitan atención (diseño §3.2.5):
 * - **En verificación** (`needs_reconcile`, o pidiendo el CAE hace rato): «No la
 *   vuelvas a emitir» + [Verificar con ARCA]. Al abrir la pantalla se verifican
 *   solas las que ya tienen edad para eso.
 * - **Emitida y sin cargar** (`authorized`, producción): [Cargarla ahora] e
 *   [Imprimir].
 *
 * Con `canWrite: false` (la contadora) se ven los avisos sin botones.
 */
export function ArcaVoucherAttention({
  slug,
  items,
  canWrite,
  autoVerify = true,
}: {
  slug: string
  items: readonly ArcaAttentionVoucher[]
  canWrite: boolean
  autoVerify?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [posting, setPosting] = useState<ArcaAttentionVoucher | null>(null)
  const [announce, setAnnounce] = useState('')
  const [, start] = useTransition()
  const autoRan = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Las que ya tienen edad para darlas por emitidas o no: se verifican solas una vez
  // (una sola corrida aunque el efecto se monte dos veces).
  useEffect(() => {
    if (!autoVerify || !canWrite || autoRan.current) return
    const now = Date.now()
    const due = items.filter((i) => verifiable(i, now)).slice(0, AUTO_VERIFY_MAX)
    if (due.length === 0) return
    autoRan.current = true
    void (async () => {
      let changed = false
      for (const item of due) {
        try {
          const res = await reconcileArcaVoucher(slug, { voucherId: item.id })
          if (res.ok && res.data.status !== 'needs_reconcile' && res.data.status !== 'requesting') {
            changed = true
            if (mounted.current) setAnnounce(`${item.label}: ${res.message}`)
          }
        } catch {
          // Sin conexión: queda el botón para hacerlo a mano.
        }
      }
      if (changed && mounted.current) router.refresh()
    })()
  }, [autoVerify, canWrite, items, router, slug])

  function verify(item: ArcaAttentionVoucher) {
    setBusy(item.id)
    start(async () => {
      try {
        const res = await reconcileArcaVoucher(slug, { voucherId: item.id })
        if (res.ok) {
          setAnnounce(`${item.label}: ${res.message}`)
          if (res.data.status === 'needs_reconcile' || res.data.status === 'requesting') {
            toast.info(res.message)
          } else {
            toast.success(res.message)
            router.refresh()
          }
        } else {
          toast.error(res.message)
        }
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      } finally {
        setBusy(null)
      }
    })
  }

  if (items.length === 0) {
    return (
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    )
  }

  return (
    <section aria-label="Facturas de ARCA para revisar" className="grid gap-3">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {items.map((item) => {
        const test = item.environment === 'homologacion' ? ' (prueba)' : ''
        if (item.status === 'authorized') {
          return (
            <Callout
              key={item.id}
              tone="error"
              title={`${item.label} está emitida en ARCA, pero falta en los libros`}
              action={
                canWrite ? (
                  <>
                    <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
                      <Link href={arcaPrintHref(slug, item.id)} target="_blank" rel="noopener">
                        <Printer className="size-4" aria-hidden />
                        Imprimir
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-11 gap-1.5 md:h-8"
                      onClick={() => setPosting(item)}
                    >
                      <BookPlus className="size-4" aria-hidden />
                      Cargarla ahora
                    </Button>
                  </>
                ) : null
              }
            >
              CAE {item.cae ?? '—'} · {formatCents(item.totalCents)}. Cargala para que entre al
              Libro IVA y a la cuenta del cliente.
            </Callout>
          )
        }
        return (
          <Callout
            key={item.id}
            tone="warning"
            title={`${item.label}${test} está en verificación con ARCA`}
            action={
              canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 md:h-8"
                  disabled={busy === item.id}
                  onClick={() => verify(item)}
                >
                  <RefreshCw
                    className={
                      busy === item.id ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'
                    }
                    aria-hidden
                  />
                  {busy === item.id ? 'Verificando…' : 'Verificar con ARCA'}
                </Button>
              ) : null
            }
          >
            No la vuelvas a emitir: ARCA no contestó a tiempo y estamos confirmando si la autorizó.
            Se verifica sola en unos minutos.
          </Callout>
        )
      })}
      {posting ? (
        <PostVoucherDialog
          slug={slug}
          voucherId={posting.id}
          label={posting.label}
          open
          onOpenChange={(open) => {
            if (!open) setPosting(null)
          }}
          onPosted={(documentId) => {
            setPosting(null)
            if (documentId) router.push(`/${slug}/administracion/comprobantes/${documentId}`)
          }}
        />
      ) : null}
    </section>
  )
}
