'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { AccountingAction } from '@/components/administracion/acciones/types'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Cada renglón de un menú: abre su hoja sobre esta pantalla, o va a la de los gastos del banco. */
type MoneyItem = { key: string; label: string } & ({ action: AccountingAction } | { path: string })

export const MONEY_IN: readonly MoneyItem[] = [
  { key: 'cobro', label: 'Cobro', action: 'cobrar' },
  { key: 'socio', label: 'Socio puso plata', action: 'movimiento' },
  { key: 'otro', label: 'Otro', action: 'movimiento' },
]

export const MONEY_OUT: readonly MoneyItem[] = [
  { key: 'pago', label: 'Pago', action: 'pagar' },
  { key: 'socio', label: 'Socio sacó plata', action: 'movimiento' },
  { key: 'banco', label: 'Gasto del banco', path: '/cajas/gasto-bancario' },
  { key: 'otro', label: 'Otro', action: 'movimiento' },
]

function MoneyMenu({
  label,
  items,
  base,
}: {
  label: ReactNode
  items: readonly MoneyItem[]
  base: string
}) {
  const { openAction } = useAccounting()
  return (
    // `modal={false}`: la hoja se abre apenas se elige, y un menú modal le trababa la página.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1 max-sm:h-10">
          {label}
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) =>
          'path' in item ? (
            <DropdownMenuItem key={item.key} asChild className="max-sm:min-h-11">
              <Link href={`${base}${item.path}`}>{item.label}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.key}
              className="max-sm:min-h-11"
              onSelect={() => openAction(item.action)}
            >
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * «Entró plata» y «Salió plata», arriba a la derecha de Caja: dos palabras en vez de seis botones.
 * Cada una abre un menú chico con lo que puede ser. Quien solo lee no los ve.
 */
export function MoneyButtons({ base }: { base: string }) {
  const { readOnly } = useAccounting()
  if (readOnly) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MoneyMenu label="Entró plata" items={MONEY_IN} base={base} />
      <MoneyMenu label="Salió plata" items={MONEY_OUT} base={base} />
    </div>
  )
}
