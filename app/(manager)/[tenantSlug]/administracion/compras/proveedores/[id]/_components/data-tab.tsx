import { Mail, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { PaperArt } from '@/components/administracion/acciones/gasto-piezas'
import { categoryShortName, Panel, PanelSection } from '@/components/administracion/kit'
import { orderLeadText, WEEKDAYS } from '@/lib/accounting/party-profile'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { PartyDetail } from '@/lib/accounting/queries/parties'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import { cn } from '@/lib/utils'
import { paperOfVoucher } from '../../../_lib/purchase-paper'
import { documentText } from '../../../_lib/supplier-ledger'
import { SupplierActiveToggle } from './supplier-active-toggle'
import { SupplierDeleteButton } from './supplier-delete-button'
import { SupplierEditButton } from './supplier-edit'

const CONDITION_WORDS: Readonly<Record<string, string>> = {
  responsable_inscripto: 'Responsable inscripto: te da Factura A o B.',
  monotributo: 'Monotributo: te da Factura C.',
  exento: 'Exento: te da Factura B o C.',
  consumidor_final: 'Consumidor final.',
  no_alcanzado: 'No alcanzado por el IVA.',
}

const TOUCH_LINK =
  'inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/** Un dato con su rótulo. Lo que falta se lee como falta (en gris), no como una raya. */
function Fact({
  label,
  missing = false,
  children,
}: {
  label: string
  missing?: boolean
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 text-sm', missing && 'text-muted-foreground')}>{children}</dd>
    </div>
  )
}

/** La semana de lunes a domingo, con los días en que trae la mercadería rellenos. */
function DeliveryWeek({ days }: { days: readonly number[] }) {
  const names = WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label)
  return (
    <div>
      <ul aria-hidden className="flex gap-1">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.value)
          return (
            <li
              key={d.value}
              className={cn(
                'flex h-9 w-10 items-center justify-center rounded-lg text-xs font-medium',
                on
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-dashed border-border text-muted-foreground',
              )}
            >
              {d.short}
            </li>
          )
        })}
      </ul>
      <p className="sr-only">Trae los {names.join(', ')}.</p>
    </div>
  )
}

/**
 * «Sus datos»: lo que se sabe de un proveedor, en el orden en que se consulta.
 *
 * 1. **Para pedirle**: a quién llamar (cada teléfono es un `tel:` y cada mail un
 *    `mailto:`: un toque llama), qué días trae y con cuánto aviso.
 * 2. **Para cargarle**: en qué le comprás, qué papel te da y a cuántos días le
 *    pagás (lo que hace que la próxima compra sea de un toque).
 * 3. **Datos fiscales**: razón social, documento y cómo te factura.
 *
 * El dueño los edita con [Editar datos] (el diálogo lo monta la página una sola
 * vez); al fondo, callados, [Desactivar] y [Eliminar], con las reglas de
 * siempre (solo sin saldo; «Eliminar» solo si no es del sistema). La contadora
 * ve lo mismo sin ningún botón.
 */
