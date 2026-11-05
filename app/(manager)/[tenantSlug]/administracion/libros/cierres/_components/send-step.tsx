import { UserPlus } from 'lucide-react'
import Link from 'next/link'
import { PanelSection } from '@/components/administracion/kit/panel'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { formatMonthYear } from '@/lib/dates'
import { monthNoun } from '../../_lib/months'
import { OpenFoldLink } from './open-fold-link'

/**
 * Mandarle los libros a la contadora, con el mes cerrado. Sin un envío de verdad (no hay dónde anotar
 * «ya se lo mandé»), mandar es una de dos cosas: que ella entre con su usuario, o bajarle los archivos
 * con «Descargar los libros». Va primero «Que entre ella»: es un mensaje para pegar, no quince
 * descargas.
 *
 * Quién ve qué:
 * - un dueño ve si la contadora ya tiene usuario (y si no, «Sumar a la contadora», solo si administra
 *   los accesos);
 * - quien carga pero no es dueño no puede listar personas: copia el link.
 * La contadora no ve esto: los libros son para ella. Server-safe.
 */

/** «Ana», «Ana y Luis», «Ana, Luis y Marta». */
function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
}

/** El mensaje que se copia para pegar por WhatsApp o por mail. */
export function sendMessage(month: string, link: string): string {
  return `Ya cerramos ${formatMonthYear(month)}. Los libros están acá (entrás con tu usuario): ${link}`
}

/** Si el navegador no deja copiar, el texto está acá para seleccionarlo a mano. */
function CopyFallback({ label, value, rows }: { label: string; value: string; rows: number }) {
  return (
    <label className="block max-w-xl space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <textarea
        readOnly
        rows={rows}
        value={value}
        className="block w-full resize-none rounded-xl border border-border/70 bg-secondary/50 px-3 py-2 text-sm leading-relaxed break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )
}

export type SendAudience =
  /** Dueño: puede listar personas. `accountants` vacío = todavía no tiene usuario. */
  | { kind: 'owner'; accountants: readonly string[]; canInvite: boolean }
  /** Carga pero no es dueño: no puede listar personas. */
  | { kind: 'writer' }

export function SendStepBody({
  month,
  audience,
  link,
  inviteHref,
  fileCount,
  indexFold,
  receiptsHref,
}: {
  /** `yyyy-MM`. */
  month: string
  audience: SendAudience
  /** El link absoluto a los libros del mes. */
  link: string
  /** Dónde se suma a la contadora (Configuración › Equipo). */
  inviteHref: string
  /** Cuántas planillas trae el mes. */
  fileCount: number
  /** «Ver archivo por archivo»: el `id` del plegable con el índice, abajo en la misma pantalla. */
  indexFold: string
  /** Compras y pagos › Comprobantes. */
  receiptsHref: string
}) {
  const noun = monthNoun(month)
  const message = sendMessage(month, link)
  const hasAccountant = audience.kind === 'owner' && audience.accountants.length > 0
  const who = audience.kind === 'owner' ? namesText(audience.accountants) : ''

  return (
    <div>
      <PanelSection title="Que entre ella">
        {audience.kind === 'writer' ? (
          <div className="space-y-3">
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
              Tu contadora puede entrar con un usuario de solo lectura.
            </p>
            <CopyButton
              value={link}
              label={`Copiar el link de ${noun}`}
              copiedLabel="Copiado: pegáselo por WhatsApp o por mail."
              variant="outline"
              size="default"
              className="h-11 w-full gap-2 px-4 sm:w-auto md:pointer-fine:h-9"
            />
            <CopyFallback label="El link:" value={link} rows={2} />
          </div>
        ) : hasAccountant ? (
          <div className="space-y-3">
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
              <span className="font-medium text-foreground">{who}</span>{' '}
              {audience.accountants.length === 1
                ? 'ya tiene usuario de solo lectura: entra, mira y descarga lo que necesite. No puede cargar ni cambiar nada.'
                : 'ya tienen usuario de solo lectura: entran, miran y descargan lo que necesiten. No pueden cargar ni cambiar nada.'}
            </p>
            <CopyButton
              value={message}
              label={
                audience.accountants.length === 1
                  ? `Copiar el mensaje para ${who}`
                  : 'Copiar el mensaje'
              }
              copiedLabel="Copiado: pegáselo por WhatsApp o por mail."
              variant="outline"
              size="default"
              className="h-11 w-full max-w-full gap-2 px-4 sm:w-auto md:pointer-fine:h-9"
            />
            <CopyFallback label="El mensaje:" value={message} rows={3} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
              Tu contadora todavía no tiene usuario. Con el rol «Contabilidad» ve y descarga todo, y
              no puede cargar ni cambiar nada.
            </p>
            {audience.kind === 'owner' && audience.canInvite ? (
              <Button
                asChild
                variant="outline"
                className="h-11 w-full gap-2 px-4 sm:w-auto md:pointer-fine:h-9"
              >
                <Link href={inviteHref}>
                  <UserPlus className="size-4" aria-hidden />
                  Sumar a la contadora
                </Link>
              </Button>
            ) : (
              <p className="text-sm font-medium text-pretty">
                Pedile a quien administra los accesos que la sume.
              </p>
            )}
          </div>
        )}
      </PanelSection>

      <PanelSection title="O mandarle los archivos">
        <div className="space-y-3">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
            «Descargar los libros» baja {fileCount} planillas (CSV) que se abren con Excel, una
            atrás de la otra.
          </p>
          <OpenFoldLink
            target={indexFold}
            className="inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            Ver archivo por archivo
          </OpenFoldLink>
          <p className="text-xs text-muted-foreground text-pretty sm:hidden">
            En el celular se descargan de a uno: es más cómodo desde la compu.
          </p>
        </div>
      </PanelSection>

      <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
        Los libros llevan todo, con factura y sin factura. Si tu contadora quiere ver aparte lo que
        tiene factura, se filtra en{' '}
        <Link
          href={receiptsHref}
          className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Compras y pagos › Comprobantes
        </Link>
        .
      </p>
    </div>
  )
}
