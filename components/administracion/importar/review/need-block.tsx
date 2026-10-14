'use client'

import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { IIBB_JURISDICTIONS } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/jurisdictions'
import { supplierHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import {
  CategoryPicker,
  ChoiceCard,
  categoryOptions,
  featuredCategories,
  Pill,
} from '@/components/administracion/kit'
import { PartyCombobox } from '@/components/administracion/party-combobox'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WARNING_COPY } from '@/lib/accounting/errors'
import type { IvaCondition } from '@/lib/accounting/types'
import type { ImportNeed, OtherTaxesAs } from '@/lib/imports/server/types'
import {
  IVA_CONDITION_TEXT,
  partyKindsForRole,
  SUPPLIER_IVA_CONDITIONS,
} from '@/lib/imports/ui/labels'
import { otherTaxesChange } from '@/lib/imports/ui/payloads'
import {
  ANSWER,
  isBeforeStart,
  needLine,
  type QuestionCopy,
  questionFor,
} from '@/lib/imports/ui/review-copy'
import { ANSWER_BUTTON, QUIET_ANSWER, QuestionAnswers, QuestionCard } from './question-card'
import { useReview } from './review-context'
import type { ProposalView } from './types'
import { useRowActions } from './use-row-actions'

const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

/** Lo que rodea a la pregunta: lo pone quien la muestra (la hoja en la mano o un renglón abierto). */
export type QuestionFrame = {
  eyebrow?: ReactNode
  footer?: ReactNode
  /** Adentro de otra superficie (un renglón abierto de la lista). */
  inset?: boolean
  headingLevel?: 'h2' | 'h3'
  id?: string
  /** Para llevarle el foco cuando pasa a ser la primera. */
  tabIndex?: number
  /** Pasar a la siguiente sin contestar («No sé: lo dejo para después»). */
  onLater?: () => void
}

type Asked = { copy: QuestionCopy; frame: QuestionFrame; children?: ReactNode }

function Ask({ copy, frame, children, context }: Asked & { context?: ReactNode }) {
  const { onLater: _later, ...card } = frame
  return (
    <QuestionCard
      {...card}
      tone={copy.tone}
      question={copy.question}
      context={context ?? copy.context ?? undefined}
    >
      {children}
    </QuestionCard>
  )
}

/**
 * Lo que le falta a una hoja, como UNA pregunta con sus respuestas grandes («¿En
 * qué le comprás a…?», «¿Es el mismo o es otro?», «¿A quién le pagaste?»). Cada
 * respuesta manda el mismo cambio de siempre (`resolveImportNeeds`, uno por
 * toque) y la página se vuelve a armar sola.
 *
 * Quien solo lee no ve la pregunta: ve una línea gris con lo que falta, sin
 * ningún botón (`NeedLine`).
 */
