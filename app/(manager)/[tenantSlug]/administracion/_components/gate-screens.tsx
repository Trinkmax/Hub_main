import type { ReactNode } from 'react'
import { AdmPage } from '@/components/administracion/kit/adm-page'
import { DoorSign } from '@/components/administracion/puerta/door-sign'
import { PersonChip } from '@/components/administracion/puerta/person-chip'
import { CopyButton } from '@/components/ui/copy-button'

/**
 * La puerta de Administración (H.18): lo que ve quien todavía no puede entrar.
 * Las tres pantallas tienen la misma forma, la de un cartel colgado en la
 * puerta: una palabra, qué pasa en una oración y a quién pedírselo, con su
 * nombre a la vista (nunca un email). Acá no se decide nada: quién ve cuál lo
 * resuelve el layout, con las mismas reglas de siempre.
 */

/** «Franco» · «Franco y Nacho» · «Franco, Nacho y Luz». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** El mensaje listo para pegar en WhatsApp. Dice dónde se hace, para quien da los accesos. */
export const ACCESS_REQUEST_MESSAGE =
  'Hola, ¿me habilitás en Administración? Se hace en Administración › Ajustes › Accesos.'

/** «Pedile acceso a» + una ficha por persona. El grupo dice la frase entera para lectores. */
function People({ lead, names }: { lead: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return (
    // biome-ignore lint/a11y/useSemanticElements: un grupo con nombre, no un fieldset de formulario
    <div
      role="group"
      aria-label={`${lead} ${joinNames(names)}`}
      // `w-full`: sin ancho propio, el grupo medía lo que sus fichas y un nombre largo (o cinco
      // personas) se salía de la pantalla del celular en vez de cortarse y bajar de renglón.
      className="grid w-full min-w-0 gap-2.5"
    >
      <p aria-hidden className="text-sm text-muted-foreground">
        {lead}
      </p>
      <ul className="flex min-w-0 flex-wrap justify-center gap-2">
        {names.map((name) => (
          <li key={name} className="min-w-0 max-w-full">
            <PersonChip name={name} framed size="sm" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Door({
  word,
  title,
  sentence,
  children,
}: {
  /** La palabra del cartel. */
  word: string
  title: string
  sentence: string
  /** A quién pedírselo y, si hay algo para hacer, la acción. */
  children?: ReactNode
}) {
  return (
    <AdmPage
      width="compact"
      className="flex min-h-[72dvh] flex-col items-center justify-center space-y-0 text-center"
    >
      <DoorSign word={word} />
      <h1 className="mt-7 font-serif text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">
        {title}
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground text-pretty">
        {sentence}
      </p>
      {children ? <div className="mt-6 grid justify-items-center gap-5">{children}</div> : null}
    </AdmPage>
  )
}

/** El bar tiene Administración apagada y entra la contadora (H.18). */
export function AdministracionApagada() {
  return (
    <Door
      word="Apagada"
      title="Administración está apagada"
      sentence="Avisales a los dueños: cuando la vuelvan a prender, vas a ver acá los libros y las cuentas."
    />
  )
}

/** Todavía nadie hizo la puesta en marcha (contadora, o dueño que no la hace). */
export function AdministracionPendiente({
  who,
  adminNames,
}: {
  who: 'accountant' | 'owner'
  adminNames: readonly string[]
}) {
  if (who === 'accountant') {
    return (
      <Door
        word="Pronto"
        title="Todavía no está lista"
        sentence="Cuando los dueños la configuren, vas a ver acá los libros, el IVA y las cuentas corrientes."
      />
    )
  }
  return (
    <Door
      word="Pronto"
      title="Todavía no está lista"
      sentence="La está configurando otro socio. Cuando termine, te puede habilitar desde Ajustes › Accesos."
    >
      <People lead="La configura" names={adminNames} />
    </Door>
  )
}

/** Configurada, pero este dueño no tiene acceso (H.18). Nombres, nunca emails. */
export function AdministracionSinAcceso({ adminNames }: { adminNames: readonly string[] }) {
  return (
    <Door
      word="Privado"
      title="Administración es privada"
      sentence="La ven solo los socios habilitados y la contadora."
    >
      {adminNames.length > 0 ? (
        <People lead="Pedile acceso a" names={adminNames} />
      ) : (
        <p className="text-sm text-muted-foreground">Pedile acceso a quien la administra.</p>
      )}
      <div className="grid justify-items-center gap-1.5">
        <CopyButton
          value={ACCESS_REQUEST_MESSAGE}
          label="Copiar el mensaje para pedirlo"
          copiedLabel="Copiado: pegalo en WhatsApp"
          size="default"
          className="h-11 gap-2 rounded-full px-5"
        />
        <p className="max-w-xs text-xs text-muted-foreground text-pretty">
          «{ACCESS_REQUEST_MESSAGE}»
        </p>
      </div>
    </Door>
  )
}
