'use client'

import * as React from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { Section } from '@/components/ui/section'
import { cn } from '@/lib/utils'
import { catalogBlock, catalogFamily } from './registry'
import { ThemePanels } from './theme-panels'

/**
 * Texto con `código` entre comillas invertidas: lo que va entre ellas sale en
 * monoespaciada. Las claves salen de la posición en el texto (fija para un
 * mismo texto), no del índice del arreglo.
 */
export function InlineText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  let offset = 0
  let inCode = false
  for (const part of text.split('`')) {
    if (part !== '') {
      nodes.push(
        inCode ? (
          <code key={offset} className="rounded-sm bg-muted px-1 font-mono text-foreground">
            {part}
          </code>
        ) : (
          <React.Fragment key={offset}>{part}</React.Fragment>
        ),
      )
    }
    offset += part.length + 1
    inCode = !inCode
  }
  return <>{nodes}</>
}

/** El fragmento de uso: monoespaciada sobre `muted`, con «Copiar». Hace saltos de línea en vez de scroll. */
export function CodeSnippet({ code }: { code: string }) {
  return (
    <div data-slot="catalog-snippet" className="relative min-w-0">
      <pre className="rounded-lg border border-border bg-muted p-4 pe-12 font-mono type-small break-words whitespace-pre-wrap text-foreground">
        <code>{code}</code>
      </pre>
      <CopyButton
        value={code}
        iconOnly
        variant="ghost"
        size="icon-sm"
        label="Copiar el fragmento"
        copiedLabel="Fragmento copiado"
        className="absolute top-2 right-2"
      />
    </div>
  )
}

/**
 * Una fila de ejemplos con su rótulo (la fila de variantes, la de tamaños, la
 * de estados fijos). El rótulo va antes en el DOM: el lector lo lee antes que
 * los ejemplos.
 */
export function DemoRow({
  label,
  children,
  className,
  stack = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  /** En columna en vez de en fila (campos a ancho completo). */
  stack?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <p className="type-caption text-subtle-foreground">{label}</p>
      <div
        className={cn(
          stack ? 'flex flex-col gap-4' : 'flex flex-wrap items-center gap-2',
          'min-w-0',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** La columna de filas de un ejemplo. */
export function DemoStack({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex min-w-0 flex-col gap-6', className)}>{children}</div>
}

/** Un valor que el ejemplo muestra en vivo («Centavos: 123450»): par etiqueta-valor. */
export function Readout({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: React.ReactNode }>
  className?: string
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2 type-small',
        className,
      )}
    >
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 font-mono break-words text-foreground">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export type CatalogBlockProps = {
  /** El id del registro: ancla, nombre e índice salen de ahí. */
  id: string
  /** Para qué sirve, en una línea. Admite `código`. */
  purpose: string
  /** Cuándo sí. */
  yes: string
  /** Cuándo no. */
  no: string
  /** Lo que se dibuja en los dos paneles. */
  children: React.ReactNode
  /** El fragmento de uso. */
  usage: string
  /** Notas de accesibilidad y de teclado. Admiten `código`. */
  a11y: readonly string[]
  /**
   * Lo que sigue andando por compatibilidad (`@deprecated`). Va como texto: el
   * catálogo vive en `docs/`, que tiene cero usos deprecados (lo cuenta
   * tests/lib/kit-deprecations.test.ts), así que no los monta.
   */
  compat?: string
  /** Siempre apilados (plantillas, tablas, libros). */
  wide?: boolean
  /** Marca los paneles con «Datos de ejemplo». */
  sample?: boolean
}

/**
 * Un bloque del catálogo (§6.2): nombre y para qué, cuándo sí y cuándo no, el
 * claro y el oscuro con los ejemplos, un fragmento de uso y las notas de
 * accesibilidad y de teclado. Es una `Section` del kit (h3) con el ancla del
 * registro.
 */
export function CatalogBlock({
  id,
  purpose,
  yes,
  no,
  children,
  usage,
  a11y,
  compat,
  wide = false,
  sample = false,
}: CatalogBlockProps) {
  const meta = catalogBlock(id)
  return (
    <Section
      id={id}
      headingLevel={3}
      title={meta.name}
      description={<InlineText text={purpose} />}
      data-catalog="block"
      className="scroll-mt-4"
    >
      <dl className="grid gap-x-6 gap-y-3 type-small sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="type-label text-foreground">Cuándo sí</dt>
          <dd className="text-pretty text-muted-foreground">
            <InlineText text={yes} />
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="type-label text-foreground">Cuándo no</dt>
          <dd className="text-pretty text-muted-foreground">
            <InlineText text={no} />
          </dd>
        </div>
      </dl>
      <ThemePanels wide={wide} sample={sample}>
        {children}
      </ThemePanels>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-2">
          <h4 className="type-label text-foreground">Uso</h4>
          <CodeSnippet code={usage} />
          {compat ? (
            <p className="type-small text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">Compatibilidad: </span>
              <InlineText text={compat} />
            </p>
          ) : null}
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <h4 className="type-label text-foreground">Accesibilidad y teclado</h4>
          <ul className="grid list-disc gap-1 ps-5 type-small text-pretty text-muted-foreground">
            {a11y.map((note) => (
              <li key={note}>
                <InlineText text={note} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

/** Una familia del índice (h2), con sus bloques. */
export function CatalogFamily({ id, children }: { id: string; children: React.ReactNode }) {
  const family = catalogFamily(id)
  return (
    <Section
      id={id}
      headingLevel={2}
      title={family.label}
      description={family.summary}
      divider
      data-catalog="family"
      className="scroll-mt-4 gap-10"
    >
      {children}
    </Section>
  )
}
