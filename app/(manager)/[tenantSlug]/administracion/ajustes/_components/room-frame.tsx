import type { ReactNode } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { PillLink } from '@/components/administracion/kit/pill'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { otherRooms, ROOMS, type RoomKey, roomHref } from '../_lib/rooms'

/**
 * El marco de cada habitación de Ajustes: arriba, el «volver» a la portada (la
 * portada es el único índice: no hay una segunda barra de pestañas, ni en la
 * compu ni en el celular), el nombre de la habitación —el mismo con el que el
 * resto de la app manda acá— y una oración que dice para qué sirve. Al pie,
 * «Otros ajustes», para pasar a otra sin volver.
 */

/** «Otros ajustes»: un link por habitación, menos la que se está viendo. */
export function RoomSwitcher({ base, current }: { base: string; current: RoomKey }) {
  return (
    <nav aria-labelledby="aj-otros" className="border-t border-border/60 pt-5">
      <h2 id="aj-otros" className="text-sm font-medium text-muted-foreground">
        Otros ajustes
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {otherRooms(current).map((room) => (
          <li key={room}>
            <PillLink
              href={roomHref(base, room)}
              size="touch"
              className="md:h-9 md:px-3 md:text-[13px]"
            >
              {ROOMS[room].title}
            </PillLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function RoomFrame({
  base,
  room,
  description,
  children,
}: {
  /** `/<bar>/administracion`. */
  base: string
  room: RoomKey
  /** Reemplaza la oración de `ROOMS` cuando lleva un link adentro. */
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}/ajustes`, label: 'Ajustes' }}
        title={ROOMS[room].title}
        badge={<ReadOnlyBadge />}
        description={description ?? ROOMS[room].description}
      />
      {children}
      <RoomSwitcher base={base} current={room} />
    </AdmPage>
  )
}
