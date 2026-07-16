'use client'

import { Camera, Handshake, Stamp } from 'lucide-react'
import { TourLauncher } from '@/components/tour/tour-launcher'
import type { TourDefinition } from '@/components/tour/types'

/** Tutorial del Club de beneficios: estructura, dónde va cada cosa y cómo se cargan las fotos. */
const CLUB_TOUR: TourDefinition = {
  id: 'club@1',
  title: 'Armar el club',
  steps: [
    {
      id: 'bienvenida',
      kicker: 'Fidelización ⭐',
      title: 'El club en una pantalla',
      body: (
        <>
          La lógica es simple: el cliente <strong>gana puntos</strong> al consumir, con la actividad{' '}
          <strong>sube de nivel</strong> y los puntos los <strong>canjea</strong> por recompensas.
          Todo lo que configures acá aparece al instante en su wallet.
        </>
      ),
    },
    {
      id: 'tabs',
      target: '[data-tour="club-tabs"]',
      title: 'Las cuatro áreas',
      body: (
        <>
          <strong>Puntos y niveles</strong> es el programa (reglas, niveles, recompensas).{' '}
          <strong>Aliados</strong> son marcas amigas con descuentos. <strong>Bienvenida</strong> es
          el regalo del primer registro. <strong>Punch cards</strong> son tarjetas de sellos («10
          cafés → 1 gratis»).
        </>
      ),
    },
    {
      id: 'fotos',
      kicker: 'Lo visual vende 📸',
      title: 'Las fotos se cargan tocándolas',
      body: (
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            <strong>Recompensas</strong>: tocá la imagen de la card (o «Subir foto» si está vacía).
          </li>
          <li>
            <strong>Aliados</strong>: tocá el circulito del logo en la fila, o subilo al crear la
            marca.
          </li>
          <li>
            <strong>Punch cards</strong>: la miniatura de cada tarjeta.
          </li>
          <li>Se optimizan solas — no hace falta achicarlas antes.</li>
        </ul>
      ),
      demo: (
        <div className="flex items-center justify-center gap-4">
          <span className="relative flex aspect-[4/3] w-24 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium">
              <Camera className="size-3" aria-hidden />
              Subir foto
            </span>
          </span>
          <span className="relative flex size-12 items-center justify-center rounded-full border border-border bg-card">
            <Handshake className="size-5 text-muted-foreground" aria-hidden />
            <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-3" aria-hidden />
            </span>
          </span>
          <span className="relative flex size-12 items-center justify-center rounded-lg bg-secondary">
            <Stamp className="size-5 text-muted-foreground" aria-hidden />
            <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-3" aria-hidden />
            </span>
          </span>
        </div>
      ),
    },
    {
      id: 'simular',
      target: '[data-tour="club-simular"]',
      fallbackCentered: true,
      title: 'Mirá el club como lo ve el socio',
      body: (
        <>
          El simulador muestra el wallet real con tu configuración: niveles, beneficios, recompensas
          con sus fotos. Dale una pasada después de cada cambio grande.
        </>
      ),
    },
    {
      id: 'listo',
      kicker: '¡Listo! ✨',
      title: 'Un club que dan ganas de usar',
      body: (
        <>
          Consejo: activá primero pocas recompensas pero <strong>con foto</strong> — se canjean
          mucho más. Esta guía queda en <strong>¿Cómo funciona?</strong> cuando la necesites.
        </>
      ),
    },
  ],
}

export function ClubTourButton(): React.JSX.Element {
  return <TourLauncher tour={CLUB_TOUR} currentRole="owner" autoStartForRoles={[]} />
}
