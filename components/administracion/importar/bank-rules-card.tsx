'use client'

import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { type TreasuryOption, TreasurySelect } from '@/components/administracion/treasury-select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { deleteImportRule, saveImportRule } from '@/lib/imports/actions'
import type { BankExpenseComponent } from '@/lib/imports/server/proposals/bank'
import { isSafePattern, SAFE_PATTERN_HELP } from '@/lib/imports/server/safe-pattern'
import {
  BANK_EXPENSE_COMPONENT_TEXT,
  BANK_RULE_KIND_TEXT,
  type BankRuleKind,
  RULE_DIRECTION_TEXT,
} from '@/lib/imports/ui/labels'
import { ToneBadge } from './status-badge'

/** Una regla del bar para el banco, como la arma la página desde `listImportRules`. */
export type BankRuleView = {
  id: string
  priority: number
  label: string
  pattern: string | null
  counterpartyCuit: string | null
  direction: 'credit' | 'debit' | null
  kind: string
  component: string | null
  accountId: string | null
  partyId: string | null
  treasuryId: string | null
  active: boolean
  serverSafe: boolean
  updatedAt: string | null
}

type Options = {
  parties: PartyOption[]
  accounts: AccountOption[]
  treasuries: TreasuryOption[]
}

const COMPONENTS = Object.keys(BANK_EXPENSE_COMPONENT_TEXT) as BankExpenseComponent[]
const KINDS = Object.keys(BANK_RULE_KIND_TEXT) as BankRuleKind[]
const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

function isKind(value: string): value is BankRuleKind {
  return (KINDS as readonly string[]).includes(value)
}

/** Lo que hace la regla, con los nombres de verdad. */
function actionText(rule: BankRuleView, options: Options): string {
  if (!isKind(rule.kind)) return 'Acción que no conocemos'
  const base = BANK_RULE_KIND_TEXT[rule.kind]
  switch (rule.kind) {
    case 'expense_component':
      return rule.component && rule.component in BANK_EXPENSE_COMPONENT_TEXT
        ? BANK_EXPENSE_COMPONENT_TEXT[rule.component as BankExpenseComponent]
        : base
    case 'transfer': {
      const t = options.treasuries.find((x) => x.id === rule.treasuryId)
      return t ? `Pasa a ${t.name}` : base
    }
    case 'payment':
    case 'collection': {
      const p = options.parties.find((x) => x.id === rule.partyId)
      return p
        ? `${rule.kind === 'payment' ? 'Pago a' : 'Cobro de'} ${p.tradeName ?? p.name}`
        : base
    }
    case 'movement': {
      const a = options.accounts.find((x) => x.id === rule.accountId)
      return a ? `Va a ${a.name}` : base
    }
    default:
      return base
  }
}

/**
 * «Tus reglas para el banco» (diseño §4.3.3): además de las de fábrica (Ley
 * 25.413, comisiones, transferencias…), el bar suma las suyas. Cada una dice
 * qué texto buscar en la descripción y qué hacer. Si un patrón no entra en lo
 * que el servidor puede evaluar sin riesgo, se avisa y no se aplica.
 */
