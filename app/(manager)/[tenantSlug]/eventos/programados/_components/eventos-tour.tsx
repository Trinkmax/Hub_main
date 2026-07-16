'use client'

import { TourLauncher } from '@/components/tour/tour-launcher'
import type { TourDefinition } from '@/components/tour/types'
import type { TenantRole } from '@/lib/tenant/types'

/** Tutorial del calendario de eventos (formatos → drag & drop → cupos → reservas). */
const EVENTOS_TOUR: TourDefinition = {
  id: 'eventos@1',
  title: 'Programar eventos',
  steps: [
    {
      id: 'bienvenida',
      kicker: 'El mes del bar 📅',
      title: 'Así funciona el calendario',
      body: (
        <>
          Cada evento (Sushi Libre, Pizza Libre…) nace de un <strong>formato</strong> reutilizable:
          definís el formato una vez y lo programás las veces que quieras.
        </>
      ),
    },
    {
      id: 'tabs',
      target: '[data-tour="eventos-tabs"]',
      title: 'Calendario y Formatos',
      body: (
        <>
          En <strong>Calendario</strong> ves el mes con sus eventos y cupos. En{' '}
          <strong>Formatos</strong> vive el catálogo: nombre, color, cupo por defecto y franja.
        </>
      ),
    },
    {
      id: 'mes',
      target: '[data-tour="eventos-mes"]',
      title: 'Programar es arrastrar',
      body: (
        <ul className="list-disc space-y-1.5 pl-4">
          <li>Arrastrá un formato hasta el día → confirmás hora y cupo, y listo.</li>
          <li>También podés mover un evento de fecha arrastrándolo.</li>
          <li>Tocá un día para ver sus reservas y cupos.</li>
        </ul>
      ),
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
          Una reserva atada a un evento ocupa su cupo, y si el evento se llena se activa el bonus de
          comisión para quien gestionó esas reservas. El detalle de cada evento muestra su ocupación
          en vivo.
        </>
      ),
    },
  ],
}

export function EventosTourButton({ role }: { role: TenantRole }) {
  return <TourLauncher tour={EVENTOS_TOUR} role={role} autoStartForRoles={['host']} />
}