export function DataTab({
  tenantSlug,
  party,
  canWrite,
  hasBalance,
  verification,
}: {
  tenantSlug: string
  party: PartyDetail
  canWrite: boolean
  hasBalance: boolean
  /** «Verificado en ARCA el …», al lado del documento. */
  verification?: ReactNode
}) {
  const document = documentText(party.taxIdType, party.taxId)
  const contacts = [
    ...(party.phone || party.email
      ? [{ name: null, role: null, phone: party.phone, email: party.email }]
      : []),
    ...party.contacts,
  ]
  const paper = paperOfVoucher(party.defaultVoucherType)
  const lead = orderLeadText(party.orderLeadDays)

  return (
    <Panel
      title="Sus datos"
      description="Con esto te proponemos el papel, la categoría y el vencimiento."
      action={canWrite ? <SupplierEditButton /> : undefined}
    >
      <PanelSection title="Para pedirle">
        <dl className="grid gap-3.5">
          <Fact label="A quién llamar" missing={contacts.length === 0}>
            {contacts.length === 0 ? (
              'Sin teléfono cargado'
            ) : (
              <ul className="grid gap-1.5">
                {contacts.map((c) => (
                  <li
                    key={[c.name, c.role, c.phone, c.email].join('|')}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                  >
                    {c.name || c.role ? (
                      <span>
                        {c.name ? <span className="font-medium">{c.name}</span> : null}
                        {c.role ? (
                          <span className="text-muted-foreground">
                            {c.name ? ' · ' : ''}
                            {c.role}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {c.phone ? (
                      <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className={TOUCH_LINK}>
                        <Phone aria-hidden className="size-3.5" />
                        <span className="tabular-nums">{c.phone}</span>
                      </a>
                    ) : null}
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className={cn(TOUCH_LINK, 'break-all')}>
                        <Mail aria-hidden className="size-3.5 shrink-0" />
                        {c.email}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Fact>
          <Fact label="Qué días trae" missing={party.deliveryDays.length === 0}>
            {party.deliveryDays.length === 0 ? (
              'Todavía no dijiste qué días trae'
            ) : (
              <DeliveryWeek days={party.deliveryDays} />
            )}
          </Fact>
          <Fact label="Con cuánto aviso" missing={lead === null}>
            {lead === null
              ? 'Sin cargar'
              : party.orderLeadDays === 0
                ? 'Le pedís el mismo día.'
                : `Hay que pedirle ${lead}.`}
          </Fact>
          <Fact label="Dirección" missing={!party.address}>
            {party.address ?? 'Sin dirección'}
          </Fact>
          <Fact label="Observaciones" missing={!party.notes}>
            <span className="whitespace-pre-line">{party.notes ?? 'Sin observaciones'}</span>
          </Fact>
        </dl>
      </PanelSection>

      <PanelSection title="Para cargarle">
        <dl className="grid gap-3.5">
          <Fact label="En qué le comprás" missing={!party.defaultAccountName}>
            {party.defaultAccountName ? (
              <>
                {categoryShortName(party.defaultAccountName)}
                <span className="block text-xs text-muted-foreground">
                  En los libros va a «{party.defaultAccountName}».
                </span>
              </>
            ) : (
              'Sin categoría: te la preguntamos la primera vez que le cargues algo.'
            )}
          </Fact>
          <Fact label="Qué papel te da" missing={!party.defaultVoucherType}>
            {party.defaultVoucherType ? (
              <span className="flex items-center gap-2.5">
                {paper ? <PaperArt kind={paper} className="h-9 w-[1.9rem]" /> : null}
                {voucherLabel(party.defaultVoucherType)}
              </span>
            ) : (
              'El del último que le cargaste'
            )}
          </Fact>
          <Fact label="A cuántos días le pagás" missing={party.paymentTermDays === 0}>
            {party.paymentTermDays === 0
              ? 'Sin plazo: elegís cuándo vence en cada compra.'
              : `A ${party.paymentTermDays} ${party.paymentTermDays === 1 ? 'día' : 'días'}: el vencimiento de cada compra sale solo.`}
          </Fact>
        </dl>
      </PanelSection>

      <PanelSection title="Datos fiscales">
        <dl className="grid gap-3.5">
          <Fact label="Razón social">{party.name}</Fact>
          <Fact label="Nombre de fantasía" missing={!party.tradeName}>
            {party.tradeName ?? 'No tiene'}
          </Fact>
          <Fact label="Tipo">{PARTY_KIND_LABELS[party.kind] ?? 'Otro'}</Fact>
          <Fact label="Documento" missing={document === null}>
            {document ?? 'Sin documento cargado'}
            {document && verification ? <div className="mt-1">{verification}</div> : null}
          </Fact>
          <Fact label="Cómo te factura" missing={party.ivaCondition === 'sin_datos'}>
            {CONDITION_WORDS[party.ivaCondition] ??
              'Todavía no sabemos: te lo preguntamos con la primera factura.'}
          </Fact>
          <Fact label="Estado">{party.active ? 'Activo' : 'Desactivado'}</Fact>
        </dl>
      </PanelSection>

      {canWrite ? (
        <PanelSection>
          <div className="flex flex-wrap items-center gap-2">
            <SupplierActiveToggle
              tenantSlug={tenantSlug}
              id={party.id}
              name={party.name}
              kind={party.kind}
              active={party.active}
              updatedAt={party.updatedAt}
              hasBalance={hasBalance}
            />
            {party.systemKey === null ? (
              <SupplierDeleteButton
                tenantSlug={tenantSlug}
                id={party.id}
                name={party.name}
                updatedAt={party.updatedAt}
                hasBalance={hasBalance}
              />
            ) : null}
          </div>
        </PanelSection>
      ) : null}
    </Panel>
  )
}
