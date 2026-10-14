import { ArrowRight, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { PanelSection } from '@/components/administracion/kit/panel'
import { PanelLink } from '@/components/administracion/kit/panel-states'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { formatMonthYear } from '@/lib/dates'
import { ExportAllButton } from '../../_components/export-button'
import { monthNoun } from '../../_lib/months'
import { type PackageFile, packageCountText } from '../../_lib/package'

/**
 * El cuerpo del paso 3 de «Fin de mes»: mandarle los libros a la contadora. Sin
 * un envío de verdad (no hay dónde anotar «ya se lo mandé»), mandar es una de
 * dos cosas: que ella entre con su usuario de solo lectura, o bajarle los
 * archivos. Va primero «Que entre ella»: es un mensaje para pegar, no quince
 * descargas.
 *
 * Quién ve qué:
 * - un dueño ve si la contadora ya tiene usuario (y si no, «Sumar a la
 *   contadora», solo si administra los accesos);
 * - quien carga pero no es dueño no puede listar personas: copia el link;
 * - la contadora no ve «Que entre ella»: descarga.
 * Descargar no es cargar: el paquete se le ofrece a todos. Server-safe.
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
  /** La contadora (solo lectura). */
  | { kind: 'reader' }

export function SendStepBody({
  month,
  audience,
  link,
  inviteHref,
  files,
  downloadable,
  cuitHref,
  indexHref,
  receiptsHref,
  primary,
}: {
  /** `yyyy-MM`. */
  month: string
  audience: SendAudience
  /** El link absoluto a los libros del mes. */
  link: string
  /** Dónde se suma a la contadora (Configuración › Equipo). */
  inviteHref: string
  files: readonly PackageFile[]
  /** Los que se pueden descargar hoy (sin la CUIT, los de IVA quedan afuera). */
  downloadable: readonly PackageFile[]
  cuitHref: string
  /** «Ver archivo por archivo» → el índice de `/libros`. */
  indexHref: string
  /** Compras y pagos › Comprobantes. */
  receiptsHref: string
  /** Este paso es el que toca: su primera acción va rellena. */
  primary: boolean
}) {
  const noun = monthNoun(month)
  const message = sendMessage(month, link)
  const missing = files.length - downloadable.length
  const download = (variant: 'default' | 'outline') =>
    downloadable.length > 0 ? (
      <ExportAllButton
        label={`Descargar el paquete de ${noun}`}
        count={packageCountText(files.length, downloadable.length)}
        variant={variant}
        className="h-12 w-full px-5 sm:w-auto"
        files={downloadable.map((f) => ({ href: f.href, fileName: f.fileName, title: f.title }))}
      />
    ) : null
  const fileByFile = (
    <PanelLink href={indexHref}>
      Ver archivo por archivo
      <ArrowRight className="size-3.5" aria-hidden />
    </PanelLink>
  )

  if (audience.kind === 'reader') {
    return (
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        {download(primary ? 'default' : 'outline')}
        {fileByFile}
      </div>
    )
  }

  const hasAccountant = audience.kind === 'owner' && audience.accountants.length > 0
  const who = audience.kind === 'owner' ? namesText(audience.accountants) : ''
  const copyVariant = primary ? 'default' : 'outline'

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
              variant={copyVariant}
              size="default"
              className="h-12 w-full gap-2 px-5 sm:w-auto"
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
              variant={copyVariant}
              size="default"
              className="h-12 w-full max-w-full gap-2 px-5 sm:w-auto"
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
                variant={copyVariant}
                className="h-12 w-full gap-2 px-5 text-base sm:w-auto"
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
            Son {files.length} planillas (CSV) que se abren con Excel. Se descargan una atrás de la
            otra.
          </p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            {download('outline')}
            {fileByFile}
          </div>
          {missing > 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Se descargan {downloadable.length} de {files.length}: los {missing} de IVA necesitan
              la CUIT del bar. <PanelLink href={cuitHref}>Cargarla</PanelLink>
            </p>
          ) : null}
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
