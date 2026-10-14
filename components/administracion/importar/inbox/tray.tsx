import { ArrowRight, ChevronRight, CircleCheck, Lock } from 'lucide-react'
import Link from 'next/link'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { StatusPill } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { InboxSheet, InboxTray } from '@/lib/imports/ui/inbox'
import { cn } from '@/lib/utils'
import { CoverageStrip } from './coverage-strip'
import { SourceMark } from './source-mark'

/**
 * Una de las tres bandejas de «Importar» (ARCA, Mercado Pago, el banco). Tiene
 * la forma de la bandeja de un escritorio: el rótulo, LO QUE FALTA TRAER en
 * grande, la tira con lo ya traído y sus huecos, y las hojas que quedaron
 * esperando adentro de la bandeja.
 *
 * Reemplaza a la tarjeta «título + párrafo + cajita + botón», que no decía lo
 * único que sirve: qué falta y desde cuándo.
 *
 * No calcula nada: dibuja lo que arma `buildInbox()` (`lib/imports/ui/inbox.ts`).
 * Quien solo lee no recibe `action`, `secondary` ni `howHref`, así que no ve
 * ningún botón de carga. Server-safe.
 *
 * Lado a lado (desde `md`), las bandejas comparten renglones (`subgrid`): el
 * rótulo, el cuerpo y el pie de cada una arrancan a la misma altura aunque un
 * nombre o una bajada ocupen un renglón más. `wide` es la que va sola en su
 * fila en una tablet (ARCA, arriba de las dos semanales).
 */
