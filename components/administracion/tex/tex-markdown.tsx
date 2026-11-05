'use client'

import Link from 'next/link'
import { Fragment, type MouseEvent, type ReactNode } from 'react'

type TexLinkHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void

/**
 * Lo que dice Tex, con el poco formato que usa: negrita, listas, tablas y links a pantallas del bar.
 * Es un lector propio a propósito: no entra HTML ni imágenes, y un link solo funciona si va adentro de
 * este bar. Lo que venga en un dato no puede sacar a nadie de acá ni cargar nada de afuera.
 */

export type TexBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Puro. */
export function parseTexBlocks(source: string): TexBlock[] {
  const blocks: TexBlock[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string
    if (!line.trim()) {
      index += 1
      continue
    }
    const next = lines[index + 1]
    if (line.includes('|') && next !== undefined && TABLE_RULE.test(next)) {
      const head = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index] as string).includes('|')) {
        rows.push(tableCells(lines[index] as string))
        index += 1
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*•]\s+/.test(lines[index] as string)) {
        items.push((lines[index] as string).replace(/^\s*[-*•]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] as string)) {
        items.push((lines[index] as string).replace(/^\s*\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] as string
      if (!current.trim() || /^\s*[-*•]\s+/.test(current) || /^\s*\d+[.)]\s+/.test(current)) break
      paragraph.push(current.replace(/^#{1,6}\s+/, ''))
      index += 1
    }
    blocks.push({ kind: 'p', text: paragraph.join('\n') })
  }
  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

/**
 * Solo links a pantallas de este bar. Si la persona no tiene permiso para esa pantalla, el `proxy` la
 * lleva a la suya, como con cualquier link. Puro.
 */
export function safeTexHref(href: string, slug: string): string | null {
  const base = `/${slug}`
  if (!href.startsWith(base)) return null
  const rest = href.slice(base.length)
  if (rest !== '' && !rest.startsWith('/') && !rest.startsWith('?')) return null
  if (href.includes('//') || href.includes('\\')) return null
  return href
}

function renderInline(text: string, slug: string, onLink?: TexLinkHandler): ReactNode {
  return text.split(INLINE).map((part, index) => {
    const key = `${index}-${part.slice(0, 8)}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <span key={key} className="font-medium">
          {part.slice(1, -1)}
        </span>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link) {
      const href = safeTexHref(link[2] as string, slug)
      if (!href) return <Fragment key={key}>{link[1]}</Fragment>
      return (
        <Link
          key={key}
          href={href}
          onClick={(event) => onLink?.(event, href)}
          className="font-medium underline underline-offset-2"
        >
          {link[1]}
        </Link>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

export function TexMarkdown({
  text,
  slug,
  onLink,
}: {
  text: string
  slug: string
  /** Se tocó un link: en el celular la hoja tiene que dejar ver a dónde llevó. */
  onLink?: TexLinkHandler
}) {
  const blocks = parseTexBlocks(text)
  return (
    <div className="grid gap-2 text-sm leading-relaxed text-pretty max-sm:text-[15px]">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`
        if (block.kind === 'p') {
          return (
            <p key={key} className="whitespace-pre-line">
              {renderInline(block.text, slug, onLink)}
            </p>
          )
        }
        if (block.kind === 'table') {
          return (
            <div key={key} className="-mx-1 overflow-x-auto">
              <table className="w-full border-collapse text-[13px] tabular-nums">
                <thead>
                  <tr>
                    {block.head.map((cell) => (
                      <th
                        key={cell}
                        className="border-b-2 border-current/25 px-1.5 py-1 text-left font-semibold whitespace-nowrap"
                      >
                        {renderInline(cell, slug, onLink)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={`${key}-${row.join('|')}`} className="border-b border-current/10">
                      {row.map((cell, cellIndex) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: las celdas de un renglón no cambian de lugar.
                        <td key={cellIndex} className="px-1.5 py-1">
                          {renderInline(cell, slug, onLink)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        const List = block.kind === 'ul' ? 'ul' : 'ol'
        return (
          <List
            key={key}
            className={
              block.kind === 'ul' ? 'grid list-disc gap-1 pl-5' : 'grid list-decimal gap-1 pl-5'
            }
          >
            {block.items.map((item) => (
              <li key={item}>{renderInline(item, slug, onLink)}</li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
