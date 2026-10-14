'use client'

import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { StatusPill } from '@/components/administracion/kit'
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
import { type RuleDraft, ruleInput } from '@/lib/imports/ui/payloads'
import { cn } from '@/lib/utils'

/** Algo que el bar le enseñó al banco, como lo arma la página desde `listImportRules`. */
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

/** Algo que el bar le enseñó a ARCA («Hacer lo mismo con todas las de {proveedor}»). */
export type ArcaRuleView = {
  id: string
  label: string
  /** Lo que hace, ya en palabras: «son Ingresos Brutos de Córdoba». */
  does: string
  active: boolean
}

export type RuleOptions = {
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

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** Lo que hace, con los nombres de verdad: «es un pago a **Administración**». */
function actionWords(rule: BankRuleView, options: RuleOptions): ReactNode {
  if (!isKind(rule.kind)) return 'hace algo que no conozco'
  switch (rule.kind) {
    case 'expense_component':
      return rule.component && rule.component in BANK_EXPENSE_COMPONENT_TEXT
        ? `es ${lowerFirst(BANK_EXPENSE_COMPONENT_TEXT[rule.component as BankExpenseComponent])}`
        : 'es un gasto o impuesto del banco'
    case 'transfer': {
      const t = options.treasuries.find((x) => x.id === rule.treasuryId)
      return t ? (
        <>
          pasa a <strong className="font-semibold">{t.name}</strong>
        </>
      ) : (
        'pasa a otra cuenta tuya'
      )
    }
    case 'payment':
    case 'collection': {
      const p = options.parties.find((x) => x.id === rule.partyId)
      const lead = rule.kind === 'payment' ? 'es un pago a' : 'es un cobro de'
      return p ? (
        <>
          {lead} <strong className="font-semibold">{p.tradeName ?? p.name}</strong>
        </>
      ) : (
        `${lead} alguien que ya no está`
      )
    }
    case 'movement': {
      const a = options.accounts.find((x) => x.id === rule.accountId)
      return a ? (
        <>
          va a <strong className="font-semibold">{a.name}</strong>
        </>
      ) : (
        'va a una categoría que elegiste'
      )
    }
    case 'ignore':
      return 'no es nuestro: no se carga'
    default:
      return 'te lo pregunto cada vez'
  }
}

/** Cuándo se aplica: «Cuando dice **EXPENSAS** y sale plata». */
function matchWords(rule: BankRuleView): ReactNode {
  const side =
    rule.direction === 'debit'
      ? ' y sale plata'
      : rule.direction === 'credit'
        ? ' y entra plata'
        : ''
  if (rule.pattern) {
    return (
      <>
        Cuando dice <strong className="font-semibold break-all">{rule.pattern}</strong>
        {side}
      </>
    )
  }
  if (rule.counterpartyCuit)
    return `Cuando el CUIT de la otra parte es ${rule.counterpartyCuit}${side}`
  return `En cualquier movimiento${side}`
}

/** Un bloque plegado que se abre solo si la URL trae su ancla (`#aprendido`). */
function LearnedFrame({
  count,
  children,
}: {
  /** Cuántas cosas enseñó el bar. */
  count: number
  children: ReactNode
}) {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === '#aprendido') setOpen(true)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return (
    <section
      id="aprendido"
      aria-labelledby={titleId}
      className="card-hairline scroll-mt-28 rounded-2xl border bg-card shadow-xs"
    >
      <h2 id={titleId}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="font-serif text-lg font-semibold leading-snug tracking-tight">
              Lo que ya sé reconocer
            </span>
            {count > 0 ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {count === 1 ? '1 cosa tuya' : `${count} cosas tuyas`}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
      </h2>
      {open ? <div className="border-t border-border/60 px-4 py-4 sm:px-5">{children}</div> : null}
    </section>
  )
}

function DeleteDialog({
  label,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  label: string | null
  open: boolean
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Borrás «{label}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Lo que ya se cargó no cambia. En las próximas subidas te lo vuelvo a preguntar (o lo
            reconozco con lo que ya sé de fábrica).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9">Volver</AlertDialogCancel>
          <AlertDialogAction
            className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? 'Borrando…' : 'Sí, borrarlo'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Borrar algo enseñado (`deleteImportRule`), con su aviso. */
function useDeleteRule(slug: string, onDone: () => void) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const remove = (ruleId: string) => {
    start(async () => {
      try {
        const result = await deleteImportRule(slug, { ruleId })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(result.message)
        onDone()
        router.refresh()
      } catch {
        toast.error('Sin conexión: no se borró. Probá de nuevo.')
      }
    })
  }
  return { pending, remove }
}

/**
 * «Lo que ya sé reconocer» del banco: además de lo de fábrica (comisiones,
 * impuestos, transferencias entre tus cuentas, pagos de tarjeta y sueldos), lo
 * que el bar enseñó. Cada cosa es una oración («Cuando dice EXPENSAS y sale
 * plata → es un pago a Administración»), no una fila de tabla.
 *
 * Plegado al pie de la subida: se consulta, no se usa todas las semanas. Las
 * acciones son las de siempre (`saveImportRule`, `deleteImportRule`).
 */
export function BankRulesCard({
  slug,
  rules,
  options,
}: {
  slug: string
  rules: BankRuleView[]
  options: RuleOptions
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<BankRuleView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BankRuleView | null>(null)
  const { pending, remove } = useDeleteRule(slug, () => setDeleting(null))

  return (
    <LearnedFrame count={rules.length}>
      <p className="text-sm text-muted-foreground text-pretty">
        Comisiones, impuestos, transferencias entre tus cuentas, pagos de tarjeta y sueldos ya los
        reconozco. Lo tuyo me lo enseñás una vez.
      </p>
      {rules.length > 0 ? (
        <ul className="mt-3 divide-y divide-border/60">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-pretty leading-snug">
                  {matchWords(rule)} <span aria-hidden>→</span> {actionWords(rule, options)}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="[overflow-wrap:anywhere]">{rule.label}</span>
                  {!rule.active ? <StatusPill tone="muted">En pausa</StatusPill> : null}
                  {!rule.serverSafe ? <StatusPill tone="warn">No se aplica</StatusPill> : null}
                </p>
                {!rule.serverSafe ? (
                  <p className="text-xs text-warning-text">
                    El texto a buscar usa signos que no puedo leer. {SAFE_PATTERN_HELP}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 gap-2 sm:flex-none md:pointer-fine:h-9"
                  onClick={() => setEditing(rule)}
                >
                  <Pencil className="size-4" aria-hidden />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 gap-2 text-destructive hover:text-destructive sm:flex-none md:pointer-fine:h-9"
                  onClick={() => setDeleting(rule)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Borrar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="mt-3 h-11 w-full gap-2 sm:w-auto"
        onClick={() => setEditing('new')}
      >
        <Plus className="size-4" aria-hidden />
        Enseñarme algo nuevo
      </Button>

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
      <DeleteDialog
        label={deleting?.label ?? null}
        open={deleting !== null}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting.id)}
      />
    </LearnedFrame>
  )
}

/**
 * «Lo que ya sé reconocer» de ARCA: lo que se guarda con «Hacer lo mismo con
 * todas las de {proveedor}» en la revisión. Antes no tenía pantalla: se podía
 * crear y no se podía ver ni borrar. Solo se monta si hay alguna.
 */
export function ArcaRulesCard({ slug, rules }: { slug: string; rules: ArcaRuleView[] }) {
  const [deleting, setDeleting] = useState<ArcaRuleView | null>(null)
  const { pending, remove } = useDeleteRule(slug, () => setDeleting(null))
  if (rules.length === 0) return null
  return (
    <LearnedFrame count={rules.length}>
      <p className="text-sm text-muted-foreground text-pretty">
        Lo que me enseñaste al contestar «¿Qué son estos otros impuestos?». Lo aplico solo a las
        facturas de ese proveedor.
      </p>
      <ul className="mt-3 divide-y divide-border/60">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-pretty leading-snug">
              <span className="[overflow-wrap:anywhere]">{rule.label}</span>{' '}
              <span aria-hidden>→</span> {rule.does}
              {!rule.active ? (
                <>
                  {' '}
                  <StatusPill tone="muted">En pausa</StatusPill>
                </>
              ) : null}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 text-destructive hover:text-destructive md:pointer-fine:h-9"
              onClick={() => setDeleting(rule)}
            >
              <Trash2 className="size-4" aria-hidden />
              Borrar
            </Button>
          </li>
        ))}
      </ul>
      <DeleteDialog
        label={deleting?.label ?? null}
        open={deleting !== null}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting.id)}
      />
    </LearnedFrame>
  )
}

/**
 * «Enseñarme algo nuevo» (o cambiar algo ya enseñado). `initial` precarga el
 * diálogo cuando se abre desde una pregunta de la revisión («¿Pasa todas las
 * semanas? Enseñame a reconocerlo»): la descripción y el sentido ya vienen.
 */
export function RuleDialog({
  slug,
  rule,
  initial,
  options,
  onClose,
  onSaved,
}: {
  slug: string
  rule: BankRuleView | null
  initial?: Partial<RuleDraft>
  options: RuleOptions
  onClose: () => void
  onSaved: () => void
}) {
  const base = useId()
  const [pending, start] = useTransition()
  const [label, setLabel] = useState(rule?.label ?? initial?.label ?? '')
  const [pattern, setPattern] = useState(rule?.pattern ?? initial?.pattern ?? '')
  const [cuit, setCuit] = useState(rule?.counterpartyCuit ?? initial?.cuit ?? '')
  const [direction, setDirection] = useState<'any' | 'credit' | 'debit'>(
    rule?.direction ?? initial?.direction ?? 'any',
  )
  const [kind, setKind] = useState<BankRuleKind>(
    rule && isKind(rule.kind) ? rule.kind : (initial?.kind ?? 'expense_component'),
  )
  const [component, setComponent] = useState<string>(
    rule?.component ?? initial?.component ?? 'comisiones',
  )
  const [accountId, setAccountId] = useState<string | null>(
    rule?.accountId ?? initial?.accountId ?? null,
  )
  const [partyId, setPartyId] = useState<string | null>(rule?.partyId ?? initial?.partyId ?? null)
  const [treasuryId, setTreasuryId] = useState<string | null>(
    rule?.treasuryId ?? initial?.treasuryId ?? null,
  )
  const [active, setActive] = useState(rule?.active ?? initial?.active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const trimmedPattern = pattern.trim()
  const patternProblem =
    trimmedPattern !== '' && !isSafePattern(trimmedPattern) ? SAFE_PATTERN_HELP : null
  const cuitDigits = cuit.replace(/\D/g, '')

  const submit = () => {
    const local: Record<string, string> = {}
    if (label.trim().length < 2) local.label = 'Ponele un nombre para encontrarla después.'
    if (trimmedPattern === '' && cuitDigits === '') {
      local['match.pattern'] = 'Escribí qué dice la descripción (o el CUIT de la otra parte).'
    }
    if (patternProblem) local['match.pattern'] = patternProblem
    if (cuitDigits !== '' && cuitDigits.length !== 11)
      local['match.counterparty_cuit'] = 'Revisá el CUIT: son 11 números.'
    if (kind === 'transfer' && !treasuryId)
      local['action.kind'] = 'Elegí a qué cuenta pasa la plata.'
    if ((kind === 'payment' || kind === 'collection') && !partyId)
      local['action.kind'] = 'Elegí a quién.'
    if (kind === 'movement' && !accountId) local['action.kind'] = 'Elegí dónde va.'
    setErrors(local)
    setMessage(null)
    if (Object.keys(local).length > 0) return

    start(async () => {
      try {
        const result = await saveImportRule(
          slug,
          ruleInput(rule, {
            label,
            pattern,
            cuit,
            direction,
            kind,
            component,
            accountId,
            partyId,
            treasuryId,
            active,
          }),
        )
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setMessage(
            result.code === 'stale'
              ? 'Alguien cambió esto recién. Cerrá y abrilo de nuevo.'
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
          <DialogTitle>{rule ? 'Cambiar lo que me enseñaste' : 'Enseñarme algo nuevo'}</DialogTitle>
          <DialogDescription>
            Cuando un movimiento del banco cumple esto, lo armo así sin preguntarte.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={field('label')}>¿Cómo la llamamos?</Label>
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
            <Label htmlFor={field('pattern')}>Cuando la descripción dice</Label>
            <Input
              id={field('pattern')}
              value={pattern}
              maxLength={200}
              placeholder="EXPENSAS"
              className="h-11 text-base md:h-10 md:text-sm"
              aria-invalid={errors['match.pattern'] || patternProblem ? true : undefined}
              aria-describedby={`${field('pattern')}-hint`}
              onChange={(e) => setPattern(e.target.value)}
            />
            <p id={`${field('pattern')}-hint`} className="text-xs text-muted-foreground">
              Una o dos palabras que aparezcan siempre, por ejemplo EXPENSAS. No importan mayúsculas
              ni tildes.
            </p>
            {errors['match.pattern'] || patternProblem ? (
              <p role="alert" className="text-xs text-destructive">
                {errors['match.pattern'] ?? patternProblem}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={field('cuit')}>
              O cuando el CUIT de la otra parte es{' '}
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
              ¿Cuando entra o cuando sale?
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
            <p id={field('kind')} className="text-sm font-medium">
              Entonces es…
            </p>
            <ChoiceChips
              labelledBy={field('kind')}
              value={kind}
              onChange={setKind}
              options={KINDS.map((k) => ({ value: k, label: BANK_RULE_KIND_TEXT[k] }))}
            />
          </div>

          {kind === 'expense_component' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={field('component')}>¿Qué gasto o impuesto?</Label>
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
              <Label htmlFor={field('account')}>¿Dónde va?</Label>
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

          <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2">
            <Label htmlFor={field('active')} className="font-normal">
              Usarla en las próximas subidas
            </Label>
            <Switch id={field('active')} checked={active} onCheckedChange={setActive} />
          </div>

          {message ? (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {message}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" className="h-11 md:h-9" disabled={pending} onClick={submit}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
