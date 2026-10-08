'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { type TreasuryOption, TreasurySelect } from '@/components/administracion/treasury-select'
import { Label } from '@/components/ui/label'
import type { SavedLayout } from '@/lib/imports/ui/bank-mapping'
import { ImportUploader } from './import-uploader'

const LAST_KEY = 'hub_import_bank_account'

/**
 * Importar el extracto del banco (diseño §4.3): primero de qué cuenta es (la
 * clave de cada movimiento lleva la cuenta), después el archivo. Si hay una sola
 * cuenta de banco, ya viene elegida; si no, se recuerda la última en este
 * dispositivo.
 */
export function BankImport({
  slug,
  banks,
  layouts,
  ajustesHref,
}: {
  slug: string
  banks: TreasuryOption[]
  layouts: SavedLayout[]
  ajustesHref: string
}) {
  const id = useId()
  const [treasuryId, setTreasuryId] = useState<string | null>(
    banks.length === 1 ? (banks[0]?.id ?? null) : null,
  )

  useEffect(() => {
    if (banks.length < 2) return
    try {
      const last = window.localStorage.getItem(LAST_KEY)
      if (last && banks.some((b) => b.id === last)) setTreasuryId((current) => current ?? last)
    } catch {
      // Sin localStorage (modo privado): se elige a mano.
    }
  }, [banks])

  if (banks.length === 0) {
    return (
      <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text text-pretty">
        Todavía no cargaste ninguna cuenta de banco.{' '}
        <Link href={ajustesHref} className="font-medium underline underline-offset-2">
          Agregala en Ajustes › Cajas y cuentas
        </Link>{' '}
        (con su CBU) y volvé para importar el extracto.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {/* La tarjeta va a lo ancho de la columna (con `max-w-xl` quedaba 15 px más corta que
          el paso a paso de abajo); lo que se angosta es el campo, como en Mercado Pago. */}
      <div className="card-hairline grid gap-1.5 rounded-xl border bg-card p-5">
        <Label htmlFor={id}>
          ¿De qué cuenta es el extracto?
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        </Label>
        <TreasurySelect
          id={id}
          className="sm:max-w-md"
          value={treasuryId}
          treasuries={banks}
          placeholder="Elegí la cuenta del banco"
          onValueChange={(next) => {
            setTreasuryId(next)
            try {
              window.localStorage.setItem(LAST_KEY, next)
            } catch {
              // No hace falta recordarla.
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Si tenés más de una cuenta, importá el extracto de cada una por separado.
        </p>
      </div>
      <ImportUploader
        slug={slug}
        context={{ source: 'bank_statement', treasuryAccountId: treasuryId ?? '', layouts }}
        blockedReason={treasuryId ? null : 'Elegí primero de qué cuenta es el extracto.'}
      />
    </div>
  )
}
