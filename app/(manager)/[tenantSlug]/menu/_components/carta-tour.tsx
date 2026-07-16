'use client'

import { ImageIcon, Play } from 'lucide-react'
import { TourLauncher } from '@/components/tour/tour-launcher'
import type { TourDefinition } from '@/components/tour/types'
import type { TenantRole } from '@/lib/tenant/types'

/**
 * Tutorial guiado de carga de la carta — pensado para la diseñadora (rol
 * `editor`): se auto-lanza en su primera visita a /menu y queda siempre
 * disponible desde "¿Cómo funciona?".
 */
const CARTA_TOUR: TourDefinition = {
  id: 'carta-media@1',
  title: 'Cargar la carta',
  steps: [
    {
      id: 'bienvenida',
      kicker: '¡Hola! 👋',
      title: 'Acá se arma la carta',
      body: (
        <>
          Todo lo que cargues en esta pantalla es <strong>exactamente</strong> lo que ven los
          clientes al escanear el QR de la mesa. La carta se organiza en categorías (Tragos,
          Comida…) y dentro de cada una viven los ítems con su foto, precio y descripción.
        </>
      ),
    },
    {
      id: 'categorias',
      target: '[data-tour="menu-categorias"]',
      title: 'Navegá por categorías',
      body: (
        <>
          Tocá una categoría para entrar y ver sus ítems. El orden que tienen acá es el mismo que ve
          el cliente — arrastrá para reordenar lo que más quieras vender primero.
        </>
      ),
    },
    {
      id: 'nueva-categoria',
      target: '[data-tour="menu-nueva-categoria"]',
      title: 'Crear categorías',
      body: (
        <>
          Desde acá nacen las secciones de la carta. Dentro de una categoría también podés crear
          subcategorías (por ejemplo, Comida → Pizzas). Cada una puede tener su foto de portada:
          tocá su miniatura en la lista (o el menú ⋯ → Editar) para subirla.
        </>
      ),
    },
    {
      id: 'agregar-item',
      target: '[data-tour="menu-agregar-item"]',
      fallbackCentered: true,
      title: 'Cargar un ítem',
      body: (
        <>
          Entrá a una categoría y tocá <strong>Agregar ítem</strong>: nombre, precio (en pesos, sin
          centavos) y una descripción corta que dé ganas. Para editarlo después, tocalo y se abre
          una ventana con todo: datos, foto y video.
        </>
      ),
    },
    {
      id: 'fotos',
      kicker: 'Lo más importante 📸',
      title: 'La foto es la que vende',
      body: (
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            Tocá el ítem y, en la ventana que se abre, arrastrá la imagen o tocá{' '}
            <strong>Subir foto</strong>.
          </li>
          <li>
            Se optimiza sola al subirla — no hace falta achicarla antes (hasta 20 MB está bien).
          </li>
          <li>Ideal: luz natural, el plato protagonista, encuadre horizontal.</li>
        </ul>
      ),
      demo: (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-primary/50 bg-card px-4 py-5 text-center">
          <ImageIcon className="size-5 text-primary" />
          <span className="text-xs font-medium">Soltá la foto acá, o tocá «Subir foto»</span>
          <span className="text-[11px] text-muted-foreground">
            4,2 MB → 180 KB · se optimiza sola ✨
          </span>
        </div>
      ),
    },
    {
      id: 'videos',
      kicker: 'Nuevo 🎬',
      title: 'Video del ítem (opcional)',
      body: (
        <ul className="list-disc space-y-1.5 pl-4">
          <li>Clips cortos: hasta 90 segundos y 55 MB (mp4 va perfecto).</li>
          <li>Se muestra en el detalle del ítem, silenciado y en loop.</li>
          <li>La miniatura (poster) se genera sola al subirlo.</li>
        </ul>
      ),
      demo: (
        <div className="flex items-center justify-center gap-3 rounded-lg bg-card px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Play className="size-4 fill-current" />
          </span>
          <span className="text-left text-[11px] leading-snug text-muted-foreground">
            <span className="block text-xs font-medium text-foreground">clip-del-item.mp4</span>
            hasta 90 s · 55 MB · en el detalle se reproduce solo, sin sonido
          </span>
        </div>
      ),
    },
    {
      id: 'etiquetas',
      target: '[data-tour="menu-etiquetas"]',
      title: 'Etiquetas',
      body: (
        <>
          Vegano, Sin TACC, Picante… las etiquetas aparecen como chips de color en la carta y ayudan
          a elegir rápido. Se crean una vez y se asignan desde cada ítem.
        </>
      ),
    },
    {
      id: 'ver-carta',
      target: '[data-tour="menu-ver-carta"]',
      title: 'Mirá cómo quedó',
      body: (
        <>
          Abre la carta real, tal cual la ve el cliente en su teléfono. Dale una mirada después de
          cada tanda de carga — es la mejor forma de controlar fotos y orden.
        </>
      ),
    },
    {
      id: 'listo',
      kicker: '¡Eso es todo! ✨',
      title: 'Ya podés cargar la carta',
      body: (
        <>
          Cualquier duda, esta guía queda siempre en el botón <strong>¿Cómo funciona?</strong> de
          arriba. ¡Que queden unas fotos increíbles!
        </>
      ),
    },
  ],
}

export function CartaTourButton({ role }: { role: TenantRole }) {
  return <TourLauncher tour={CARTA_TOUR} currentRole={role} autoStartForRoles={['editor']} />
}
