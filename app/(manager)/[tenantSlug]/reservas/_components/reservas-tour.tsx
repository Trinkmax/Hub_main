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
            Movete con las flechas para ver otros días. El contador de cubiertos te dice cuántos
            lugares quedan sobre la capacidad total del salón.
          </>
        ),
      },
      {
        id: 'nueva',
        target: '[data-tour="reservas-nueva"]',
        title: 'Cargar una reserva',
        body: (
          <>
            Nombre, teléfono, cuántos son, franja y zona — y el gestor sos vos, así la comisión
            queda a tu nombre. El teléfono además conecta al cliente con el club de puntos.
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
        kicker: 'El caso de todos los findes 👥',
        title: '«Reservé para 6… al final somos 10»',
        body: (
          <ul className="list-disc space-y-1.5 pl-4">
            <li>
              Tocá la reserva y usá el <strong>− / +</strong> grande de arriba: cambia al instante y
              se guarda solo.
            </li>
            <li>Antes de sentarlos ajustás las personas esperadas.</li>
            <li>
              Con la mesa ya sentada, ajustás las <strong>personas reales</strong> — y tu comisión
              se recalcula sola.
            </li>
          </ul>
        ),
        demo: (
          <div className="space-y-2.5">
            <div className="flex items-center justify-center gap-5">
              <span className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-xl text-muted-foreground">
                −
              </span>
              <span className="text-center">
                <span className="block font-serif text-4xl font-semibold leading-none tabular-nums">
                  10
                </span>
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  personas
                </span>
              </span>
              <span className="relative flex size-11 items-center justify-center rounded-full bg-primary text-xl text-primary-foreground">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />+
              </span>
            </div>
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              Así se ve arriba del panel al tocar una reserva — pasar de 6 a 10 son cuatro toques en
              el <strong>+</strong>.
            </p>
          </div>
        ),
      },
      {
        id: 'estados',
        kicker: 'El ciclo de la mesa',
        title: 'Llegó → Sentados → Mesa cerrada',
        body: (
          <>
            En el mismo panel rápido vas marcando los estados a medida que pasa la noche. Cerrar la
            mesa es lo que liquida tu comisión. ¿No vinieron? <strong>No vino</strong> también está
            ahí. Y desde los chips de hora y zona cambiás esos datos al toque.
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
