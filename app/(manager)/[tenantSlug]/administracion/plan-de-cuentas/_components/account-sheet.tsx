'use client'

import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { SavedAccount } from '@/lib/accounting/actions/master'
import { ReadOnlyItem } from '../../ajustes/_components/form-bits'
import { systemUse } from '../_lib/system-uses'
import { type ChartAccount, type ChartIndex, parentOf, pathLabel } from '../_lib/tree'
import { AccountBadges, accountKindText } from './account-bits'
import { AccountCreateForm } from './account-create-form'
import { AccountEditForm } from './account-edit-form'

export type AccountSheetState =
  | { mode: 'account'; id: string }
  | {
      mode: 'create'
      /** `undefined` = elegir; `null` = cuenta principal; un id = adentro de ese grupo. */
      parentId: string | null | undefined
      /** Cada «Nueva cuenta» arranca un formulario limpio. */
      nonce: number
    }
  | null

/**
 * La hoja lateral del plan de cuentas (H.16): ver una cuenta (contadora), editarla o crear una
 * nueva. No se cierra mientras guarda.
 */
export function AccountSheet({
  tenantSlug,
  index,
  state,
  readOnly,
  balancesAvailable,
  onClose,
  onSaved,
  onMove,
  onChangeActive,
}: {
  tenantSlug: string
  index: ChartIndex
  state: AccountSheetState
  readOnly: boolean
  balancesAvailable: boolean
  onClose: () => void
  onSaved: (saved: SavedAccount, created: boolean) => void
  onMove: (id: string) => void
  onChangeActive: (id: string, active: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const account = state?.mode === 'account' ? (index.byId.get(state.id) ?? null) : null
  const creating = state?.mode === 'create' ? state : null
  const open = account !== null || creating !== null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 px-5 py-4 pr-12">
          <SheetTitle className="font-serif text-lg">
            {account ? (
              <>
                <span className="mr-2 font-mono text-sm font-normal text-muted-foreground">
                  {account.code}
                </span>
                {account.name}
              </>
            ) : (
              'Nueva cuenta'
            )}
          </SheetTitle>
          <SheetDescription className="text-pretty">
            {account
              ? accountKindText(account)
              : 'Puede ir adentro de cualquier grupo o ser una cuenta principal.'}
          </SheetDescription>
          {account ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <AccountBadges account={account} />
            </div>
          ) : null}
        </SheetHeader>

        {account && readOnly ? (
          <AccountView
            tenantSlug={tenantSlug}
            index={index}
            account={account}
            balancesAvailable={balancesAvailable}
          />
        ) : account ? (
          <AccountEditForm
            key={account.id}
            tenantSlug={tenantSlug}
            index={index}
            account={account}
            balancesAvailable={balancesAvailable}
            onBusyChange={setBusy}
            onDone={(saved) => {
              if (saved) onSaved(saved, false)
              else onClose()
            }}
            onMove={() => onMove(account.id)}
            onChangeActive={(active) => onChangeActive(account.id, active)}
          />
        ) : creating && !readOnly ? (
          <AccountCreateForm
            key={creating.nonce}
            tenantSlug={tenantSlug}
            index={index}
            initialParent={creating.parentId}
            onBusyChange={setBusy}
            onDone={(saved) => onSaved(saved, true)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/** Lo que ve la contadora: los datos de la cuenta, sin editar. */
function AccountView({
  tenantSlug,
  index,
  account,
  balancesAvailable,
}: {
  tenantSlug: string
  index: ChartIndex
  account: ChartAccount
  balancesAvailable: boolean
}) {
  const parent = parentOf(index, account)
  const use = systemUse(account.systemKey)
  const path = parent ? pathLabel(index, parent.id) : ''
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <dl className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
        <ReadOnlyItem label="Grupo">
          {parent ? (
            <>
              <span className="font-mono text-xs text-muted-foreground">{parent.code}</span>{' '}
              {parent.name}
              {path ? <span className="block text-xs text-muted-foreground">{path}</span> : null}
            </>
          ) : (
            'Es una cuenta principal.'
          )}
        </ReadOnlyItem>
        <ReadOnlyItem label="Para qué se usa">
          {account.description ?? <span className="text-muted-foreground">Sin descripción.</span>}
        </ReadOnlyItem>
        {account.systemKey ? (
          <ReadOnlyItem label="La usa el sistema">
            {use ? `${use.label}: ${use.use}` : 'El sistema arma asientos con esta cuenta.'}
          </ReadOnlyItem>
        ) : null}
        {account.postable ? (
          <>
            <ReadOnlyItem label="Lleva proveedor o cliente">
              {account.requiresParty ? 'Sí: es una cuenta de control.' : 'No.'}
            </ReadOnlyItem>
            <ReadOnlyItem label="Saldo hoy">
              {balancesAvailable ? (
                <Amount cents={account.balanceCents} side />
              ) : (
                <span className="text-muted-foreground">Todavía no disponible.</span>
              )}
            </ReadOnlyItem>
          </>
        ) : null}
      </dl>
      {account.postable ? (
        <SheetFooter className="border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link href={`/${tenantSlug}/administracion/libros/mayor?cuenta=${account.id}`}>
              <BookOpen className="size-4" aria-hidden />
              Ver mayor
            </Link>
          </Button>
        </SheetFooter>
      ) : null}
    </div>
  )
}
