'use client'

import { History, TriangleAlert, X } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { guardQuestion, type PriceJump } from '@/lib/menu/prices/guard'
import { highlightRanges } from '@/lib/menu/prices/search'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { type CommitOutcome, type CommitVia, PriceField } from './price-field'

/** Una pregunta abierta sobre un precio: «¿$ 12 o $ 12.000?». Nada se guardó todavía. */
export type GuardState = {
  jump: Extract<PriceJump, { kind: 'confirm' }>
  /** Lo que costaba cuando se preguntó. */
  oldCents: number
  /** Cómo se salió del campo: con el teclado, el foco va a la respuesta y después sigue de largo. */
  via: CommitVia
}

/** Lo buscado, resaltado dentro del texto. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (query === '') return text
  const ranges = highlightRanges(text, query)
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={start} className="rounded-[3px] bg-warning/30 text-inherit">
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

/** Un clic que vino del teclado (Enter o espacio sobre el botón) no trae coordenadas. */
const fromKeyboard = (event: MouseEvent) => event.detail === 0

/**
 * La pregunta de los ceros, en el mismo renglón: lo que se tipeó y lo que probablemente se
 * quiso tipear, cada uno a un toque. Mientras está abierta, el precio sigue como estaba.
 */
function GuardPrompt({
  itemId,
  name,
  guard,
  onPick,
}: {
  itemId: string
  name: string
  guard: GuardState
  onPick: (itemId: string, cents: number | null, byKeyboard: boolean) => void
}) {
  const primary = useRef<HTMLButtonElement>(null)
  const { jump, oldCents, via } = guard
  // Con el teclado, la respuesta más probable queda a un Enter. Si se salió tocando otra
  // cosa, el foco no se mueve: la persona ya está en otro lado.
  useEffect(() => {
    if (via !== 'blur') primary.current?.focus()
  }, [via])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onPick(itemId, null, true)
  }

  const typed = formatCentsShort(jump.typedCents)
  const tall = 'h-11 px-4 text-sm tabular-nums sm:h-9'

  return (
    // biome-ignore lint/a11y/useSemanticElements: es un grupo de botones dentro de un renglón de la lista, no un formulario.
    <div
      role="group"
      aria-label={`Confirmar el precio de ${name}`}
      data-testid="price-guard"
      onKeyDown={onKeyDown}
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2.5"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning-text" />
      <p role="alert" className="min-w-0 flex-1 basis-48 text-sm text-pretty">
        {/* Sobre un fondo teñido, el texto secundario sale de la tinta, no del gris. */}
        <span className="text-foreground/75">Costaba {formatCentsShort(oldCents)}.</span>{' '}
        <strong className="font-semibold">{guardQuestion(jump)}</strong>
      </p>
      <div className="flex items-center gap-2">
        {jump.suggestedCents === null ? (
          <>
            <Button
              ref={primary}
              type="button"
              data-price-guard=""
              data-testid="guard-keep"
              className={tall}
              onClick={(event) => onPick(itemId, null, fromKeyboard(event))}
            >
              No, dejar {formatCentsShort(oldCents)}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-price-guard=""
              data-testid="guard-typed"
              className={tall}
              onClick={(event) => onPick(itemId, jump.typedCents, fromKeyboard(event))}
            >
              Sí, {typed}
            </Button>
          </>
        ) : (
          <>
            <Button
              ref={primary}
              type="button"
              data-price-guard=""
              data-testid="guard-suggested"
              className={tall}
              onClick={(event) => onPick(itemId, jump.suggestedCents, fromKeyboard(event))}
            >
              {formatCentsShort(jump.suggestedCents)}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-price-guard=""
              data-testid="guard-typed"
              className={tall}
              onClick={(event) => onPick(itemId, jump.typedCents, fromKeyboard(event))}
            >
              {typed}
            </Button>
            <button
              type="button"
              data-price-guard=""
              data-testid="guard-dismiss"
              aria-label={`Dejar ${name} en ${formatCentsShort(oldCents)}`}
              onClick={(event) => onPick(itemId, null, fromKeyboard(event))}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
            >
              <X aria-hidden className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export type PriceRowProps = {
  itemId: string
  name: string
  /** En una búsqueda: el camino de la categoría («Comida › Hamburguesas»). */
  path: string | null
  query: string
  /** El producto está pausado en la carta. */
  paused: boolean
  /** Lo que se cobra donde se está mirando. */
  effectiveCents: number
  menuCents: number
  /** El precio propio de la sucursal que se mira (si tiene). */
  ownCents: number | null
  /** Si se vende en la sucursal que se mira. */
  available: boolean
  saving: boolean
  /** La sucursal que se mira; vacío en «Toda la carta». */
  branchName: string | null
  branchColor: string | null
  guard: GuardState | undefined
  error: string | undefined
  onCommit: (itemId: string, cents: number, via: CommitVia) => CommitOutcome
  onCancel: (itemId: string) => void
  onGuardPick: (itemId: string, cents: number | null, byKeyboard: boolean) => void
  onHistory: (itemId: string) => void
  onReset: (itemId: string) => void
  onAvailable: (itemId: string, available: boolean) => void
}

/**
 * Un producto: el nombre, dónde está (en una búsqueda) y el PRECIO, que es lo que se toca.
 * En una sucursal suma si se vende ahí y, si tiene precio propio, cómo volver al de la carta.
 */
export const PriceRow = memo(function PriceRow({
  itemId,
  name,
  path,
  query,
  paused,
  effectiveCents,
  menuCents,
  ownCents,
  available,
  saving,
  branchName,
  branchColor,
  guard,
  error,
  onCommit,
  onCancel,
  onGuardPick,
  onHistory,
  onReset,
  onAvailable,
}: PriceRowProps) {
  const nameId = useId()
  const soldId = useId()
  const switchId = useId()
  const noteId = useId()
  const inBranch = branchName !== null
  const hasOwnPrice = inBranch && ownCents !== null

  return (
    <li data-testid="price-row" data-item={itemId} className="px-3 py-2 sm:px-4 sm:py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
        <div className="order-1 min-w-0 flex-1 py-0.5">
          <p
            className={cn(
              'text-[15px] leading-snug font-medium [overflow-wrap:anywhere]',
              !available && 'text-muted-foreground',
            )}
          >
            <span id={nameId}>
              <Highlight text={name} query={query} />
            </span>
            {paused ? (
              <StatusPill tone="muted" className="ml-2 align-[1px]">
                Pausado
              </StatusPill>
            ) : null}
            {available ? null : (
              <StatusPill tone="muted" className="ml-2 align-[1px]">
                No se vende acá
              </StatusPill>
            )}
          </p>
          {path ? (
            <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <Highlight text={path} query={query} />
            </p>
          ) : null}
        </div>

        {inBranch ? (
          // En el celular va adelante del nombre, en el mismo renglón (233 renglones de dos
          // líneas eran el doble de pantalla); en la compu, en su columna. El área que se toca
          // es solo la del interruptor: un renglón entero tocable se apagaba al deslizar.
          <label
            htmlFor={switchId}
            className="order-0 flex min-h-11 shrink-0 cursor-pointer items-center pr-1 sm:order-2 sm:min-h-0 sm:w-24 sm:justify-center sm:pr-0"
          >
            <Switch
              id={switchId}
              checked={available}
              onCheckedChange={(next) => onAvailable(itemId, next)}
              aria-labelledby={`${nameId} ${soldId}`}
              data-testid="available-switch"
            />
            {/* El rótulo a la vista está una vez: arriba de la lista (celular) o de la columna (compu). */}
            <span id={soldId} className="sr-only">
              Se vende en {branchName}
            </span>
          </label>
        ) : null}

        <div className="order-2 sm:order-3">
          <PriceField
            itemId={itemId}
            label={`Precio de ${name}${inBranch ? ` en ${branchName}` : ''}, en pesos`}
            cents={effectiveCents}
            saving={saving}
            disabled={!available}
            flagged={guard !== undefined || error !== undefined}
            describedBy={error ? noteId : undefined}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        </div>

        <button
          type="button"
          data-testid="history-button"
          aria-label={`Historial de precios de ${name}`}
          onClick={() => onHistory(itemId)}
          className="order-3 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 sm:order-4"
        >
          <History aria-hidden className="size-4" />
        </button>

        {hasOwnPrice ? (
          // En su propio renglón, a todo el ancho: adentro de la columna del nombre, en el
          // celular quedaba en una tira de 120 px y el renglón medía el triple.
          <p className="order-5 flex basis-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="adm-status inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 leading-none font-medium whitespace-nowrap">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={branchColor ? { backgroundColor: branchColor } : undefined}
              />
              Precio propio
            </span>
            <span className="tabular-nums">En la carta: {formatCentsShort(menuCents)}</span>
            <button
              type="button"
              data-testid="reset-price"
              onClick={() => onReset(itemId)}
              className="inline-flex min-h-6 items-center rounded-sm text-left font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
            >
              Volver al precio de la carta
            </button>
          </p>
        ) : null}
      </div>

      {guard ? (
        <GuardPrompt itemId={itemId} name={name} guard={guard} onPick={onGuardPick} />
      ) : null}
      {error ? (
        <p
          id={noteId}
          data-testid="price-error"
          className="mt-1.5 text-xs text-destructive text-pretty"
        >
          {error}
        </p>
      ) : null}
    </li>
  )
})
