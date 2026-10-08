import { FileText, Printer } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { type ArcaVoucherCard, arcaPrintHref } from '@/lib/arca/emit-form'
import { formatDateTime, formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ArcaPostButton, ArcaReconcileButton, RefreshButton } from './arca-card-actions'

const TONE: Readonly<Record<ArcaVoucherCard['status'], 'ok' | 'warn' | 'bad' | 'muted'>> = {
  posted: 'ok',
  authorized: 'warn',
  needs_reconcile: 'warn',
  requesting: 'warn',
  reserved: 'muted',
  rejected: 'bad',
  failed: 'bad',
  abandoned: 'muted',
}

const BADGE_CLASS = {
  ok: 'border-success/30 bg-success/10 text-success',
  warn: 'border-warning/40 bg-warning/10 text-warning-text',
  bad: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: '',
} as const

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * «Autorización de ARCA» (diseño §3.2.2, paso 5): el CAE, su vencimiento, el
 * número, el ambiente y el estado, con [Imprimir factura]. Si quedó en
 * verificación o sin vincular, los botones para resolverlo (solo para quien
 * puede cargar). Una factura que ya está en ARCA no se anula desde acá: se corrige
 * con una nota de crédito emitida con ARCA.
 */
export function ArcaAuthorizationCard({
  slug,
  outcome,
  canWrite,
  creditNoteHref,
}: {
  slug: string
  outcome: QueryOutcome<ArcaVoucherCard | null>
  canWrite: boolean
  /** «Emitir una nota de crédito» (solo facturas y notas de débito vigentes). */
  creditNoteHref: string | null
}) {
  if (!outcome.ok) {
    return (
      <Callout tone="warning" action={<RefreshButton />}>
        No pudimos cargar la autorización de ARCA de este comprobante. {outcome.message}
      </Callout>
    )
  }
  const card = outcome.data
  if (!card) return null
  const tone = TONE[card.status]
  const hasCae = card.cae !== null
  return (
    <section aria-labelledby="arca-titulo" className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="arca-titulo" className="font-serif text-lg font-semibold tracking-tight">
              Autorización de ARCA
            </h2>
            <Badge
              variant={tone === 'muted' ? 'muted' : 'outline'}
              className={cn(BADGE_CLASS[tone])}
            >
              {card.statusLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            El CAE es el código con el que ARCA autoriza la factura: con él vale ante ARCA y ante tu
            cliente.
          </p>
        </div>
        {hasCae ? (
          <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-auto md:h-9">
            <Link
              href={arcaPrintHref(slug, card.documentId ?? card.id)}
              target="_blank"
              rel="noopener"
            >
              <Printer className="size-4" aria-hidden />
              Imprimir factura
            </Link>
          </Button>
        ) : null}
      </header>

      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="CAE">
          <span className="break-all font-mono tabular-nums">{card.cae ?? '—'}</span>
        </Fact>
        <Fact label="Vence el CAE">
          <span className="tabular-nums">{card.caeDue ? formatIsoDay(card.caeDue) : '—'}</span>
        </Fact>
        <Fact label="Comprobante">
          <span className="tabular-nums">{card.label}</span>
        </Fact>
        <Fact label="Ambiente">
          {card.environment === 'produccion' ? 'Producción' : 'Pruebas (homologación)'}
        </Fact>
        {card.processedAt ? (
          <Fact label="Autorizada">
            <span className="tabular-nums">{formatDateTime(card.processedAt)}</span>
          </Fact>
        ) : null}
      </dl>

      {card.observations.length > 0 ? (
        <div className="border-t border-border/60 px-5 py-4 text-sm">
          <p className="font-medium">Avisos de ARCA (no frenan la factura)</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {card.observations.map((o) => (
              <li key={o} className="text-pretty">
                {o}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canWrite && (card.canReconcile || card.canPost || creditNoteHref) ? (
        <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-4">
          {card.canReconcile ? (
            <p className="text-sm text-warning-text text-pretty">
              ARCA no contestó a tiempo cuando se emitió. No la vuelvas a emitir: verificala.
            </p>
          ) : null}
          {card.canPost ? (
            <p className="text-sm text-pretty">
              ARCA la autorizó, pero falta vincularla con su asiento. «Cargarla ahora» lo resuelve
              sin cargarla dos veces.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {card.canReconcile ? <ArcaReconcileButton slug={slug} voucherId={card.id} /> : null}
            {card.canPost ? (
              <ArcaPostButton slug={slug} voucherId={card.id} label={card.label} />
            ) : null}
            {creditNoteHref ? (
              <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-auto md:h-9">
                <Link href={creditNoteHref}>
                  <FileText className="size-4" aria-hidden />
                  Anularla con una nota de crédito
                </Link>
              </Button>
            ) : null}
          </div>
          {creditNoteHref ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Una factura emitida en ARCA no se borra ni se anula desde los libros: se corrige
              emitiendo una nota de crédito (también con ARCA), que la compensa.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
