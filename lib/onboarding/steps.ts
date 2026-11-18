/**
 * Los primeros pasos de un bar nuevo. PURO: lo leen la lista del Resumen
 * (`onboarding-checklist.tsx`) y Tex («qué falta configurar»), así dicen lo mismo.
 *
 * Reemplaza a dos cosas que se pisaban: el asistente de primer arranque (una pantalla aparte que
 * todavía hablaba de «recibir pedidos por QR» y «panel de cocina», del servicio de mesa anterior) y
 * la lista de cinco pasos del Resumen.
 */

export type SetupStatus = {
  menuReady: boolean
  clubReady: boolean
  teamReady: boolean
  capacitiesReady: boolean
  templatesReady: boolean
  eventScheduledReady: boolean
  firstReservationReady: boolean
  firstArrivalReady: boolean
}

export type SetupStep = {
  key: keyof SetupStatus
  title: string
  description: string
  cta: string
  href: (slug: string) => string
}

/** En el orden en que conviene hacerlos: primero lo que ve el cliente, después la agenda. */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    key: 'menuReady',
    title: 'Cargá tu carta',
    description:
      'Las categorías y los productos con su precio. Es lo que ve la gente al escanear el QR de la carta.',
    cta: 'Abrir la carta',
    href: (slug) => `/${slug}/menu`,
  },
  {
    key: 'clubReady',
    title: 'Armá el club',
    description: 'Cuántos puntos da cada compra y qué se puede canjear con ellos.',
    cta: 'Abrir el club',
    href: (slug) => `/${slug}/club`,
  },
  {
    key: 'teamReady',
    title: 'Sumá a tu equipo',
    description: 'Cada persona entra con su usuario y ve solo lo suyo: socios, anfitriona, mozos.',
    cta: 'Sumar gente',
    href: (slug) => `/${slug}/configuracion/equipo`,
  },
  {
    key: 'capacitiesReady',
    title: 'Definí cuánta gente entra',
    description:
      'El cupo de cada servicio. Con eso el sistema avisa cuando una noche se está llenando.',
    cta: 'Cargar la capacidad',
    href: (slug) => `/${slug}/configuracion/salon`,
  },
  {
    key: 'templatesReady',
    title: 'Creá los formatos de tus eventos',
    description:
      'Sushi libre, Pizza libre, Noche de cine: lo que después ponés en una fecha del calendario.',
    cta: 'Crear formatos',
    href: (slug) => `/${slug}/eventos/programados?tab=eventos`,
  },
  {
    key: 'eventScheduledReady',
    title: 'Poné el primer evento en el calendario',
    description: 'Elegí un formato y una fecha. Las reservas de esa noche se anotan en ese evento.',
    cta: 'Abrir el calendario',
    href: (slug) => `/${slug}/eventos/programados`,
  },
  {
    key: 'firstReservationReady',
    title: 'Cargá la primera reserva',
    description: 'Nombre, teléfono, cuántos son y a qué hora. Menos de medio minuto.',
    cta: 'Nueva reserva',
    href: (slug) => `/${slug}/reservas/nuevo`,
  },
  {
    key: 'firstArrivalReady',
    title: 'Marcá la primera llegada',
    description:
      'La noche de la reserva, tocá «Llegó» en el Operativo. Con eso se calcula la comisión y se llenan los números del Resumen.',
    cta: 'Abrir el Operativo',
    href: (slug) => `/${slug}/operativo`,
  },
]

/** Los pasos que faltan, por su título. */
export function pendingSetupTitles(status: SetupStatus): string[] {
  return SETUP_STEPS.filter((step) => !status[step.key]).map((step) => step.title)
}

/** ¿Está todo hecho? */
export function setupDone(status: SetupStatus): boolean {
  return SETUP_STEPS.every((step) => status[step.key])
}
