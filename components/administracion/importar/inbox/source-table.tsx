import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { PRow, PTable, PTd, PTh } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import type { ImportSourceRow } from '@/lib/imports/ui/inbox'
import { CoverageStrip } from './coverage-strip'

const INLINE_LINK =
  'rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** Un origen: qué archivo es, cuándo fue la última vez, qué falta y qué quedó esperando. */
function SourceRow({ row }: { row: ImportSourceRow }) {
  return (
    <PRow>
      <PTd className="font-medium whitespace-nowrap">{row.name}</PTd>
      <PTd>
        {row.file}
        {row.howHref ? (
          <Link
            href={row.howHref}
            className={`${INLINE_LINK} ml-2 text-xs whitespace-nowrap text-muted-foreground`}
          >
            ¿Cómo se baja?
          </Link>
        ) : null}
      </PTd>
      <PTd>
        {row.last ?? <span className="text-muted-foreground">Nunca</span>}
        {row.status ? (
          <span
            className={`block text-xs ${row.status.due ? 'text-warning-text' : 'text-muted-foreground'}`}
          >
            {row.status.text}
          </span>
        ) : null}
        {row.waiting.map((sheet) => (
          <Link
            key={sheet.id}
            href={sheet.href}
            className={`${INLINE_LINK} block w-fit text-xs text-warning-text`}
          >
            {sheet.kind === 'staging' ? sheet.title : `${sheet.title}: ${sheet.detail}`}
          </Link>
        ))}
        {row.waitingMore > 0 ? (
          <Link
            href={row.waitingMoreHref}
            className={`${INLINE_LINK} block w-fit text-xs text-muted-foreground`}
          >
            y {row.waitingMore} más
          </Link>
        ) : null}
        {row.notes.map((note) => (
          <span key={note.text} className="block text-xs text-muted-foreground text-pretty">
            {note.text}{' '}
            {note.link ? (
              <Link href={note.link.href} className={INLINE_LINK}>
                {note.link.label}
              </Link>
            ) : null}
          </span>
        ))}
      </PTd>
      <PTd align="right">
        {row.action ? (
          <Button asChild size="sm" variant="outline">
            <Link href={row.action.href}>{row.action.label}</Link>
          </Button>
        ) : null}
      </PTd>
    </PRow>
  )
}

/**
 * La tabla de «Importar»: de dónde, qué archivo, la última vez y «Subir». Dibuja lo que arma
 * `importSourceRows()`. Quien solo lee no recibe `action` ni `howHref`, y `photoHref` tampoco: no ve
 * ningún botón de carga. Server-safe.
 */
export function ImportSourcesTable({
  rows,
  photoHref,
}: {
  rows: readonly ImportSourceRow[]
  /** La fila «Foto o PDF»: abre la compra. `null` para quien solo lee. */
  photoHref: string | null
}) {
  return (
    <PTable label="De dónde se importa cada archivo" minWidth={640}>
      <thead>
        <tr>
          <PTh>Origen</PTh>
          <PTh>Qué archivo</PTh>
          <PTh>Última vez</PTh>
          <PTh>
            <span className="sr-only">Subir</span>
          </PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <SourceRow key={row.source} row={row} />
        ))}
        {photoHref ? (
          <PRow>
            <PTd className="font-medium whitespace-nowrap">Foto o PDF</PTd>
            <PTd>Abre Compra con el comprobante</PTd>
            <PTd className="text-muted-foreground">–</PTd>
            <PTd align="right">
              <Button asChild size="sm" variant="outline">
                <Link href={photoHref}>Subir</Link>
              </Button>
            </PTd>
          </PRow>
        ) : null}
      </tbody>
    </PTable>
  )
}

/** Lo traído y lo que falta de cada origen, plegado: es para mirar un hueco, no para todos los días. */
export function ImportCoverage({ rows }: { rows: readonly ImportSourceRow[] }) {
  const withStrip = rows.filter((row) => row.strip !== null)
  if (withStrip.length === 0) return null
  return (
    <details className="group/cover border-t border-border/70">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden">
        Ver qué está traído y qué falta
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform group-open/cover:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="grid gap-4 px-3 pt-1 pb-3 md:grid-cols-2 xl:grid-cols-3">
        {withStrip.map((row) =>
          row.strip ? (
            <div key={row.source} className="grid min-w-0 gap-1.5">
              <p className="text-sm font-medium">{row.name}</p>
              <CoverageStrip
                cells={row.strip.cells}
                granularity={row.strip.granularity}
                ariaLabel={row.strip.ariaLabel}
              />
            </div>
          ) : null,
        )}
      </div>
    </details>
  )
}
