'use client'

import { useEffect, useMemo, useState } from 'react'
import { plural } from '@/components/administracion/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { type SavedAccount, saveAccount } from '@/lib/accounting/actions/master'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { failureKey, formFeedback } from '../_lib/feedback'
import {
  ACCOUNT_TYPE_OF,
  type ChartAccount,
  type ChartIndex,
  checkMove,
  childrenOf,
  descendantsOf,
  moveCountText,
  moveSummary,
  moveTargets,
} from '../_lib/tree'
import { GroupCombobox, ROOT_CHOICE } from './group-combobox'

function label(account: ChartAccount | null): string {
  return account ? `${account.code} ${account.name}` : 'las cuentas principales'
}

/**
 * Mover una cuenta, o un grupo entero con todo lo que tiene adentro, a otro grupo (#16). Antes de
 * mover se ve cuántas cuentas se mueven, de dónde a dónde y si cambia el tipo. Los códigos no cambian.
 */
export function MoveDialog({
  tenantSlug,
  index,
  accountId,
  onClose,
  onMoved,
}: {
  tenantSlug: string
  index: ChartIndex
  accountId: string | null
  onClose: () => void
  onMoved: (saved: SavedAccount, message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const account = accountId ? (index.byId.get(accountId) ?? null) : null
  return (
    <Dialog
      open={account !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      {account ? (
        <MoveForm
          key={account.id}
          tenantSlug={tenantSlug}
          index={index}
          account={account}
          onBusyChange={setBusy}
          onClose={onClose}
          onMoved={onMoved}
        />
      ) : null}
    </Dialog>
  )
}

function MoveForm({
  tenantSlug,
  index,
  account,
  onBusyChange,
  onClose,
  onMoved,
}: {
  tenantSlug: string
  index: ChartIndex
  account: ChartAccount
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onMoved: (saved: SavedAccount, message: string) => void
}) {
  const { pending, run } = useMasterAction()
  const [choice, setChoice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const targets = useMemo(() => moveTargets(index, account), [index, account])
  const rootAllowed = checkMove(index, account, null).ok
  const total = 1 + descendantsOf(index, account.id).length

  useEffect(() => onBusyChange(pending), [pending, onBusyChange])

  const target = choice && choice !== ROOT_CHOICE ? (index.byId.get(choice) ?? null) : null
  const chosen = choice === ROOT_CHOICE || target !== null
  const check = chosen ? checkMove(index, account, target) : null
  const summary = chosen && check?.ok ? moveSummary(index, account, target) : null
  const restricted =
    Boolean(account.systemKey) || account.isTreasury || childrenOf(index, account.id).length > 0

  const submit = () => {
    if (pending) return
    if (!check) {
      setFieldError('Elegí adónde va.')
      return
    }
    if (!check.ok) {
      setFieldError(check.reason)
      return
    }
    setError(null)
    setFieldError(null)
    const where = target ? `adentro de ${target.code} ${target.name}` : 'como cuenta principal'
    const text =
      total === 1
        ? `Listo: la cuenta quedó ${where}.`
        : `Listo: las ${total} cuentas quedaron ${where}.`
    run(
      () =>
        saveAccount(tenantSlug, {
          mode: 'update',
          id: account.id,
          expectedUpdatedAt: account.updatedAt,
          parentId: target ? target.id : null,
        }),
      {
        quiet: true,
        onSuccess: (saved) => onMoved(saved, text),
        onFailure: (state: AccFailureState) => {
          // Con movimientos no cambia de tipo: solo puede ir a un grupo de su mismo tipo.
          if (failureKey(state) === 'account_has_movements') {
            setFieldError(null)
            setError(
              `La cuenta ya tiene movimientos: no puede cambiar de tipo. Elegí un grupo ${ACCOUNT_TYPE_OF[account.type]}.`,
            )
            return
          }
          const feedback = formFeedback(state, ['parentId'])
          setFieldError(feedback.fields.parentId ?? null)
          setError(feedback.message)
        },
      },
    )
  }

  return (
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle className="font-serif text-pretty">
          Mover {account.code} {account.name}
        </DialogTitle>
        <DialogDescription className="text-pretty">
          {total === 1
            ? 'Elegí el grupo nuevo.'
            : `Elegí el grupo nuevo: se mueve con las ${total - 1} cuentas que tiene adentro.`}
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          submit()
        }}
      >
        <Field id="mv-target" label="Adentro de" required error={fieldError}>
          <GroupCombobox
            id="mv-target"
            index={index}
            groups={targets}
            value={choice}
            onValueChange={(v) => {
              setChoice(v)
              setFieldError(null)
              setError(null)
            }}
            allowRoot={rootAllowed}
            invalid={Boolean(fieldError)}
            describedBy={describedBy('mv-target', null, fieldError)}
            placeholder="Elegí el grupo nuevo"
          />
        </Field>

        {targets.length === 0 && !rootAllowed ? (
          <Callout tone="info">
            No hay otro grupo adonde pueda ir
            {restricted ? ` (solo puede ir a grupos ${ACCOUNT_TYPE_OF[account.type]})` : ''}.
          </Callout>
        ) : null}

        {summary && check?.ok ? (
          <Callout tone="info" title={moveCountText(summary, account.name)}>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Pasa de {label(summary.from)} a {label(summary.to)}.
              </li>
              {check.typeChanges ? (
                <li>
                  Va a quedar como cuenta {ACCOUNT_TYPE_OF[summary.typeTo]}: toma el tipo del grupo
                  nuevo.
                </li>
              ) : null}
              {summary.inactive > 0 ? (
                <li>
                  Incluye {plural(summary.inactive, 'cuenta desactivada', 'cuentas desactivadas')}.
                </li>
              ) : null}
              <li>Los códigos no cambian: si querés, después los editás.</li>
            </ul>
          </Callout>
        ) : null}

        {error ? <Callout tone="error">{error}</Callout> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="h-11 md:h-9"
            disabled={pending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="h-11 min-w-[160px] md:h-9"
            disabled={pending || !check?.ok}
          >
            {pending ? 'Moviendo…' : total === 1 ? 'Mover la cuenta' : `Mover ${total} cuentas`}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
