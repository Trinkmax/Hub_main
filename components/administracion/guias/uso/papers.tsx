import { ChevronRight, CircleAlert, CircleCheck, CircleMinus } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  GUIDE_PAPER_CASES,
  GUIDE_PAPERS,
  GUIDE_PATHS,
  type GuidePaper,
  PAPER_FACTS,
  PAPERS_ANCHOR,
  type PaperAnswer,
  type PaperCase,
  type PaperRoute,
  recipeAnchor,
} from '@/lib/accounting/guides'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { GuideDo } from './guide-do'
import { PaperArt } from './station-art'

/**
 * «Con factura y sin factura», en dibujos: los cuatro papeles lado a lado con lo que cambia en
 * cada uno, los casos de todos los días con «dónde lo cargo», y el lado de las ventas.
 *
 * Todo es descriptivo: dice lo que el sistema HACE. Los cuatro papeles quedan en el mismo libro;
 * «sin factura» es una marca para filtrar en Comprobantes, no un lugar aparte. Cómo se trata lo
 * define la contadora. Server-safe salvo «Hacerlo ahora» (`GuideDo`).
 */

const LINK =
  'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/* En estas páginas la barra de la sección no queda pegada al bajar: alcanza con el aire del
   encabezado para que el título no quede tapado (con más, asoma la cola del bloque anterior). */
const ANCHORED = 'scroll-mt-20'

/** La respuesta de una celda: el ícono dice sí, no o «a veces», y la palabra lo repite. */
function Answer({ answer, text }: { answer: PaperAnswer; text: string }) {
  const Icon =
    answer === 'yes'
      ? CircleCheck
      : answer === 'no'
        ? CircleMinus
        : answer === 'depends'
          ? CircleAlert
          : null
  return (
    <span className="flex items-start gap-1.5 text-sm leading-snug">
      {Icon ? (
        <Icon
          aria-hidden
          className={cn(
            'mt-px size-4 shrink-0',
            answer === 'yes' && 'text-success',
            answer === 'no' && 'text-muted-foreground',
            answer === 'depends' && 'text-warning',
          )}
        />
      ) : null}
      <span className={cn('min-w-0 text-pretty', answer === 'no' && 'text-muted-foreground')}>
        {text}
      </span>
    </span>
  )
}

function PaperHead({ paper }: { paper: GuidePaper }) {
  return (
    <>
      <PaperArt id={paper.id} className="h-[4.5rem]" />
      <span className="mt-2.5 block font-serif text-lg leading-tight font-semibold tracking-tight">
        {paper.title}
      </span>
      <span className="mt-1 block text-[13px] leading-snug font-normal text-muted-foreground text-pretty">
        {paper.lead}
      </span>
    </>
  )
}

/** La fila de «¿Queda en tus números?» va resaltada: es la que no cambia nunca. */
const KEY_FACT = 'your_numbers'

const FILTER_LABEL = 'En Comprobantes figura como'

/**
 * Los cuatro papeles. En la compu, una grilla: los papeles arriba y una pregunta por renglón, para
 * comparar de un vistazo. En el celular, un papel debajo del otro con sus cuatro respuestas.
 */
