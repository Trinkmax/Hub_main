import {
  AtSign,
  BellOff,
  BellRing,
  CalendarDays,
  ExternalLink,
  Receipt,
  ShieldAlert,
  UserPlus,
  Utensils,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { formatRelativeDays } from '@/lib/bandeja/format'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import type { TierProgress } from '@/lib/points/tiers'
import { WaAvatar } from './wa-avatar'

export type PanelCustomer = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
  category_points: number
  total_visits: number
  total_spent_cents: number
  last_visit_at: string | null
  opt_in_marketing: boolean
  is_blocked: boolean
  notes: string | null
  tags: { id: string; name: string; color: string }[]
}

export type PanelInsights = {
  avgTicketCents: number | null
  favoriteItem: string | null
}

function pesos(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`
}

function Block({ children }: { children: React.ReactNode }) {
  return <section className="bg-(--wa-panel) px-5 py-4">{children}</section>
}

function BlockTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-medium text-(--wa-muted)">{children}</h3>
}

/**
 * "Ficha del cliente" dentro del chat: todo lo que el bar sabe de esta persona
 * (puntos, categoría, visitas, promos) sin salir de la conversación.
 */
export function ContactPanel({
  tenantSlug,
  display,
  avatarSeed,
  phoneDisplay,
  channelType,
  customer,
  tier,
  insights,
  assignedTags,
  canViewProfile,
}: {
  tenantSlug: string
  display: string
  avatarSeed: string
  phoneDisplay: string | null
  channelType: 'whatsapp' | 'instagram'
  customer: PanelCustomer | null
  tier: TierProgress | null
  insights: PanelInsights | null
  assignedTags: ConversationTag[]
  canViewProfile: boolean
}) {
  return (
    <div className="flex flex-col gap-2 pb-6">
      {/* Hero */}
      <Block>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <WaAvatar
            seed={avatarSeed}
            label={(display || '?').charAt(0).toUpperCase()}
            className="size-28 text-4xl"
          />
          <div>
            <p className="text-lg font-semibold text-(--wa-text)">{display}</p>
            <p className="flex items-center justify-center gap-1.5 text-sm text-(--wa-muted)">
              {channelType === 'instagram' ? (
                <>
                  <AtSign className="size-3.5" aria-hidden />
                  Instagram
                </>
              ) : (
                (phoneDisplay ?? 'WhatsApp')
              )}
            </p>
          </div>
        </div>
      </Block>

      {customer ? (
        <>
          {/* Club de puntos */}
          <Block>
            <BlockTitle>Club de puntos</BlockTitle>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl font-semibold tabular-nums text-(--wa-text)">
                {customer.points_balance.toLocaleString('es-AR')}
              </span>
              <span className="text-sm text-(--wa-muted)">puntos para canjear</span>
            </div>

            {tier?.current || tier?.next ? (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  {tier.current ? (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: tier.current.color ? `${tier.current.color}26` : undefined,
                        color: tier.current.color ?? 'var(--wa-text)',
                      }}
                    >
                      {tier.current.name}
                    </span>
                  ) : (
                    <span className="text-xs text-(--wa-muted)">Sin categoría todavía</span>
                  )}
                  {tier.next && tier.pointsToNext != null ? (
                    <span className="text-xs text-(--wa-muted)">
                      {tier.pointsToNext.toLocaleString('es-AR')} pts para {tier.next.name}
                    </span>
                  ) : null}
                </div>
                {tier.next ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-(--wa-panel-soft)">
                    <div
                      className="h-full rounded-full bg-(--wa-accent)"
                      style={{ width: `${Math.min(100, Math.max(0, tier.pct))}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-(--wa-muted)" aria-hidden />
                <div>
                  <dt className="text-[11px] text-(--wa-muted)">Visitas</dt>
                  <dd className="text-sm font-medium tabular-nums text-(--wa-text)">
                    {customer.total_visits.toLocaleString('es-AR')}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Wallet className="mt-0.5 size-4 shrink-0 text-(--wa-muted)" aria-hidden />
                <div>
                  <dt className="text-[11px] text-(--wa-muted)">Gastó en total</dt>
                  <dd className="text-sm font-medium tabular-nums text-(--wa-text)">
                    {pesos(customer.total_spent_cents)}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-(--wa-muted)" aria-hidden />
                <div>
                  <dt className="text-[11px] text-(--wa-muted)">Última visita</dt>
                  <dd className="text-sm font-medium text-(--wa-text)">
                    {formatRelativeDays(customer.last_visit_at) ?? 'Nunca vino'}
                  </dd>
                </div>
              </div>
              {insights?.avgTicketCents != null ? (
                <div className="flex items-start gap-2">
                  <Receipt className="mt-0.5 size-4 shrink-0 text-(--wa-muted)" aria-hidden />
                  <div>
                    <dt className="text-[11px] text-(--wa-muted)">Gasto por visita</dt>
                    <dd className="text-sm font-medium tabular-nums text-(--wa-text)">
                      {pesos(insights.avgTicketCents)}
                    </dd>
                  </div>
                </div>
              ) : null}
            </dl>

            {insights?.favoriteItem ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-(--wa-panel-soft) px-3 py-2 text-sm text-(--wa-text)">
                <Utensils className="size-4 shrink-0 text-(--wa-muted)" aria-hidden />
                <span>
                  Lo que más pide: <strong>{insights.favoriteItem}</strong>
                </span>
              </p>
            ) : null}
          </Block>

          {/* Promociones */}
          <Block>
            <BlockTitle>Promociones</BlockTitle>
            {customer.is_blocked ? (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <ShieldAlert className="size-4 shrink-0" aria-hidden />
                Cliente bloqueado: no le mandes mensajes.
              </p>
            ) : customer.opt_in_marketing ? (
              <p className="flex items-center gap-2 text-sm text-(--wa-text)">
                <BellRing className="size-4 shrink-0 text-(--wa-accent)" aria-hidden />
                Aceptó recibir promos por WhatsApp.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-(--wa-muted)">
                <BellOff className="size-4 shrink-0" aria-hidden />
                No aceptó promos: solo respondele lo que pregunte.
              </p>
            )}
          </Block>
        </>
      ) : (
        <Block>
          <div className="space-y-3 py-2 text-center">
            <p className="text-sm text-(--wa-text-soft)">
              Esta persona todavía no está en tu lista de clientes, así que no ves sus puntos ni
              visitas.
            </p>
            <Link
              href={`/${tenantSlug}/clientes/nuevo`}
              className="inline-flex items-center gap-2 rounded-full bg-(--wa-accent) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--wa-accent-deep)"
            >
              <UserPlus className="size-4" aria-hidden />
              Crear cliente
            </Link>
            {phoneDisplay ? (
              <p className="text-xs text-(--wa-muted)">
                Usá el teléfono {phoneDisplay} al crearlo y la charla se vincula sola.
              </p>
            ) : null}
          </div>
        </Block>
      )}

      {/* Etiquetas de la charla */}
      {assignedTags.length > 0 ? (
        <Block>
          <BlockTitle>Etiquetas de la charla</BlockTitle>
          <div className="flex flex-wrap gap-1.5">
            {assignedTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: `${tag.color}26`, color: tag.color }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                  aria-hidden
                />
                {tag.name}
              </span>
            ))}
          </div>
        </Block>
      ) : null}

      {/* Nota interna */}
      {customer?.notes ? (
        <Block>
          <BlockTitle>Nota del equipo</BlockTitle>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-(--wa-text)">
            {customer.notes}
          </p>
        </Block>
      ) : null}

      {/* CTA */}
      {customer && canViewProfile ? (
        <Block>
          <Link
            href={`/${tenantSlug}/clientes/${customer.id}`}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-(--wa-border) py-2 text-sm font-medium text-(--wa-accent-deep) transition-colors hover:bg-(--wa-hover)"
          >
            <ExternalLink className="size-4" aria-hidden />
            Ver ficha completa
          </Link>
        </Block>
      ) : null}
    </div>
  )
}
