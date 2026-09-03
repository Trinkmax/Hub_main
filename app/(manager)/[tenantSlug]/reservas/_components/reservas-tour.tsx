'use client'

import { ChevronRight } from 'lucide-react'
import { TourLauncher } from '@/components/tour/tour-launcher'
import type { TourDefinition } from '@/components/tour/types'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * Tutorial guiado de reservas — pensado para quien las gestiona en el día a
 * día (rol `host`): se auto-lanza en su primera visita a /reservas y queda
 * siempre disponible desde "¿Cómo funciona?".
 */
const RESERVAS_TOUR: TourDefinition = (() => {
  return {
    id: 'reservas@1',
    title: 'Gestionar reservas',
    steps: [
      {
        id: 'bienvenida',
        kicker: '¡Hola! 👋',
        title: 'Este es tu tablero de reservas',
        body: (
          <>
            Todo lo del día en un solo lugar: quién viene, cuántos son, en qué zona y en qué estado
            está cada mesa. Te muestro lo importante en un minuto.
          </>
        ),
      },
      {
        id: 'dia',
        target: '[data-tour="reservas-dia"]',
        title: 'El día que estás viendo',
        body: (
          <>
            Movete con las flechas para ver otros días. El contador de cubiertos suma{' '}
            <strong>toda</strong> la gente del día —las mesas a la carta y las que vienen por un
            evento— sobre la capacidad total del salón. Si hay evento, abajo te muestra el desglose.
          </>
        ),
      },
      {
        id: 'nueva',
        target: '[data-tour="reservas-nueva"]',
        title: 'Cargar una reserva',
        body: (
          <>
            Nombre, teléfono, cuántos son, franja y zona. Mirá el <strong>gestor</strong> antes de
            guardar: ahí queda la comisión, y el combo se acuerda del último que usaste en este
            dispositivo. El teléfono además conecta al cliente con el club de puntos.
          </>
        ),
      },
      {
        id: 'lista',
        target: '[data-tour="reservas-lista"]',
        title: 'La lista del día',
        body: (
          <>
            Tocá cualquier reserva y se abre el <strong>panel rápido</strong>: desde ahí resolvés
            casi todo sin salir de esta pantalla.
          </>
        ),
      },
      {
        id: 'personas',
        target: '[data-tour="reservas-lista"]',
        kicker: 'Lo que más se pregunta 👥',
        title: 'La columna «Asistieron» es cuánta gente vino',
        body: (
          <ul className="list-disc space-y-1.5 pl-4">
            <li>
              El número gris con <strong>«sin contar»</strong> es <strong>lo que reservaron</strong>
              : está ahí como punto de partida, nadie lo confirmó.
            </li>
            <li>
              Tocás <strong>− / +</strong> y ese número pasa a ser{' '}
              <strong>la gente que vino de verdad</strong>. La reserva queda marcada como «llegó».
            </li>
            <li>
              ¿Te avisan antes que en vez de 4 van a ser 6? Eso es cambiar la reserva: entrá con{' '}
              <strong>Ver</strong>.
            </li>
          </ul>
        ),
        demo: (
          <div className="space-y-2.5">
            <div className="flex items-center justify-center gap-6 text-center">
              <span>
                <span className="block font-mono text-3xl font-semibold leading-none tabular-nums text-muted-foreground">
                  4
                </span>
                <span className="mt-1 block text-[10px] italic text-muted-foreground">
                  sin contar
                </span>
              </span>
              <span className="text-2xl text-muted-foreground">→</span>
              <span>
                <span className="block font-mono text-3xl font-semibold leading-none tabular-nums">
                  3
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  de 4 reservadas
                </span>
              </span>
            </div>
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              Un toque en <strong>−</strong> y quedó registrado que de 4 vinieron 3.
            </p>
          </div>
        ),
      },
      {
        id: 'pasar-lista',
        kicker: 'El cierre de la noche 📋',
        title: 'Pasar lista: todo el día de una',
        body: (
          <>
            El botón <strong>Pasar lista</strong> abre las reservas del día juntas. Tocá el{' '}
            <strong>✓</strong> en las que vinieron como reservaron, corregí con − / + las que no, y{' '}
            <strong>Guardar todo</strong>. El numerito del botón te dice cuántas faltan contar.
            <br />
            <span className="text-muted-foreground">
              Solo se guarda lo que tocaste: las que dejaste sin marcar quedan sin contar, no se dan
              por asistidas.
            </span>
          </>
        ),
      },
      {
        id: 'estados',
        kicker: 'El ciclo de la mesa',
        title: 'Llegó → Sentados → Mesa cerrada',
        body: (
          <>
            En el mismo panel rápido vas marcando los estados a medida que pasa la noche. La
            comisión se calcula al marcar <strong>Llegó</strong>, sobre la gente que vino — y los
            dueños la aprueban después desde el reporte. ¿No vinieron? <strong>No vino</strong>{' '}
            también está ahí, y esa no paga nada. Desde los chips de hora y zona cambiás esos datos
            al toque.
          </>
        ),
        demo: (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs font-medium">
              <span className="rounded-full bg-primary/15 px-2.5 py-1 text-primary">✓ Llegó</span>
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
              <span className="rounded-full bg-primary px-2.5 py-1 text-primary-foreground">
                Sentados
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
              <span className="rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground">
                Cerrar mesa
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded-full border border-border bg-card px-2 py-0.5">
                🕒 21:30
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-0.5">
                📍 Planta baja
              </span>
              <span>← tocá los chips para cambiarlos</span>
            </div>
          </div>
        ),
      },
      {
        id: 'filtros',
        target: '[data-tour="reservas-filtros"]',
        title: 'Buscar y filtrar',
        body: (
          <>
            Por nombre o teléfono, estado, zona o gestor. Con el rango de fechas ves semanas enteras
            (ideal para planificar un evento grande).
          </>
        ),
      },
      {
        id: 'operativo',
        target: '[data-tour="reservas-operativo-link"]',
        fallbackCentered: true,
        title: 'Panel operativo',
        body: (
          <>
            La vista en vivo del servicio, pensada para el teléfono: llegadas por horario, cupos y
            estados en tiempo real. Ideal para tener abierta durante la noche.
          </>
        ),
      },
      {
        id: 'comisiones',
        kicker: 'Lo tuyo 💰',
        title: 'Mirá lo que vas ganando',
        body: (
          <>
            En <strong>Mis números</strong> (en el menú lateral, sección Negocio) ves tus comisiones
            mes a mes: cuánto te corresponde por cada reserva, los bonus por eventos llenos y qué ya
            te pagaron.
          </>
        ),
      },
      {
        id: 'listo',
        kicker: '¡Eso es todo! ✨',
        title: 'Ya estás lista para el servicio',
        body: (
          <>
            El calendario de eventos tiene su propia guía en <strong>Agenda → Calendario</strong>. Y
            esta guía queda siempre en el botón <strong>¿Cómo funciona?</strong>.
          </>
        ),
      },
    ],
  }
})()

export function ReservasTourButton({ role }: { role: TenantRole }) {
  return <TourLauncher tour={RESERVAS_TOUR} currentRole={role} autoStartForRoles={['host']} />
}
