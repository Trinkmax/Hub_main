'use client'

import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { composite, contrastRatio, parseColor, type Rgba, toHex } from '@/lib/color/contrast'
import { decimalEsAr } from '@/lib/money/decimal'
import { cn } from '@/lib/utils'
import { usePanelTheme } from './catalog-provider'
import { type ContrastPair, DARK_PAIRS, LIGHT_PAIRS, layersOf, tokensOf } from './contrast-pairs'

/** `getComputedStyle` de una muestra: el color tal como lo resolvió el navegador. */
export function readComputedColor(
  element: Element,
  property: 'color' | 'backgroundColor' = 'color',
): Rgba | null {
  return parseColor(getComputedStyle(element)[property])
}

/** `4,52:1`, con coma decimal (es-AR). */
export function formatRatio(ratio: number): string {
  return `${decimalEsAr(ratio, 2, false)}:1`
}

/** El mínimo como lo escribe WCAG: `4,5:1` y `3:1` (no `4,50:1`). */
export function formatMinimum(min: number): string {
  return `${decimalEsAr(min, Number.isInteger(min) ? 0 : 1, false)}:1`
}

type Measured = Map<string, Rgba | null>

/**
 * Mide al montar y otra vez cuando cambia «más contraste» del sistema (los
 * scopes nuevos cambian `--border`, `--input` y `--subtle-foreground` con
 * `prefers-contrast: more`).
 */
function useMeasure(measure: () => void) {
  React.useEffect(() => {
    measure()
    const media = window.matchMedia('(prefers-contrast: more)')
    media.addEventListener('change', measure)
    return () => media.removeEventListener('change', measure)
  }, [measure])
}

type PairResult = ContrastPair & {
  ratio: number | null
  /** Los dos colores ya opacos, para la muestra «Aa». */
  fgHex: string | null
  bgHex: string | null
}

/** Pinta una capa: un token, o un token con alfa compuesto sobre otro. `null` si alguno no se entiende. */
function paint(measured: Measured, layer: string): Rgba | null {
  const [top, under] = layersOf(layer)
  const topColor = measured.get(top) ?? null
  if (!topColor) return null
  if (under === undefined) return topColor
  const underColor = measured.get(under) ?? null
  return underColor ? composite(topColor, underColor) : null
}

function evaluate(pairs: readonly ContrastPair[], measured: Measured): PairResult[] {
  return pairs.map((item) => {
    const fg = paint(measured, item.fg)
    const bg = paint(measured, item.bg)
    if (!fg || !bg) return { ...item, ratio: null, fgHex: null, bgHex: null }
    const background = bg.alpha < 1 ? composite(bg, { r: 1, g: 1, b: 1, alpha: 1 }) : bg
    return {
      ...item,
      ratio: contrastRatio(fg, background),
      fgHex: toHex(composite(fg, background)),
      bgHex: toHex(background),
    }
  })
}

/**
 * La tabla de contraste en vivo (kit HUB §6.4). Va adentro de cada panel de
 * tema y mide lo que ese panel pinta:
 *
 * - Una muestra por token (`color: var(--token)`), escondida, adentro del
 *   panel; `getComputedStyle` devuelve el color en la sintaxis en que se
 *   escribió (`oklch(…)`, con alfa si lo tiene) y `lib/color/contrast.ts` lo
 *   entiende: es la misma función que usa tests/lib/tokens-contrast.test.ts.
 * - Los tokens con alfa (`--selected`, `--hover`) se componen sobre la
 *   superficie donde van.
 * - Lo que baja del mínimo va en `text-destructive-text`, con ícono y la
 *   palabra «No llega» (el color nunca es la única señal).
 * - Vuelve a medir sola cuando cambia «más contraste» del sistema y a mano
 *   con «Volver a medir» (por ejemplo, después de tocar un token en
 *   `globals.css` con la página abierta).
 */
