import { Printer } from 'lucide-react'
import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { type ArcaVoucherCard, arcaPrintHref } from '@/lib/arca/emit-form'
import { formatDateTime, formatIsoDay } from '@/lib/dates'
import { ArcaPostButton, ArcaReconcileButton, RefreshButton } from './arca-card-actions'

const TONE: Readonly<Record<ArcaVoucherCard['status'], 'ok' | 'warn' | 'late' | 'muted'>> = {
  posted: 'ok',
  authorized: 'warn',
  needs_reconcile: 'warn',
  requesting: 'warn',
  reserved: 'muted',
  rejected: 'late',
  failed: 'late',
  abandoned: 'muted',
}

/**
 * La autorización de ARCA de una factura emitida desde la plataforma (diseño
 * §3.2.2, paso 5), como cuerpo del nodo «ARCA» del mapa de vínculos: el CAE
 * con su estado, cuándo vence, el número, el ambiente y cuándo se autorizó,
 * con [Imprimir factura]. Si quedó en verificación o sin vincular, los botones
 * para resolverlo (solo para quien puede cargar).
 *
 * Ya no dibuja su tarjeta ni el botón de la nota de crédito: una factura que
 * está en ARCA no se anula desde acá, y cómo se corrige lo dice el bloque
 * «¿Hay algo mal?» de la ficha, con el mismo link.
 */
export function ArcaAuthorizationCard({
  slug,
  outcome,
  canWrite,
}: {
  slug: string
  outcome: QueryOutcome<ArcaVoucherCard | null>
  canWrite: boolean
}) {
  if (!outcome.ok) {
    return (
      <div className="flex flex-col items-start gap-2.5">
        <p role="alert" className="text-muted-foreground text-pretty">
          No pudimos cargar la autorización de ARCA de este comprobante. {outcome.message}
        </p>
        <RefreshButton />
      </div>
    )
  }
  const card = outcome.data
  if (!card) return null
  const facts = [
    card.caeDue ? `Vence el CAE el ${formatIsoDay(card.caeDue)}` : null,
    `${card.label} · ${card.environment === 'produccion' ? 'Producción' : 'Pruebas (homologación)'}`,
    card.processedAt ? `Autorizada el ${formatDateTime(card.processedAt)}` : null,
  ].filter((fact): fact is string => fact !== null)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <p className="font-medium">
          {card.cae ? (
            <>
              CAE <span className="font-mono break-all tabular-nums">{card.cae}</span>
            </>
          ) : (
            'Todavía sin CAE'
          )}
        </p>
        <StatusPill tone={TONE[card.status]}>{card.statusLabel}</StatusPill>
      </div>
      <ul className="space-y-0.5 text-muted-foreground tabular-nums">
        {facts.map((fact) => (
          <li key={fact} className="text-pretty">
            {fact}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground text-pretty">
        El CAE es el código con el que ARCA autoriza la factura: con él vale ante ARCA y ante tu
        cliente.
      </p>

      {card.observations.length > 0 ? (
        <div>
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

      {canWrite && card.canReconcile ? (
        <p className="text-warning-text text-pretty">
          ARCA no contestó a tiempo cuando se emitió. No la vuelvas a emitir: verificala.
        </p>
      ) : null}
      {canWrite && card.canPost ? (
        <p className="text-pretty">
          ARCA la autorizó, pero falta vincularla con su asiento. «Cargarla ahora» lo resuelve sin
          cargarla dos veces.
        </p>
      ) : null}

      {card.cae !== null || (canWrite && (card.canReconcile || card.canPost)) ? (
        <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:flex-wrap">
          {canWrite && card.canReconcile ? (
            <ArcaReconcileButton slug={slug} voucherId={card.id} />
          ) : null}
          {canWrite && card.canPost ? (
            <ArcaPostButton slug={slug} voucherId={card.id} label={card.label} />
          ) : null}
          {card.cae !== null ? (
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
        </div>
      ) : null}
    </div>
  )
}
