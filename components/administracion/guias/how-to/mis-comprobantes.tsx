'use client'

import { CalendarClock, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { ScreenMisComprobantes, ScreenPortalSearch } from '../arca-mock/screens'
import { HowToNote, HowToShell, HowToStep } from './how-to-shell'

/**
 * «¿Cómo lo bajo?» de «Mis Comprobantes» (Recibidos) de ARCA (diseño §5.1.4; `arca-pasos.md`
 * §10): buscar el servicio, elegir la SAS, «Recibidos», «Mes Pasado» y «CSV», que baja un ZIP
 * que se arrastra tal cual. La usan el importador de ARCA y «Cómo arrancar» (contrato C1).
 */
export function HowToMisComprobantes({
  defaultOpen = false,
  className,
}: {
  defaultOpen?: boolean
  className?: string
}) {
  const accounting = useAccountingOptional()
  const guideHref = accounting
    ? `/${accounting.tenantSlug}/administracion/ajustes/arca#paso-10`
    : null
  return (
    <HowToShell
      subtitle="Las facturas que te hicieron tus proveedores, desde ARCA. Unos 5 minutos por mes."
      defaultOpen={defaultOpen}
      className={className}
    >
      <HowToNote icon={<CalendarClock className="size-4" />} title="Cuándo">
        Una vez por mes, del día 11 en adelante: las facturas pueden llegar tarde y ARCA muestra lo
        emitido solo hasta ayer.
      </HowToNote>
      <ol className="space-y-5">
        <HowToStep
          n={1}
          mock={
            <ScreenPortalSearch
              query="mis comprobantes"
              title="Mis Comprobantes"
              description="Consulta de Comprobantes Electrónicos Emitidos y Recibidos"
            />
          }
        >
          Entrá a ARCA con tu CUIT y tu clave fiscal, y en el buscador «¿Qué necesitás?» escribí{' '}
          <b>mis comprobantes</b>. Tocá la tarjeta «Mis Comprobantes».
        </HowToStep>
        <HowToStep n={2}>
          Si ARCA te pregunta a quién representás, elegí <b>la SAS</b> (no a vos).
          {guideHref ? (
            <>
              {' '}
              ¿No te aparece el servicio? Primero hay que habilitarlo:{' '}
              <Link
                href={guideHref}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                es el paso 10 de «Conectar ARCA»
              </Link>
              .
            </>
          ) : (
            ' Si no te aparece el servicio, primero hay que habilitarlo (paso 10 de «Conectar ARCA»).'
          )}
        </HowToStep>
        <HowToStep n={3} mock={<ScreenMisComprobantes step="inicio" />}>
          Tocá <b>«Recibidos»</b>: son las facturas que te hicieron a vos.
        </HowToStep>
        <HowToStep n={4} mock={<ScreenMisComprobantes step="consulta" />}>
          En «Fecha del Comprobante» elegí <b>«Mes Pasado»</b> (o del 1 del mes pasado a hoy), tocá
          «Aplicar» y después <b>«BUSCAR»</b>. Se puede pedir hasta un año de una vez.
        </HowToStep>
        <HowToStep n={5} mock={<ScreenMisComprobantes step="resultados" />}>
          Arriba de la tabla tocá <b>«CSV»</b>. Se baja un archivo <b>.zip</b>.
        </HowToStep>
        <HowToStep n={6}>
          Arrastrá ese <b>.zip tal cual</b> a la pantalla de importar. No hace falta abrirlo.
        </HowToStep>
      </ol>
      <HowToNote
        icon={<TriangleAlert className="size-4" />}
        title="No lo abras con Excel"
        tone="warning"
      >
        Si lo abrís y lo guardás con Excel, cambia los números y las fechas. Subí el .zip como lo
        bajaste.
      </HowToNote>
    </HowToShell>
  )
}
