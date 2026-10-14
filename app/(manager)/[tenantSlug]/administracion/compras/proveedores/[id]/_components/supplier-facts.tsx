import { CalendarClock, type LucideIcon, Plus, ReceiptText, Tag } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SupplierAccountButton } from '../../../_components/supplier-account-picker'
import type { SupplierFact } from '../../../_lib/supplier-ledger'
import { SupplierEditButton } from './supplier-edit'

const ICONS: Readonly<Record<SupplierFact['key'], LucideIcon>> = {
  category: Tag,
  invoicing: ReceiptText,
  term: CalendarClock,
}

const CHIP =
  'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-left text-sm leading-snug outline-none md:min-h-9'
const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Los tres datos de carga de un proveedor, al pie de su tapa: en qué le
 * comprás, cómo te factura y cuándo le pagás. Son los tres que hacen que la
 * próxima compra sea de un toque, por eso van a la vista (antes eran un renglón
 * gris: «CUIT · Responsable inscripto · Paga a 30 días»).
 *
 * - El que ESTÁ va relleno suave. La categoría se toca para cambiarla.
 * - El que FALTA va con contorno punteado y «＋» (es «falta», no «elegido») y
 *   se toca para cargarlo: la categoría abre su selector; cómo factura y el
 *   plazo abren «Editar datos».
 * - La contadora los que faltan los lee como texto («Sin categoría», «Sin
 *   plazo»): no hay nada para tocar.
 *
 * `onHero`: sobre la tapa verde (isla oscura). Sin eso, sobre la tapa crema.
 */
export function SupplierFacts({
  facts,
  partyId,
  supplierName,
  canWrite,
  canPickCategory,
  onHero,
  verification,
}: {
  facts: readonly SupplierFact[]
  partyId: string
  supplierName: string
  canWrite: boolean
  /** Se leyó el plan: la categoría se puede elegir desde acá (si no, se lee nada más). */
  canPickCategory: boolean
  onHero: boolean
  /** «Verificado en ARCA el …», debajo de cómo factura. */
  verification?: ReactNode
}) {
  const filled = onHero ? 'bg-white/8 text-adm-hero-fg' : 'bg-secondary/60 text-foreground'
  const missing = onHero
    ? 'border border-dashed border-white/35 text-adm-hero-fg hover:bg-white/8'
    : 'border border-dashed border-primary/40 text-primary hover:bg-accent'
  const quiet = onHero ? 'text-adm-hero-muted' : 'text-muted-foreground'

  return (
    <ul aria-label="Sus datos de carga" className="flex flex-wrap items-start gap-2">
      {facts.map((fact) => {
        const Icon = ICONS[fact.key]
        const body = (
          <>
            <Icon aria-hidden className={cn('size-4 shrink-0', quiet)} />
            {/* Si no entra, corta entre un dato y el otro, no en el medio de un CUIT. */}
            <span className="min-w-0">
              {fact.text.split(' · ').map((part, index) => (
                <Fragment key={part}>
                  {index > 0 ? ' ' : null}
                  <span className="inline-block max-w-full [overflow-wrap:anywhere]">
                    {index > 0 ? '· ' : ''}
                    {part}
                  </span>
                </Fragment>
              ))}
            </span>
          </>
        )
        const add = (
          <>
            <Plus aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0">{fact.missing}</span>
          </>
        )
        return (
          <li key={fact.key} className="max-w-full">
            {fact.set ? (
              fact.key === 'category' && canWrite && canPickCategory ? (
                <SupplierAccountButton
                  partyId={partyId}
                  supplierName={supplierName}
                  hasAccount
                  // El botón del selector trae su propio aspecto de link: acá es un chip.
                  className={cn(
                    CHIP,
                    FOCUS,
                    filled,
                    'font-normal no-underline hover:no-underline',
                    onHero ? 'hover:bg-white/12' : 'hover:bg-secondary',
                  )}
                >
                  {body}
                </SupplierAccountButton>
              ) : (
                <span className={cn(CHIP, filled)}>{body}</span>
              )
            ) : !canWrite || (fact.key === 'category' && !canPickCategory) ? (
              <span className={cn(CHIP, 'px-0', quiet)}>
                <Icon aria-hidden className="size-4 shrink-0" />
                {fact.missingReadOnly}
              </span>
            ) : fact.key === 'category' ? (
              <SupplierAccountButton
                partyId={partyId}
                supplierName={supplierName}
                hasAccount={false}
                className={cn(CHIP, FOCUS, missing, 'border-dashed')}
              >
                {add}
              </SupplierAccountButton>
            ) : (
              <SupplierEditButton chip className={cn(CHIP, FOCUS, missing)}>
                {add}
              </SupplierEditButton>
            )}
            {fact.key === 'invoicing' && fact.set && verification ? (
              <div className="mt-1 pl-3.5">{verification}</div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
