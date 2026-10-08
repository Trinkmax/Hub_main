'use client'

import { ChevronRight, Laptop, Mail } from 'lucide-react'
import { MP_RELEASE_COLUMNS } from '@/lib/imports/mercadopago/release'
import { HowToNote, HowToShell, HowToStep } from './how-to-shell'

const MP_PATH = [
  'Informes y facturación',
  'Reportes de ventas y extractos de cuenta',
  'Liquidaciones',
] as const

/**
 * «¿Cómo lo bajo?» del reporte de Liquidaciones de Mercado Pago (diseño §5.1.4;
 * `mercadopago.md` §4.3): desde la compu, «Crear reporte» con hasta 60 días, esperar el mail y
 * bajarlo en .csv. La primera vez, la configuración del reporte. Contrato C1.
 */
export function HowToMercadoPago({
  defaultOpen = false,
  className,
}: {
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <HowToShell
      subtitle="El reporte de Liquidaciones de Mercado Pago: cobros, comisiones, impuestos y retiros."
      defaultOpen={defaultOpen}
      className={className}
    >
      <HowToNote icon={<Laptop className="size-4" />} title="Desde la compu">
        Mercado Pago no arma este reporte desde el celular: entrá desde una computadora.
      </HowToNote>
      <ol className="space-y-5">
        <HowToStep
          n={1}
          mock={
            <nav
              aria-label="Dónde está en Mercado Pago"
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background/60 p-3 text-xs"
            >
              {MP_PATH.map((part, i) => (
                <span key={part} className="inline-flex items-center gap-1.5">
                  {i > 0 ? (
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                  ) : null}
                  <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium">
                    {part}
                  </span>
                </span>
              ))}
            </nav>
          }
        >
          En Mercado Pago andá a{' '}
          <b>Informes y facturación › Reportes de ventas y extractos de cuenta › Liquidaciones</b>.
        </HowToStep>
        <HowToStep n={2}>
          Tocá <b>«Crear reporte»</b> y elegí las fechas: hasta <b>60 días</b> por reporte. Lo más
          cómodo es desde el día siguiente al último que subiste hasta ayer.
        </HowToStep>
        <HowToStep n={3}>
          Esperá el mail de Mercado Pago avisando que está listo y bajalo en <b>.csv</b> (no en
          Excel).
        </HowToStep>
        <HowToStep n={4}>
          Arrastrá el .csv a la pantalla de importar. Si un día ya estaba subido, no se carga dos
          veces.
        </HowToStep>
      </ol>
      <HowToNote icon={<Mail className="size-4" />} title="Solo la primera vez">
        <p>
          En la <b>configuración</b> del reporte de Liquidaciones elegí los encabezados en{' '}
          <b>inglés</b> y la zona horaria <b>GMT-03</b>, y fijate que estén tildadas las columnas
          que usamos.
        </p>
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            Ver las columnas
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Columnas del reporte">
            {MP_RELEASE_COLUMNS.map((column) => (
              <li
                key={column}
                className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {column}
              </li>
            ))}
          </ul>
        </details>
      </HowToNote>
    </HowToShell>
  )
}