export function PapersCompare() {
  return (
    <Panel
      id={PAPERS_ANCHOR.papers}
      className={ANCHORED}
      title="Los cuatro quedan en tus números. Lo que cambia es el IVA."
      description="Mirá el papel que te dieron y bajá por su columna."
    >
      <div className="hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-left">
          <caption className="sr-only">
            Qué cambia según el papel que te dieron: una columna por papel, una pregunta por
            renglón.
          </caption>
          <colgroup>
            <col className="w-[17%]" />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <td />
              {GUIDE_PAPERS.map((paper) => (
                <th key={paper.id} scope="col" className="px-3 pb-4 align-top">
                  <PaperHead paper={paper} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAPER_FACTS.map((fact) => {
              const key = fact.id === KEY_FACT
              return (
                <tr key={fact.id}>
                  <th
                    scope="row"
                    className={cn(
                      'border-t border-border/60 py-3 pr-3 align-top text-sm font-medium text-pretty',
                      key && 'rounded-l-xl border-transparent bg-accent/45 pl-3',
                    )}
                  >
                    {fact.question}
                  </th>
                  {GUIDE_PAPERS.map((paper, index) => (
                    <td
                      key={paper.id}
                      className={cn(
                        'border-t border-border/60 px-3 py-3 align-top',
                        key && 'border-transparent bg-accent/45',
                        key && index === GUIDE_PAPERS.length - 1 && 'rounded-r-xl',
                      )}
                    >
                      <Answer {...paper.facts[fact.id]} />
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr>
              <th
                scope="row"
                className="border-t border-border/60 py-3 pr-3 align-top text-sm font-medium text-pretty"
              >
                {FILTER_LABEL}
              </th>
              {GUIDE_PAPERS.map((paper) => (
                <td key={paper.id} className="border-t border-border/60 px-3 py-3 align-top">
                  <StatusPill tone="muted">{paper.filter}</StatusPill>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="space-y-5 md:hidden">
        {GUIDE_PAPERS.map((paper) => (
          <li key={paper.id} className="border-t border-border/60 pt-5 first:border-t-0 first:pt-0">
            <div className="flex items-start gap-3.5">
              <PaperArt id={paper.id} className="h-16 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-serif text-lg leading-tight font-semibold tracking-tight">
                  {paper.title}
                </h3>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground text-pretty">
                  {paper.lead}
                </p>
              </div>
            </div>
            <dl className="mt-3.5 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2.5">
              {PAPER_FACTS.map((fact) => (
                <Fragment key={fact.id}>
                  <dt className="text-[13px] leading-snug text-muted-foreground text-pretty">
                    {fact.question}
                  </dt>
                  <dd>
                    <Answer {...paper.facts[fact.id]} />
                  </dd>
                </Fragment>
              ))}
              {/* Igual que la última fila de la grilla de la compu: sin el rótulo, la píldora
                  se leía como si fuera el tipo de papel. */}
              <dt className="text-[13px] leading-snug text-muted-foreground text-pretty">
                {FILTER_LABEL}
              </dt>
              <dd>
                <StatusPill tone="muted">{paper.filter}</StatusPill>
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * «Dónde lo cargo»: lo que se toca, en orden. En la compu va en una línea, y cada paso viaja con
 * su flechita (si no entra, baja entero: nunca queda una «›» suelta al final del renglón). En el
 * celular los rótulos son largos y no entran de costado: un paso por renglón, numerado.
 */
function RouteSteps({ route, first }: { route: PaperRoute; first: boolean }) {
  const lead = first ? 'Dónde lo cargo' : null
  const label = [lead, route.when].filter((part) => part !== null && part !== undefined)
  return (
    <div className="sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-2 sm:gap-y-1.5">
      <p className="text-muted-foreground max-sm:mb-1.5">{label.join(' · ')}:</p>
      <ol className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-1.5">
        {route.steps.map((step, index) => (
          <li key={step} className="flex items-baseline gap-2 sm:items-center sm:gap-1">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/50 text-[11px] font-semibold tabular-nums sm:hidden"
            >
              {index + 1}
            </span>
            {index > 0 ? (
              <ChevronRight
                aria-hidden
                className="hidden size-3.5 shrink-0 text-muted-foreground sm:block"
              />
            ) : null}
            <span className="min-w-0 rounded-md bg-secondary/70 px-1.5 py-0.5 font-medium text-pretty sm:whitespace-nowrap">
              {step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CaseRow({ item, base }: { item: PaperCase; base: string }) {
  return (
    <li className="grid gap-x-4 gap-y-3 border-t border-border/60 py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[3.5rem_minmax(0,1fr)] lg:grid-cols-[3.5rem_minmax(0,1fr)_auto] lg:items-center">
      <PaperArt id={item.art} className="hidden h-[4.5rem] sm:block" />
      <div className="min-w-0">
        <h3 className="font-medium leading-snug text-pretty">{item.title}</h3>
        <div className="mt-2 space-y-2.5 text-[13px]">
          {item.where.map((route, index) => (
            <RouteSteps key={route.steps.join('›')} route={route} first={index === 0} />
          ))}
        </div>
        <ul className="mt-2.5 space-y-0.5 text-sm text-muted-foreground">
          {item.result.map((line) => (
            <li key={line} className="text-pretty">
              {line}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-2 lg:col-start-3 lg:flex-col lg:items-end">
        <GuideDo target={item.action.target}>{item.action.label}</GuideDo>
        {item.recipe ? (
          <Link
            href={`${base}${GUIDE_PATHS.daily}#${recipeAnchor(item.recipe)}`}
            className={cn(LINK, 'inline-flex min-h-9 items-center text-sm pointer-coarse:min-h-11')}
          >
            Ver el paso a paso
          </Link>
        ) : null}
      </div>
    </li>
  )
}

/** Los casos de todos los días: qué papel tengo y dónde lo cargo. */
export function PaperCases({ base }: { base: string }) {
  return (
    <Panel
      id={PAPERS_ANCHOR.cases}
      className={ANCHORED}
      title="¿Qué papel tengo y dónde lo cargo?"
      description="Los casos de todos los días. La puerta cambia según si ya pagaste o lo pagás después."
    >
      <ul>
        {GUIDE_PAPER_CASES.map((item) => (
          <CaseRow key={item.id} item={item} base={base} />
        ))}
      </ul>
    </Panel>
  )
}

/* Un día de ejemplo, en centavos. Los números son inventados y van rotulados «Ejemplo». */
const SOLD = 45_200_000
const INVOICED = 31_000_000

/** El lado de las ventas: sin factura es lo que queda al restar lo facturado. */
export function SalesInvoicing({ base }: { base: string }) {
  return (
    <Panel
      id={PAPERS_ANCHOR.sales}
      className={ANCHORED}
      title="En las ventas, «sin factura» es lo que queda al restar"
      description="Acá no elegís un papel: cargás lo que facturaste y la plataforma hace la cuenta."
    >
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-10">
        <ol className="space-y-3 text-sm leading-relaxed">
          {[
            'En el cierre del día cargás todo lo que se vendió, por cada medio de cobro.',
            'Lo que facturaste lo cargás aparte: desde qué número hasta qué número, y el total.',
            'Lo que no facturaste queda como venta sin factura. No lleva IVA y no entra al Libro IVA de ventas.',
          ].map((text, index) => (
            <li key={text} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/50 text-xs font-semibold tabular-nums"
              >
                {index + 1}
              </span>
              <span className="min-w-0 pt-0.5 text-pretty">{text}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-xl bg-secondary/50 p-4">
          <p className="flex items-center justify-between gap-3 text-sm font-medium">
            Un día de {formatCentsShort(SOLD)}
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Ejemplo
            </span>
          </p>
          <SplitBar
            className="mt-3"
            totalLabel="Vendido"
            segments={[
              { key: 'con', label: 'Con factura', cents: INVOICED, swatch: 'bg-adm-s1' },
              { key: 'sin', label: 'Sin factura', cents: SOLD - INVOICED, swatch: 'bg-adm-s4' },
            ]}
          />
          <Explain className="mt-3">
            <MathRow label="Lo que se vendió" value={formatCentsShort(SOLD)} />
            <MathRow op="−" label="Lo que facturaste" value={formatCentsShort(INVOICED)} />
            <MathRow op="=" label="Venta sin factura" value={formatCentsShort(SOLD - INVOICED)} />
          </Explain>
        </div>
      </div>
      <p className="mt-5 border-t border-border/60 pt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
        Sin la numeración de tus facturas cargada no hay dónde escribir lo facturado: el día entero
        queda como venta sin factura. Se carga una sola vez en{' '}
        <Link href={`${base}/ajustes?tab=puntos-de-venta`} className={LINK}>
          Ajustes › Puntos de venta
        </Link>
        .
      </p>
    </Panel>
  )
}

/** Lo que no cambia nunca, dicho una sola vez y bien a la vista. */
export function OneBook({ base }: { base: string }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-accent/40 p-4 sm:p-5">
      <h2 className="font-serif text-lg leading-snug font-semibold tracking-tight">
        Todo queda en el mismo libro
      </h2>
      <div className="mt-1.5 max-w-prose space-y-1.5 text-sm leading-relaxed text-pretty">
        <p>
          El diario, el mayor y el sumas y saldos llevan todo lo que cargaste, con factura y sin
          factura.
        </p>
        <p>
          «Sin factura» es una marca para filtrar: está en{' '}
          <Link href={`${base}/compras?tab=comprobantes`} className={LINK}>
            Compras y pagos › Comprobantes
          </Link>{' '}
          y en lo que exportás desde ahí. Cómo se trata cada cosa lo define la contadora.
        </p>
      </div>
    </div>
  )
}