export function BankRulesCard({
  slug,
  rules,
  options,
}: {
  slug: string
  rules: BankRuleView[]
  options: Options
}) {
  const router = useRouter()
  const titleId = useId()
  const [editing, setEditing] = useState<BankRuleView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BankRuleView | null>(null)
  const [pending, start] = useTransition()

  const remove = (rule: BankRuleView) => {
    start(async () => {
      try {
        const result = await deleteImportRule(slug, { ruleId: rule.id })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(result.message)
        setDeleting(null)
        router.refresh()
      } catch {
        toast.error('Sin conexión: no se borró. Probá de nuevo.')
      }
    })
  }

  return (
    <section aria-labelledby={titleId} className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
            <ListChecks className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id={titleId} className="font-serif text-lg font-semibold tracking-tight">
              Tus reglas para el banco
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Ya reconocemos solos comisiones, impuestos y transferencias. Sumá una regla para lo
              tuyo: «si la descripción dice EXPENSAS, es un pago a la administración».
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full shrink-0 gap-2 sm:w-auto md:h-9"
          onClick={() => setEditing('new')}
        >
          <Plus className="size-4" aria-hidden />
          Nueva regla
        </Button>
      </header>

      {rules.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          Todavía no tenés reglas propias. Cuando algo del extracto quede «para revisar» varias
          veces, armá una regla y la próxima vez se resuelve solo.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {rule.label}
                  {!rule.active ? <Badge variant="muted">Pausada</Badge> : null}
                  {!rule.serverSafe ? <ToneBadge tone="warning">No se aplica</ToneBadge> : null}
                </p>
                <p className="text-sm text-muted-foreground text-pretty">
                  {rule.pattern ? (
                    <>
                      Si la descripción dice{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">{rule.pattern}</code>
                    </>
                  ) : rule.counterpartyCuit ? (
                    <>Si la CUIT de la otra parte es {rule.counterpartyCuit}</>
                  ) : (
                    'Cualquier movimiento'
                  )}
                  {rule.direction ? ` · ${RULE_DIRECTION_TEXT[rule.direction].toLowerCase()}` : ''}{' '}
                  → {actionText(rule, options)}
                </p>
                {!rule.serverSafe ? (
                  <p className="text-xs text-warning-text">
                    El texto a buscar usa signos que no podemos evaluar. {SAFE_PATTERN_HELP}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 gap-2 sm:flex-none md:h-9"
                  onClick={() => setEditing(rule)}
                >
                  <Pencil className="size-4" aria-hidden />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 gap-2 text-destructive hover:text-destructive sm:flex-none md:h-9"
                  onClick={() => setDeleting(rule)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Borrar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <RuleDialog
          slug={slug}
          rule={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrás la regla «{deleting?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Lo que ya se cargó no cambia. En las próximas importaciones esos movimientos van a
              quedar para revisar (o los va a reconocer una regla de fábrica).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (deleting) remove(deleting)
              }}
            >
              {pending ? 'Borrando…' : 'Borrar la regla'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** Alta o edición de una regla. */
function RuleDialog({
  slug,
  rule,
  options,
  onClose,
  onSaved,
}: {
  slug: string
  rule: BankRuleView | null
  options: Options
  onClose: () => void
  onSaved: () => void
}) {
  const base = useId()
  const [pending, start] = useTransition()
  const [label, setLabel] = useState(rule?.label ?? '')
  const [pattern, setPattern] = useState(rule?.pattern ?? '')
  const [cuit, setCuit] = useState(rule?.counterpartyCuit ?? '')
  const [direction, setDirection] = useState<'any' | 'credit' | 'debit'>(rule?.direction ?? 'any')
  const [kind, setKind] = useState<BankRuleKind>(
    rule && isKind(rule.kind) ? rule.kind : 'expense_component',
  )
  const [component, setComponent] = useState<string>(rule?.component ?? 'comisiones')
  const [accountId, setAccountId] = useState<string | null>(rule?.accountId ?? null)
  const [partyId, setPartyId] = useState<string | null>(rule?.partyId ?? null)
  const [treasuryId, setTreasuryId] = useState<string | null>(rule?.treasuryId ?? null)
  const [active, setActive] = useState(rule?.active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const trimmedPattern = pattern.trim()
  const patternProblem =
    trimmedPattern !== '' && !isSafePattern(trimmedPattern) ? SAFE_PATTERN_HELP : null
  const cuitDigits = cuit.replace(/\D/g, '')

  const submit = () => {
    const local: Record<string, string> = {}
    if (label.trim().length < 2) local.label = 'Escribí para qué es la regla.'
    if (trimmedPattern === '' && cuitDigits === '') {
      local['match.pattern'] = 'Escribí qué dice la descripción (o la CUIT de la otra parte).'
    }
    if (patternProblem) local['match.pattern'] = patternProblem
    if (cuitDigits !== '' && cuitDigits.length !== 11)
      local['match.counterparty_cuit'] = 'Revisá la CUIT: son 11 números.'
    if (kind === 'transfer' && !treasuryId)
      local['action.kind'] = 'Elegí a qué cuenta pasa la plata.'
    if ((kind === 'payment' || kind === 'collection') && !partyId)
      local['action.kind'] = 'Elegí a quién.'
    if (kind === 'movement' && !accountId) local['action.kind'] = 'Elegí la cuenta.'
    setErrors(local)
    setMessage(null)
    if (Object.keys(local).length > 0) return

    const match: { pattern?: string; counterparty_cuit?: string; direction?: 'credit' | 'debit' } =
      {}
    if (trimmedPattern !== '') match.pattern = trimmedPattern
    if (cuitDigits !== '') match.counterparty_cuit = cuitDigits
    if (direction !== 'any') match.direction = direction
    const action: {
      kind: string
      component?: string
      treasury_account_id?: string
      party_id?: string
      account_id?: string
    } = { kind }
    if (kind === 'expense_component') action.component = component
    if (kind === 'transfer' && treasuryId) action.treasury_account_id = treasuryId
    if ((kind === 'payment' || kind === 'collection') && partyId) action.party_id = partyId
    if (kind === 'movement' && accountId) action.account_id = accountId

    start(async () => {
      try {
        const result = await saveImportRule(slug, {
          id: rule?.id ?? null,
          expectedUpdatedAt: rule?.updatedAt ?? null,
          source: 'bank_statement',
          priority: rule?.priority ?? 100,
          label: label.trim(),
          match,
          action,
          active,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setMessage(
            result.code === 'stale'
              ? 'Alguien cambió esta regla recién. Cerrá y abrila de nuevo.'
              : result.message,
          )
          return
        }
        toast.success(result.message)
        onSaved()
      } catch {
        setMessage('Sin conexión: no se guardó. Probá de nuevo.')
      }
    })
  }

  const field = (name: string) => `${base}-${name}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Editar la regla' : 'Nueva regla para el banco'}</DialogTitle>
          <DialogDescription>
            Cuando un movimiento del extracto cumple esto, lo cargamos así sin preguntarte.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={field('label')}>Para qué es</Label>
            <Input
              id={field('label')}
              value={label}
              maxLength={120}
              placeholder="Expensas del local"
              className="h-11 text-base md:h-10 md:text-sm"
              aria-invalid={errors.label ? true : undefined}
              onChange={(e) => setLabel(e.target.value)}
            />
            {errors.label ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.label}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={field('pattern')}>Si la descripción dice</Label>
            <Input
              id={field('pattern')}
              value={pattern}
              maxLength={200}
              placeholder="EXPENSAS"
              className="h-11 font-mono text-base md:h-10 md:text-sm"
              aria-invalid={errors['match.pattern'] || patternProblem ? true : undefined}
              aria-describedby={`${field('pattern')}-hint`}
              onChange={(e) => setPattern(e.target.value)}
            />
            <p id={`${field('pattern')}-hint`} className="text-xs text-muted-foreground">
              No importan mayúsculas ni tildes. {SAFE_PATTERN_HELP}
            </p>
            {errors['match.pattern'] || patternProblem ? (
              <p role="alert" className="text-xs text-destructive">
                {errors['match.pattern'] ?? patternProblem}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={field('cuit')}>
              CUIT de la otra parte{' '}
              <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id={field('cuit')}
              value={cuit}
              inputMode="numeric"
              maxLength={13}
              placeholder="30-12345678-9"
              className="h-11 text-base md:h-10 md:text-sm"
              aria-invalid={errors['match.counterparty_cuit'] ? true : undefined}
              onChange={(e) => setCuit(e.target.value)}
            />
            {errors['match.counterparty_cuit'] ? (
              <p role="alert" className="text-xs text-destructive">
                {errors['match.counterparty_cuit']}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <p id={field('direction')} className="text-sm font-medium">
              ¿Cuándo?
            </p>
            <ChoiceChips
              labelledBy={field('direction')}
              value={direction}
              onChange={setDirection}
              options={(['any', 'debit', 'credit'] as const).map((d) => ({
                value: d,
                label: RULE_DIRECTION_TEXT[d],
              }))}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={field('kind')}>Qué es</Label>
            <Select value={kind} onValueChange={(v) => isKind(v) && setKind(v)}>
              <SelectTrigger id={field('kind')} className={SELECT_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {BANK_RULE_KIND_TEXT[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === 'expense_component' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={field('component')}>Qué gasto o impuesto</Label>
              <Select value={component} onValueChange={setComponent}>
                <SelectTrigger id={field('component')} className={SELECT_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENTS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {BANK_EXPENSE_COMPONENT_TEXT[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {kind === 'transfer' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={field('treasury')}>¿A qué cuenta tuya pasa?</Label>
              <TreasurySelect
                id={field('treasury')}
                value={treasuryId}
                treasuries={options.treasuries}
                onValueChange={(id) => setTreasuryId(id)}
              />
            </div>
          ) : null}
          {kind === 'payment' || kind === 'collection' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={field('party')}>
                {kind === 'payment' ? '¿A quién le pagás?' : '¿Quién te paga?'}
              </Label>
              <PartyCombobox
                id={field('party')}
                value={partyId}
                parties={options.parties}
                placeholder="Elegí a quién"
                onValueChange={(id) => setPartyId(id)}
              />
            </div>
          ) : null}
          {kind === 'movement' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={field('account')}>¿A qué cuenta va?</Label>
              <AccountCombobox
                id={field('account')}
                value={accountId}
                accounts={options.accounts}
                onValueChange={(id) => setAccountId(id)}
              />
            </div>
          ) : null}
          {errors['action.kind'] ? (
            <p role="alert" className="text-xs text-destructive">
              {errors['action.kind']}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
            <Label htmlFor={field('active')} className="font-normal">
              Usar esta regla en las próximas importaciones
            </Label>
            <Switch id={field('active')} checked={active} onCheckedChange={setActive} />
          </div>

          {message ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {message}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" className="h-11 md:h-9" disabled={pending} onClick={submit}>
            {pending ? 'Guardando…' : 'Guardar la regla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
