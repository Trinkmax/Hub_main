'use client'

import { Check, Copy, MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatPhoneForDisplay } from '@/lib/phone'
import { formatPesos } from '@/lib/ticketing/pricing'

const COPIED_MS = 2200

/**
 * Cómo pagar por transferencia cuando Mercado Pago rechaza el pago. La transferencia
 * no reserva sola: la persona avisa y el bar le carga la reserva.
 *
 * Con WhatsApp del bar, mandar el comprobante es obligatorio y se dice con el número a la
 * vista (pedido de los socios del 11/11/2026: «muchos ponen transferir y no mandan nada y
 * no sabemos si es real o no»).
 */
export function TransferSlip({
  alias,
  holder,
  amountCents,
  deposit,
  proofUrl,
  proofPhone = null,
}: {
  alias: string
  holder: string | null
  amountCents: number
  deposit: boolean
  proofUrl: string | null
  /** El WhatsApp del bar (E.164) al que va el comprobante. */
  proofPhone?: string | null
}) {
  const [copied, setCopied] = useState(false)
  const aliasRef = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(alias)
    } catch {
      // El navegador no deja usar el portapapeles: queda marcado para copiarlo a mano.
      if (aliasRef.current) window.getSelection()?.selectAllChildren(aliasRef.current)
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <section className="ent-transfer" aria-label="Pagar por transferencia">
      <div className="flex items-baseline justify-between gap-3">
        <p className="ent-mono text-[0.62rem] font-semibold text-(--ent-ink-2)">
          {deposit ? 'Transferí la seña' : 'Transferí el total'}
        </p>
        <p className="ent-num text-sm font-semibold text-(--ent-ink)">{formatPesos(amountCents)}</p>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <strong ref={aliasRef} className="ent-transfer-alias min-w-0 text-(--ent-ink)">
          {alias}
        </strong>
        <button
          type="button"
          onClick={copy}
          className="ent-press flex h-11 flex-none items-center gap-1.5 rounded-full border border-(--ent-ink)/25 px-3.5 text-sm font-semibold text-(--ent-ink)"
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Alias copiado' : ''}
      </span>

      {holder ? (
        <p className="mt-2 text-xs text-(--ent-ink-2)">
          A nombre de
          <br />
          <span className="font-medium text-(--ent-ink)">{holder}</span>
        </p>
      ) : null}

      {proofUrl ? (
        <>
          <div className="ent-transfer-must mt-3.5">
            <p className="ent-must">Comprobante obligatorio</p>
            <p className="mt-2 text-[0.8rem] leading-snug text-(--ent-ink)">
              Si transferís, tenés que mandar el comprobante <strong>sí o sí</strong> a nuestro
              número de reservas
              {proofPhone ? (
                <>
                  :{' '}
                  <strong className="ent-proof-phone ent-num whitespace-nowrap">
                    {formatPhoneForDisplay(proofPhone)}
                  </strong>
                </>
              ) : null}
              . Si no, la reserva no se efectuará.
            </p>
          </div>
          <a
            href={proofUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ent-press mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-(--ent-ink) text-sm font-semibold text-(--ent-paper)"
          >
            <MessageCircle className="size-4" aria-hidden />
            Ya transferí: mandar comprobante
          </a>
          <p className="mt-2 text-center text-xs text-(--ent-ink-2)">
            Tu lugar queda confirmado cuando te respondamos.
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs font-semibold text-(--ent-ink)">
          Guardá el comprobante: cuando nos llegue la transferencia, te confirmamos por WhatsApp.
        </p>
      )}
    </section>
  )
}