export function NeedQuestion({
  p,
  need,
  frame = {},
}: {
  p: ProposalView
  need: ImportNeed
  frame?: QuestionFrame
}) {
  const { editable, options, slug, booksStartDate } = useReview()
  const partyName = (id: string | null | undefined) => {
    if (!id) return null
    const party = options?.parties.find((x) => x.id === id)
    return party ? (party.tradeName ?? party.name) : null
  }

  if (!editable || !options) return <NeedLine need={need} />

  const copy = questionFor(need, { partyName, totalCents: p.summary.total_cents, booksStartDate })

  switch (need.key) {
    case 'new_supplier':
      return (
        <Ask copy={copy} frame={frame}>
          <QuestionAnswers>
            <Button asChild variant="outline" className={`${ANSWER_BUTTON} gap-2`}>
              <a href="#proveedores-nuevos">
                Ir a «¿Los tenés de antes?»
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </Button>
          </QuestionAnswers>
        </Ask>
      )
    case 'supplier_account':
      return <SupplierAccount p={p} partyId={need.party_id} copy={copy} frame={frame} />
    case 'supplier_inactive':
      return (
        <Ask copy={copy} frame={frame}>
          <QuestionAnswers>
            <Button asChild variant="outline" className={ANSWER_BUTTON}>
              <Link href={supplierHref(slug, need.party_id)}>Abrir su ficha</Link>
            </Button>
          </QuestionAnswers>
        </Ask>
      )
    case 'condition_mismatch':
      return <ConditionMismatch p={p} need={need} copy={copy} frame={frame} />
    case 'other_taxes_as':
      return (
        <OtherTaxes
          p={p}
          need={need}
          partyName={partyName(need.party_id)}
          copy={copy}
          frame={frame}
        />
      )
    case 'foreign_currency':
      return (
        <Confirmable
          p={p}
          need="foreign_currency"
          confirmLabel="Sí, está bien"
          copy={copy}
          frame={frame}
        />
      )
    case 'possible_duplicate':
      return (
        <PossibleDuplicate
          p={p}
          label={need.label}
          documentId={need.document_id}
          copy={copy}
          frame={frame}
        />
      )
    case 'estimated_deductions':
      return (
        <Confirmable
          p={p}
          need="estimated_deductions"
          confirmLabel="Sí, están bien"
          copy={copy}
          frame={frame}
        />
      )
    case 'mp_invoice':
      return <MpInvoice p={p} copy={copy} frame={frame} />
    case 'channel_method':
      return <ChannelMethod p={p} channel={need.channel} copy={copy} frame={frame} />
    case 'pick_party':
      return (
        <PickParty
          p={p}
          role={need.role}
          suggested={need.suggested_party_id}
          suggestedName={partyName(need.suggested_party_id)}
          copy={copy}
          frame={frame}
        />
      )
    case 'pick_treasury':
      return <PickTreasury p={p} suggested={need.suggested_treasury_id} copy={copy} frame={frame} />
    case 'counterpart_account':
      return <PickAccount p={p} tax={null} copy={copy} frame={frame} />
    case 'unknown_tax':
      return <PickAccount p={p} tax={need.tax} copy={copy} frame={frame} />
    case 'accept_warning':
      return <AcceptWarning p={p} warnings={need.warnings} frame={frame} />
    case 'receipt':
      return <Receipt p={p} copy={copy} frame={frame} />
    case 'engine_error':
      return isBeforeStart(need) ? (
        <BeforeStart p={p} copy={copy} frame={frame} />
      ) : (
        <ManualOnly p={p} copy={copy} frame={frame} />
      )
    case 'manual':
      return <ManualOnly p={p} notOurs={need.reason === 'not_ours'} copy={copy} frame={frame} />
    default:
      return <ManualOnly p={p} copy={copy} frame={frame} />
  }
}

/** Para quien solo mira (la contadora): qué falta, en una línea gris y sin botones. */
export function NeedLine({ need }: { need: ImportNeed }) {
  const { options } = useReview()
  const partyName = (id: string | null | undefined) => {
    if (!id) return null
    const party = options?.parties.find((x) => x.id === id)
    return party ? (party.tradeName ?? party.name) : null
  }
  return (
    <p className="text-sm text-muted-foreground text-pretty">{needLine(need, { partyName })}</p>
  )
}

// ─── Cada pregunta ───────────────────────────────────────────────────────────

type Base = { p: ProposalView; copy: QuestionCopy; frame: QuestionFrame }