export function ImportTray({
  tray,
  wide = false,
  className,
}: {
  tray: InboxTray
  /** Va sola en su fila entre `md` y `xl`: no reserva el renglón del rótulo. */
  wide?: boolean
  className?: string
}) {
  const titleId = `bandeja-${tray.source}`
  const blocked = tray.state === 'blocked'
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'card-hairline flex h-full min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5',
        'md:row-span-3 md:grid md:grid-rows-subgrid',
        blocked && 'border-dashed bg-card/60 shadow-none',
        className,
      )}
    >
      <header className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent',
            blocked && 'bg-secondary/60',
          )}
        >
          <SourceMark
            source={tray.source}
            className={cn('size-8', blocked && 'text-muted-foreground')}
          />
        </span>
        <div className="min-w-0">
          <h2
            id={titleId}
            className="font-serif text-xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]"
          >
            {tray.name}
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground text-pretty">
            {tray.line}
          </p>
        </div>
      </header>

      {/* Trabada: el candado con lo que falta y, debajo, qué va a llegar acá (la misma
          silueta que una bandeja sin estrenar, más apagada). Antes era un recuadro gris alto
          con una sola oración. */}
      {blocked ? (
        <div className="flex-1 space-y-3">
          <div
            aria-hidden
            className="pointer-events-none select-none rounded-xl bg-secondary/50 p-3 opacity-45"
          >
            <ChartSilhouette kind="strip" />
          </div>
          <div>
            <p className="flex items-start gap-2 text-sm font-medium leading-snug text-pretty">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {tray.blocked}
            </p>
            {tray.empty ? (
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
                {tray.empty.text}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tray.state === 'never' && tray.empty ? (
        <div className="flex-1 space-y-3">
          <div
            aria-hidden
            className="pointer-events-none select-none rounded-xl bg-secondary/50 p-3 opacity-70"
          >
            <ChartSilhouette kind="strip" />
          </div>
          <div>
            <p className="font-serif text-lg font-semibold leading-snug tracking-tight">
              {tray.empty.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
              {tray.empty.text}
            </p>
          </div>
        </div>
      ) : null}

      {tray.state === 'ok' && tray.hero ? (
        <div className="flex-1 space-y-4">
          <div>
            {/* Lado a lado, el renglón del rótulo va siempre (aunque quede vacío): así el
                número de las bandejas vecinas arranca a la misma altura. Apiladas (el celular,
                o la que va sola en su fila) no se reserva: dejaba un hueco arriba de «Al día». */}
            <div
              className={cn(
                'mb-1.5 flex flex-wrap items-center gap-2',
                wide ? 'max-xl:empty:hidden xl:min-h-6' : 'max-md:empty:hidden md:min-h-6',
              )}
            >
              {tray.hero.label ? (
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {tray.hero.label}
                </p>
              ) : null}
              {tray.hero.due ? <StatusPill tone="warn">Te toca</StatusPill> : null}
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 font-serif text-4xl font-semibold leading-none tracking-tight">
              <span>{tray.hero.value}</span>
              {tray.hero.unit ? (
                <span className="font-sans text-base font-medium tracking-normal text-muted-foreground">
                  {tray.hero.unit}
                </span>
              ) : null}
              {tray.hero.upToDate ? (
                <CircleCheck aria-hidden className="size-6 self-center text-success" />
              ) : null}
            </p>
            <p className="mt-2 text-sm leading-snug text-muted-foreground text-pretty">
              {tray.hero.sentence}
            </p>
          </div>

          {tray.strip ? (
            <CoverageStrip
              cells={tray.strip.cells}
              granularity={tray.strip.granularity}
              ariaLabel={tray.strip.ariaLabel}
            />
          ) : null}

          {tray.last || tray.notes.length > 0 ? (
            <div className="space-y-1 text-xs leading-snug text-muted-foreground">
              {tray.last ? <p>{tray.last}</p> : null}
              {tray.notes.map((note) => (
                <p key={note.text} className="text-pretty">
                  {note.text}
                  {note.link ? (
                    <>
                      {' '}
                      <Link
                        href={note.link.href}
                        className="-my-3 inline-flex min-h-11 items-center rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:-my-2 md:pointer-fine:min-h-9"
                      >
                        {note.link.label}
                      </Link>
                    </>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}

          {tray.waiting.length > 0 ? (
            <WaitingSheets
              sheets={tray.waiting}
              more={tray.waitingMore}
              moreHref={tray.waitingMoreHref}
            />
          ) : null}
        </div>
      ) : null}

      {tray.action || tray.howHref ? (
        <footer className="mt-auto flex min-w-0 flex-col gap-2 pt-1 md:mt-0">
          {tray.action ? (
            // El rótulo puede ocupar dos renglones («Subir el reporte de Mercado Pago» en una
            // bandeja angosta): el botón crece, nunca se sale de la tarjeta.
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-11 w-full justify-between gap-2 whitespace-normal px-4 py-2 text-left"
            >
              <Link href={tray.action.href}>
                <span className="min-w-0 text-pretty">{tray.action.label}</span>
                <ArrowRight aria-hidden className="size-4 shrink-0" />
              </Link>
            </Button>
          ) : null}
          {tray.secondary || tray.howHref ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
              {tray.secondary ? (
                <TrayLink href={tray.secondary.href}>{tray.secondary.label}</TrayLink>
              ) : null}
              {tray.howHref ? <TrayLink href={tray.howHref}>¿Cómo se baja?</TrayLink> : null}
            </div>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}

function TrayLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-8"
    >
      {children}
    </Link>
  )
}

/** El giro de cada hoja: apenas, como papeles apoyados uno sobre otro. */
const SHEET_TILT = ['-rotate-1', 'rotate-[0.6deg]'] as const

/**
 * Las hojas que esperan, adentro de la bandeja: paredes a los costados y un
 * labio abajo. Cada hoja es un link a su archivo.
 */
function WaitingSheets({
  sheets,
  more,
  moreHref,
}: {
  sheets: readonly InboxSheet[]
  more: number
  moreHref: string
}) {
  return (
    <div className="rounded-b-2xl border-x-2 border-b-[6px] border-adm-track bg-secondary/40 px-3 pt-3 pb-2">
      <ul aria-label="Archivos que esperan">
        {sheets.map((sheet, index) => (
          <li
            key={sheet.id}
            className={cn(
              'relative',
              index > 0 && '-mt-1.5',
              SHEET_TILT[index % SHEET_TILT.length],
              'motion-reduce:rotate-0',
            )}
          >
            <Link
              href={sheet.href}
              className="force-light press-lift flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-adm-paper-rule/60 bg-adm-paper px-3 py-2 text-adm-paper-ink shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {/* `basis-32`: si la píldora no entra al lado, baja entera a su renglón en vez de
                  aplastar el texto de a una palabra. */}
              <span className="min-w-0 flex-1 basis-32">
                <span className="block font-medium leading-snug">{sheet.title}</span>
                <span className="block text-xs leading-snug text-muted-foreground text-pretty">
                  {sheet.detail}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1">
                {/* La hoja a medio subir ya lo dice en su título. */}
                {sheet.kind === 'review' ? <StatusPill tone="warn">Para revisar</StatusPill> : null}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Link
          href={moreHref}
          className="mt-1 inline-flex min-h-11 items-center rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9"
        >
          y {more} más
        </Link>
      ) : null}
    </div>
  )
}
