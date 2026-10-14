'use client'

import { Landmark } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { EmptyTeach } from '@/components/administracion/kit'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import type { SavedLayout } from '@/lib/imports/ui/bank-mapping'
import type { WantedRange } from '@/lib/imports/ui/inbox'
import { ImportUploader } from './import-uploader'

const LAST_KEY = 'hub_import_bank_account'

/**
 * Subir los movimientos del banco: primero de qué cuenta son (la clave de cada
 * movimiento lleva la cuenta), después el archivo. La cuenta se elige con
 * píldoras (nombre + saldo, la elegida rellena) adentro del paso 2. Si hay una
 * sola cuenta de banco, ya viene elegida; si no, se recuerda la última en este
 * dispositivo.
 *
 * Sin ninguna cuenta de banco cargada, enseña el paso que falta en vez de
 * mostrar una ranura que no se puede usar.
 */
export function BankImport({
  slug,
  banks,
  layouts,
  ajustesHref,
  howTo,
  wanted,
  firstTime,
  booksStartDate,
}: {
  slug: string
  banks: TreasuryOption[]
  layouts: SavedLayout[]
  ajustesHref: string
  howTo: ReactNode
  wanted: WantedRange
  firstTime: boolean
  booksStartDate: string | null
}) {
  const labelId = useId()
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
      <EmptyTeach
        icon={Landmark}
        title="Falta decir cuál es tu cuenta del banco"
        action={
          <Button asChild className="h-11">
            <Link href={ajustesHref}>Agregar la cuenta</Link>
          </Button>
        }
      >
        La agregás una vez en Cajas, con su CBU, y volvés.
      </EmptyTeach>
    )
  }

  return (
    <ImportUploader
      slug={slug}
      context={{ source: 'bank_statement', treasuryAccountId: treasuryId ?? '', layouts }}
      blockedReason={treasuryId ? null : 'Elegí primero de qué cuenta es.'}
      howTo={howTo}
      wanted={wanted}
      firstTime={firstTime}
      booksStartDate={booksStartDate}
      account={
        <div className="grid gap-2">
          <p id={labelId} className="font-medium">
            ¿De qué cuenta es?
          </p>
          <TreasuryPicker
            aria-labelledby={labelId}
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
          <p className="text-sm text-muted-foreground">
            Si tenés más de una cuenta, subí el archivo de cada una por separado.
          </p>
        </div>
      }
    />
  )
}
