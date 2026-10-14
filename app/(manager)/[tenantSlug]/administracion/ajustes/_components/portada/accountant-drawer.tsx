import { PillLink } from '@/components/administracion/kit/pill'
import { roomHref } from '../../_lib/rooms'

/**
 * El cajón de la contadora, al pie de la portada de Ajustes: lo que define
 * ella (el ejercicio y sus vencimientos, las reglas contables, la CUIT de
 * bancos y organismos, la revisión de integridad y las pruebas de ARCA). Va
 * aparte y callado para que el dueño no lo confunda con lo suyo: «si no te lo
 * pidió, no hace falta tocar nada».
 *
 * Para la contadora es al revés: es su zona y va PRIMERO, con otro título.
 *
 * Son links (la habitación vive en la URL), no acciones: nada se guarda acá.
 */
export function AccountantDrawer({ base, mine }: { base: string; mine: boolean }) {
  const links = [
    { label: 'Ejercicio y vencimientos', href: roomHref(base, 'ejercicio') },
    { label: 'Reglas contables', href: roomHref(base, 'ejercicio', { hash: 'reglas' }) },
    {
      label: 'CUIT de bancos y organismos',
      href: roomHref(base, 'medios', { tab: 'participes', hash: 'cuit' }),
    },
    { label: 'Revisar que todo cierre', href: roomHref(base, 'integridad') },
    { label: 'Pruebas de ARCA', href: roomHref(base, 'arca', { hash: 'homologacion' }) },
  ]
  return (
    <section aria-labelledby="aj-cajon" className="rounded-2xl bg-secondary/50 p-4 sm:p-5">
      <h2 id="aj-cajon" className="font-serif text-lg leading-snug font-semibold tracking-tight">
        {mine ? 'Tu zona' : 'Para la contadora'}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground text-pretty">
        {mine
          ? 'Lo que definís vos. Lo demás lo ves igual que los dueños, sin botones.'
          : 'Reglas y controles que define ella. Si no te los pidió, no hace falta tocar nada.'}
      </p>
      <ul className="mt-3.5 flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.label}>
            <PillLink href={link.href} size="touch" className="md:h-9 md:px-3 md:text-[13px]">
              {link.label}
            </PillLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