function SupplierAccount({ p, partyId, copy, frame }: Base & { partyId: string }) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const labelId = useId()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [fullPlan, setFullPlan] = useState(false)
  const accounts = options?.accounts ?? []
  const purchase = useMemo(
    () => new Set(accounts.filter((a) => a.purchase).map((a) => a.id)),
    [accounts],
  )
  const choices = useMemo(
    () => categoryOptions(accounts, (accId) => purchase.has(accId)),
    [accounts, purchase],
  )
  const featured = useMemo(() => featuredCategories(accounts), [accounts])
  const outside =
    accountId && !choices.some((o) => o.id === accountId)
      ? { id: accountId, name: accounts.find((a) => a.id === accountId)?.name ?? '' }
      : null
  return (
    <Ask copy={copy} frame={frame}>
      <span id={labelId} className="sr-only">
        {copy.question}
      </span>
      <CategoryPicker
        aria-labelledby={labelId}
        options={choices}
        value={accountId}
        onChange={(next) => setAccountId(next)}
        featured={featured}
        outside={outside}
        size="touch"
        onOpenFullPlan={() => setFullPlan(true)}
      />
      {fullPlan ? (
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor={id}>Buscar en el plan completo</Label>
          <AccountCombobox
            id={id}
            value={accountId}
            accounts={accounts}
            filter={(a) => purchase.has(a.id)}
            placeholder="Elegí en qué se gasta"
            onValueChange={(next) => setAccountId(next)}
          />
        </div>
      ) : null}
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={!accountId || busyKey === p.key}
          onClick={() =>
            accountId &&
            void resolve(p.key, [{ kind: 'supplier_account', partyId, accountId }], {
              success: 'Listo: quedó guardado en el proveedor.',
            })
          }
        >
          {ANSWER.save}
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function ConditionMismatch({
  p,
  need,
  copy,
  frame,
}: Base & { need: Extract<ImportNeed, { key: 'condition_mismatch' }> }) {
  const { resolve, busyKey } = useReview()
  const labelId = useId()
  const [condition, setCondition] = useState<IvaCondition>(
    need.suggested_condition ?? 'responsable_inscripto',
  )
  // La de la factura va primero (y ya elegida, como siempre).
  const order = need.suggested_condition
    ? [
        need.suggested_condition,
        ...SUPPLIER_IVA_CONDITIONS.filter((c) => c !== need.suggested_condition),
      ]
    : SUPPLIER_IVA_CONDITIONS
  return (
    <Ask copy={copy} frame={frame}>
      <span id={labelId} className="sr-only">
        Cómo factura
      </span>
      <fieldset
        aria-labelledby={labelId}
        className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
      >
        {order.map((c) => (
          <Pill
            key={c}
            size="touch"
            activeTone="brand"
            active={condition === c}
            onClick={() => setCondition(c)}
          >
            {IVA_CONDITION_TEXT[c]}
            {c === need.suggested_condition ? ' · según la factura' : ''}
          </Pill>
        ))}
      </fieldset>
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(
              p.key,
              [{ kind: 'supplier_condition', partyId: need.party_id, ivaCondition: condition }],
              { success: 'Listo: actualicé el proveedor.' },
            )
          }
        >
          Actualizar el proveedor
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

const OTHER_TAXES_CHOICES: ReadonlyArray<{ value: OtherTaxesAs; title: string; text: string }> = [
  {
    value: 'perc_iibb',
    title: 'Ingresos Brutos',
    text: 'Lo más común: la provincia te lo cobra por adelantado y después lo descontás.',
  },
  { value: 'perc_iva', title: 'IVA', text: 'Un adelanto de IVA que después descontás.' },
  {
    value: 'internal',
    title: 'Impuestos internos',
    text: 'Típico de bebidas con alcohol o gaseosas: va al costo.',
  },
  { value: 'account', title: 'Otra cosa', text: 'Elegís vos a dónde va.' },
]

function OtherTaxes({
  p,
  need,
  partyName,
  copy,
  frame,
}: Base & {
  need: Extract<ImportNeed, { key: 'other_taxes_as' }>
  partyName: string | null
}) {
  const { options, resolve, busyKey } = useReview()
  const base = useId()
  const [as, setAs] = useState<OtherTaxesAs | null>(null)
  const [jurisdiction, setJurisdiction] = useState<number>(options?.iibbJurisdictionCode ?? 904)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [remember, setRemember] = useState(need.party_id !== null)
  const ready = as !== null && (as !== 'account' || accountId !== null)

  const apply = () => {
    if (!as) return
    const change = otherTaxesChange({
      proposalKey: p.key,
      partyId: need.party_id,
      as,
      accountId,
      jurisdiction,
      remember,
    })
    void resolve(p.key, [change], {
      success: change.remember
        ? 'Listo: lo apliqué a todas sus facturas y lo recuerdo para la próxima.'
        : 'Listo, lo tuve en cuenta.',
    })
  }

  return (
    <Ask copy={copy} frame={frame}>
      <fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2">
        <legend className="sr-only">Qué son los otros impuestos</legend>
        {OTHER_TAXES_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.value}
            name={`${base}-as`}
            value={choice.value}
            checked={as === choice.value}
            onChange={() => setAs(choice.value)}
            title={choice.title}
            consequence={choice.text}
          />
        ))}
      </fieldset>
      {as === 'perc_iibb' ? (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor={`${base}-jur`}>¿De qué provincia?</Label>
          <Select value={String(jurisdiction)} onValueChange={(v) => setJurisdiction(Number(v))}>
            <SelectTrigger id={`${base}-jur`} className={SELECT_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IIBB_JURISDICTIONS.map((j) => (
                <SelectItem key={j.code} value={String(j.code)}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {as === 'account' ? (
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor={`${base}-acc`}>¿Dónde lo anoto?</Label>
          <AccountCombobox
            id={`${base}-acc`}
            value={accountId}
            accounts={options?.accounts ?? []}
            onValueChange={(next) => setAccountId(next)}
          />
        </div>
      ) : null}
      {need.party_id ? (
        // Con aire arriba: pegada a la última tarjeta parecía parte de «Otra cosa». El
        // `m-0` del fieldset anula el `space-y` del contenedor: el aire va entero acá.
        <div className="flex items-start gap-2.5 pt-4">
          <Checkbox
            id={`${base}-rem`}
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={`${base}-rem`} className="font-normal leading-snug">
            Hacer lo mismo con todas las de {partyName ?? 'este proveedor'}, también las próximas
          </Label>
        </div>
      ) : null}
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={!ready || busyKey === p.key}
          onClick={apply}
        >
          {ANSWER.save}
        </Button>
        {frame.onLater ? (
          <button type="button" className={QUIET_ANSWER} onClick={frame.onLater}>
            {ANSWER.later}
          </button>
        ) : null}
      </QuestionAnswers>
      <p className="text-xs text-muted-foreground">Si no sabés, preguntale a tu contadora.</p>
    </Ask>
  )
}

function Confirmable({
  p,
  need,
  confirmLabel,
  copy,
  frame,
}: Base & {
  need: 'foreign_currency' | 'possible_duplicate' | 'estimated_deductions'
  confirmLabel: string
}) {
  const { resolve, busyKey } = useReview()
  return (
    <Ask copy={copy} frame={frame}>
      <QuestionAnswers>
        <Button
          type="button"
          className={`${ANSWER_BUTTON} gap-2`}
          disabled={busyKey === p.key}
          onClick={() => void resolve(p.key, [{ kind: 'confirm', proposalKey: p.key, need }])}
        >
          <Check className="size-4" aria-hidden />
          {confirmLabel}
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function PossibleDuplicate({
  p,
  label,
  documentId,
  copy,
  frame,
}: Base & { label: string; documentId: string }) {
  const { resolve, busyKey, slug } = useReview()
  const { ignore } = useRowActions()
  return (
    <Ask
      copy={copy}
      frame={frame}
      context={
        <>
          Ya cargaste{' '}
          <Link
            href={`/${slug}/administracion/comprobantes/${documentId}`}
            className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label} ↗
          </Link>{' '}
          con el mismo proveedor y el mismo total.
        </>
      }
    >
      <QuestionAnswers>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void ignore(p, 'Ya estaba cargado', 'Listo: no se carga dos veces.')}
        >
          {ANSWER.same}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(p.key, [
              { kind: 'confirm', proposalKey: p.key, need: 'possible_duplicate' },
            ])
          }
        >
          {ANSWER.other}
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function MpInvoice({ p, copy, frame }: Base) {
  const { resolve, busyKey } = useReview()
  const answer = (value: boolean) =>
    void resolve(p.key, [{ kind: 'settles_commissions', proposalKey: p.key, value }])
  return (
    <Ask copy={copy} frame={frame}>
      <QuestionAnswers>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => answer(true)}
        >
          Sí, es la de comisiones
        </Button>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => answer(false)}
        >
          No, es otra compra
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

/** Cuántos medios del cierre se ofrecen como píldora antes de «Otro…». */
const METHOD_PILLS = 5

function ChannelMethod({
  p,
  channel,
  copy,
  frame,
}: Base & { channel: Extract<ImportNeed, { key: 'channel_method' }>['channel'] }) {
  const { options, resolve, busyKey } = useReview()
  const labelId = useId()
  const [methodId, setMethodId] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const methods = options?.methods ?? []
  const first = methods.slice(0, METHOD_PILLS)
  const extra =
    methodId && !first.some((m) => m.id === methodId)
      ? (methods.find((m) => m.id === methodId) ?? null)
      : null
  return (
    <Ask copy={copy} frame={frame}>
      <span id={labelId} className="sr-only">
        Medio del cierre del día
      </span>
      <fieldset
        aria-labelledby={labelId}
        className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
      >
        {first.map((m) => (
          <Pill
            key={m.id}
            size="touch"
            activeTone="brand"
            active={methodId === m.id}
            onClick={() => setMethodId(m.id)}
          >
            {m.name}
          </Pill>
        ))}
        {extra ? (
          <Pill size="touch" activeTone="brand" active>
            {extra.name}
          </Pill>
        ) : null}
        {methods.length > first.length ? (
          <Pill size="touch" aria-expanded={more} onClick={() => setMore((v) => !v)}>
            Otro…
          </Pill>
        ) : null}
      </fieldset>
      {more ? (
        <Select
          value={methodId ?? undefined}
          onValueChange={(next) => {
            setMethodId(next)
            setMore(false)
          }}
        >
          <SelectTrigger
            aria-label="Otro medio del cierre"
            className={`${SELECT_CLASS} sm:max-w-xs`}
          >
            <SelectValue placeholder="Elegí el medio de cobro" />
          </SelectTrigger>
          <SelectContent>
            {methods.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={!methodId || busyKey === p.key}
          onClick={() =>
            methodId &&
            void resolve(p.key, [{ kind: 'channel_method', channel, salesMethodId: methodId }], {
              success: 'Listo: lo guardé para las próximas.',
            })
          }
        >
          {ANSWER.save}
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function PickParty({
  p,
  role,
  suggested,
  suggestedName,
  copy,
  frame,
}: Base & {
  role: Extract<ImportNeed, { key: 'pick_party' }>['role']
  suggested: string | null
  suggestedName: string | null
}) {
  const { options, resolve, busyKey, source, setTeach } = useReview()
  const id = useId()
  const hasSuggestion = suggested !== null && suggestedName !== null
  const [other, setOther] = useState(!hasSuggestion)
  const [partyId, setPartyId] = useState<string | null>(null)
  const kinds = useMemo(() => partyKindsForRole(role), [role])
  const parties = useMemo(
    () => (options?.parties ?? []).filter((x) => !kinds || kinds.includes(x.kind)),
    [options, kinds],
  )
  const pick = (chosen: string) =>
    void resolve(p.key, [{ kind: 'pick_party', proposalKey: p.key, partyId: chosen }])
  const direction = p.summary.detail?.direction
  return (
    <Ask copy={copy} frame={frame}>
      {hasSuggestion ? (
        <QuestionAnswers>
          <Button
            type="button"
            variant="outline"
            className={ANSWER_BUTTON}
            disabled={busyKey === p.key}
            onClick={() => suggested && pick(suggested)}
          >
            Sí: es {suggestedName}
          </Button>
          {!other ? (
            <Button
              type="button"
              variant="outline"
              className={ANSWER_BUTTON}
              onClick={() => setOther(true)}
            >
              Es otro…
            </Button>
          ) : null}
        </QuestionAnswers>
      ) : null}
      {other ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5 sm:max-w-md">
            <Label htmlFor={id} className="sr-only">
              {copy.question}
            </Label>
            <PartyCombobox
              id={id}
              value={partyId}
              parties={parties.length > 0 ? parties : (options?.parties ?? [])}
              placeholder="Elegí a quién"
              onValueChange={(next) => setPartyId(next)}
            />
          </div>
          <Button
            type="button"
            className={ANSWER_BUTTON}
            disabled={!partyId || busyKey === p.key}
            onClick={() => partyId && pick(partyId)}
          >
            {ANSWER.pick}
          </Button>
        </div>
      ) : null}
      {source === 'bank_statement' ? (
        <button
          type="button"
          className={QUIET_ANSWER}
          onClick={() =>
            setTeach({
              label: p.summary.label.slice(0, 120),
              pattern: p.summary.label.slice(0, 200),
              direction:
                direction === 'credit' ? 'credit' : direction === 'debit' ? 'debit' : 'any',
              kind: direction === 'credit' ? 'collection' : 'payment',
            })
          }
        >
          ¿Pasa todas las semanas? Enseñame a reconocerlo
        </button>
      ) : null}
    </Ask>
  )
}

function PickTreasury({ p, suggested, copy, frame }: Base & { suggested: string | null }) {
  const { options, resolve, busyKey } = useReview()
  const labelId = useId()
  const [treasuryId, setTreasuryId] = useState<string | null>(null)
  return (
    <Ask copy={copy} frame={frame}>
      <span id={labelId} className="sr-only">
        {copy.question}
      </span>
      <TreasuryPicker
        aria-labelledby={labelId}
        value={treasuryId}
        treasuries={options?.treasuries ?? []}
        suggestedId={suggested}
        onValueChange={(next) => setTreasuryId(next)}
      />
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={!treasuryId || busyKey === p.key}
          onClick={() =>
            treasuryId &&
            void resolve(p.key, [
              { kind: 'pick_treasury', proposalKey: p.key, treasuryAccountId: treasuryId },
            ])
          }
        >
          {ANSWER.pick}
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function PickAccount({ p, tax, copy, frame }: Base & { tax: string | null }) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [accountId, setAccountId] = useState<string | null>(null)
  const notTreasury = useMemo(
    () => new Set((options?.accounts ?? []).filter((a) => !a.treasury).map((a) => a.id)),
    [options],
  )
  return (
    <Ask copy={copy} frame={frame}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5 sm:max-w-md">
          <Label htmlFor={id} className="sr-only">
            {copy.question}
          </Label>
          <AccountCombobox
            id={id}
            value={accountId}
            accounts={options?.accounts ?? []}
            filter={(a) => notTreasury.has(a.id)}
            placeholder="Buscá qué fue"
            onValueChange={(next) => setAccountId(next)}
          />
        </div>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={!accountId || busyKey === p.key}
          onClick={() =>
            accountId &&
            void resolve(p.key, [{ kind: 'pick_account', proposalKey: p.key, accountId, tax }])
          }
        >
          {ANSWER.pick}
        </Button>
      </div>
    </Ask>
  )
}

/** Los avisos se aceptan de a uno: se muestra el primero y, al aceptarlo, el que sigue. */
function AcceptWarning({
  p,
  warnings,
  frame,
}: {
  p: ProposalView
  warnings: Extract<ImportNeed, { key: 'accept_warning' }>['warnings']
  frame: QuestionFrame
}) {
  const { resolve, busyKey } = useReview()
  const warning = warnings[0]
  if (!warning) return null
  const { onLater: _later, ...card } = frame
  return (
    <QuestionCard
      {...card}
      question={WARNING_COPY[warning].fallback}
      context={
        warnings.length > 1
          ? `Después vas a ver ${warnings.length - 1 === 1 ? 'un aviso más' : `${warnings.length - 1} avisos más`} de esta hoja.`
          : undefined
      }
    >
      <QuestionAnswers>
        <Button
          type="button"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(p.key, [{ kind: 'accept_warning', proposalKey: p.key, warning }])
          }
        >
          {WARNING_COPY[warning].confirmLabel}
        </Button>
      </QuestionAnswers>
    </QuestionCard>
  )
}

function Receipt({ p, copy, frame }: Base) {
  const { busyKey } = useReview()
  const { ignore, loadByHand } = useRowActions()
  return (
    <Ask copy={copy} frame={frame}>
      <QuestionAnswers>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void ignore(p, 'Recibo de una factura ya cargada', 'Listo: el recibo no se carga.')
          }
        >
          Sí: no lo cargues
        </Button>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void loadByHand(p)}
        >
          No, es un gasto: lo cargo a mano
        </Button>
      </QuestionAnswers>
    </Ask>
  )
}

function ManualOnly({ p, notOurs = false, copy, frame }: Base & { notOurs?: boolean }) {
  const { busyKey } = useReview()
  const { ignore, loadByHand } = useRowActions()
  return (
    <Ask copy={copy} frame={frame}>
      <QuestionAnswers>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void loadByHand(p)}
        >
          {ANSWER.byHand}
        </Button>
        {notOurs ? (
          <Button
            type="button"
            variant="outline"
            className={ANSWER_BUTTON}
            disabled={busyKey === p.key}
            onClick={() => void ignore(p, 'No es de la SAS')}
          >
            {ANSWER.notOurs}
          </Button>
        ) : null}
      </QuestionAnswers>
    </Ask>
  )
}

/**
 * Lo anterior a la fecha de arranque: el motor lo rechaza, así que «Cargarlo a
 * mano» chocaría con lo mismo. La salida es sacarlo de este archivo (el mismo
 * `ignore` con el motivo «Se carga a mano», sin abrir un formulario).
 */
function BeforeStart({ p, copy, frame }: Base) {
  const { busyKey, slug } = useReview()
  const { ignore } = useRowActions()
  return (
    <Ask copy={copy} frame={frame}>
      <QuestionAnswers>
        <Button
          type="button"
          variant="outline"
          className={ANSWER_BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void ignore(p, 'Se carga a mano', 'Listo: lo saqué de este archivo.')}
        >
          {ANSWER.takeOut}
        </Button>
        <Link href={`/${slug}/administracion/configurar`} className={QUIET_ANSWER}>
          Ir a los saldos iniciales
        </Link>
      </QuestionAnswers>
    </Ask>
  )
}