export function ContrastTable() {
  const theme = usePanelTheme()
  const pairs = theme === 'light' ? LIGHT_PAIRS : DARK_PAIRS
  const tokens = React.useMemo(() => tokensOf(pairs), [pairs])
  const swatchesRef = React.useRef<HTMLDivElement>(null)
  const [results, setResults] = React.useState<PairResult[] | null>(null)

  const measure = React.useCallback(() => {
    const root = swatchesRef.current
    if (!root) return
    const measured: Measured = new Map()
    for (const swatch of root.querySelectorAll<HTMLElement>('[data-contrast-token]')) {
      const token = swatch.dataset.contrastToken
      if (token) measured.set(token, readComputedColor(swatch))
    }
    setResults(evaluate(pairs, measured))
  }, [pairs])

  useMeasure(measure)

  const failing = results?.filter((item) => item.ratio === null || item.ratio < item.min) ?? []
  const caption = `Contraste de los tokens en ${theme === 'light' ? 'claro' : 'oscuro'}`

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Las muestras: una por token, sin caja. Escondidas (display: none), el navegador igual calcula su color. */}
      <div ref={swatchesRef} hidden>
        {tokens.map((token) => (
          <span key={token} data-contrast-token={token} style={{ color: `var(${token})` }} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-small text-muted-foreground">
          {results === null
            ? 'Midiendo…'
            : failing.length === 0
              ? `${results.length.toString()} pares medidos: todos llegan al mínimo.`
              : `${results.length.toString()} pares medidos: ${failing.length.toString()} no llegan al mínimo.`}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={measure}>
          <RefreshCw aria-hidden="true" />
          Volver a medir
        </Button>
      </div>

      <DataTableShell>
        <DataTableScroll maxHeight="28rem">
          <DataTableRoot density="compact" caption={caption}>
            <DataTableHead sticky="container">
              <tr>
                <DataTableHeader>Muestra</DataTableHeader>
                <DataTableHeader>Par</DataTableHeader>
                <DataTableHeader className="max-md:hidden">Uso</DataTableHeader>
                <DataTableHeader numeric>Ratio</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {(results ?? []).map((item) => {
                const fails = item.ratio === null || item.ratio < item.min
                return (
                  <DataTableRow key={`${item.fg}|${item.bg}`}>
                    <DataTableCell>
                      <span
                        aria-hidden="true"
                        className="inline-flex h-7 w-10 items-center justify-center rounded-sm border border-border type-label"
                        style={
                          item.fgHex && item.bgHex
                            ? { color: item.fgHex, backgroundColor: item.bgHex }
                            : undefined
                        }
                      >
                        Aa
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <span className="grid gap-0.5 font-mono type-caption">
                        <span className="text-foreground">{item.fg}</span>
                        <span className="text-muted-foreground">sobre {item.bg}</span>
                      </span>
                    </DataTableCell>
                    <DataTableCell className="max-md:hidden type-small text-muted-foreground">
                      {item.use}
                    </DataTableCell>
                    <DataTableCell numeric className={cn(fails && 'text-destructive-text')}>
                      {item.ratio === null ? '—' : formatRatio(item.ratio)}
                      <span className="block type-caption text-muted-foreground">
                        mín. {formatMinimum(item.min)}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      {fails ? (
                        <span className="inline-flex items-center gap-1 type-label text-destructive-text">
                          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                          {item.ratio === null ? 'No se pudo medir' : 'No llega'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 type-label text-success-text">
                          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                          Llega
                        </span>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>
    </div>
  )
}

/**
 * Una muestra de color con su valor medido (`#f6f0e1`, con alfa si lo tiene):
 * la chapa usa `background: var(--token)` y el hex sale de `getComputedStyle`,
 * no de una tabla escrita a mano.
 */
export function ColorSwatch({ token, note }: { token: string; note?: string }) {
  const chipRef = React.useRef<HTMLSpanElement>(null)
  const [hex, setHex] = React.useState<string | null>(null)

  const measure = React.useCallback(() => {
    const chip = chipRef.current
    if (!chip) return
    const color = readComputedColor(chip, 'backgroundColor')
    setHex(color ? toHex(color) : null)
  }, [])
  useMeasure(measure)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        ref={chipRef}
        aria-hidden="true"
        className="size-9 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: `var(${token})` }}
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-mono type-caption text-foreground">{token}</span>
        <span className="truncate type-caption text-muted-foreground">
          {hex ?? '…'}
          {note ? ` · ${note}` : ''}
        </span>
      </span>
    </div>
  )
}
