'use client'

import { TourLauncher } from '@/components/tour/tour-launcher'
import type { TourDefinition } from '@/components/tour/types'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * Tutorial del calendario: formatos → servicios del día → reservar → buscar →
 * programar. Se auto-lanza para la anfitriona la primera vez que abre el
 * calendario: además de la lista de Reservas, desde acá también reserva.
 */
const EVENTOS_TOUR: TourDefinition = {
  // @2: el calendario pasó a ser también una puerta de las reservas, con el
  // día cortado por servicio. El sufijo es la clave de localStorage
  // (hub:tour:{id}), así que subirlo re-lanza el tour una vez a quien ya vio
  // el @1: justo lo que hace falta cuando cambian los gestos de la pantalla.
  // Que la lista de Reservas haya vuelto al menú no cambia nada de lo que
  // explica este tour, por eso sigue en @2.
  id: 'eventos@2',
  title: 'Calendario y reservas',
  steps: [
    {
      id: 'bienvenida',
      kicker: 'El mes del bar 📅',
      title: 'Así funciona el calendario',
      body: (
        <>
          Acá ves el mes, cargás las reservas y programás los eventos. Cada evento (Sushi Libre,
          Pizza Libre…) nace de un <strong>formato</strong> reutilizable: lo definís una vez y lo
          programás las veces que quieras.
        </>
      ),
    },
    {
      id: 'tabs',
      target: '[data-tour="eventos-tabs"]',
      title: 'Calendario y Formatos',
      body: (
        <>
          En <strong>Calendario</strong> ves el mes con sus reservas, eventos y cupos. En{' '}
          <strong>Formatos</strong> vive el catálogo: nombre, color, cupo por defecto y franja.
        </>
      ),
    },
    {
      id: 'servicios',
      target: '[data-tour="eventos-leyenda"]',
      // La leyenda vive en la pestaña Calendario: si se abrió en Formatos, el
      // paso igual se explica centrado.
      fallbackCentered: true,
      kicker: 'Nuevo ✨',
      title: 'Almuerzo, merienda y cena',
      body: (
        <>
          Cada día muestra almuerzo, merienda y cena por separado: personas sobre el cupo de cada
          servicio. <strong>Verde</strong> hay lugar, <strong>ámbar</strong> se está llenando,{' '}
          <strong>rojo</strong> te pasaste. Con el filtro de arriba ves una sola planta contra su
          cupo, o la gente de eventos que todavía está <strong>sin ubicar</strong>.
        </>
      ),
    },
    {
      id: 'mes',
      target: '[data-tour="eventos-mes"]',
      kicker: 'Nuevo ✨',
      title: 'Reservar es tocar',
      body: (
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            Tocá un día o un servicio para ver cómo viene y cargar una reserva con la hora ya
            puesta.
          </li>
          <li>Tocá un evento para reservar adentro.</li>
          <li>En la compu, arrastrá formatos y eventos como siempre.</li>
        </ul>
      ),
    },
    {
      id: 'buscar',
      target: '[data-tour="eventos-buscar"]',
      fallbackCentered: true,
      title: 'Buscar y exportar',
      body: <>Buscá una reserva por nombre o teléfono, o exportá el mes.</>,
    },
    {
      id: 'programar',
      target: '[data-tour="eventos-programar"]',
      fallbackCentered: true,
      title: 'O con el formulario',
      body: (
        <>
          Si preferís, programá desde acá: elegís formato, fecha, horario, cupo y los puntos que
          suma asistir. Las reservas del evento descuentan de su cupo.
        </>
      ),
    },
    {
      id: 'reservas-evento',
      kicker: 'La conexión 🔗',
      title: 'Eventos y reservas van juntos',
      body: (
        <>
          Una reserva adentro de un evento ocupa su cupo, y el cupo del evento se descuenta de la
          cena. Si el evento se llena, se activa el bonus de comisión para quien gestionó esas
          reservas.
        </>
      ),
    },
  ],
}

export function EventosTourButton({ role }: { role: TenantRole }) {
  return <TourLauncher tour={EVENTOS_TOUR} currentRole={role} autoStartForRoles={['host']} />
}
