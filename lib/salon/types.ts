/**
 * Tipos manuales de la feature reservas de salón.
 *
 * Estos espejan exactamente las tablas creadas en
 * `supabase/migrations/20260520010000_salon_reservations_core.sql`.
 *
 * Permiten compilar el resto del código antes de que el usuario corra
 * `npm run db:types`. Cuando los types se regeneren, podemos reemplazar
 * estos por `Database['public']['Tables']['*']['Row']` y borrar este file.
 */

export type ReservationKind = 'normal' | 'birthday' | 'special'

export type MealType = 'breakfast' | 'lunch' | 'tea_time' | 'dinner' | 'hub_event'

export type ReservationOrigin =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'in_person'
  | 'partner_referral'

export type SalonZone = 'planta_alta' | 'planta_baja' | 'event_floating'

export type SalonReservationStatus =
  | 'pending'
  | 'arrived'
  | 'seated'
  | 'closed'
  | 'no_show'
  | 'cancelled'

export type ReservationManagerRow = {
  id: string
  tenant_id: string
  user_id: string | null
  display_name: string
  phone: string | null
  email: string | null
  commission_eligible: boolean
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type ScheduledEventTemplateRow = {
  id: string
  tenant_id: string
  name: string
  slug: string
  consume_special_reservations: boolean
  default_capacity: number | null
  default_meal_type: MealType
  color_hex: string
  active: boolean
  created_at: string
  updated_at: string
}

export type ScheduledEventRow = {
  id: string
  tenant_id: string
  template_id: string
  name_override: string | null
  event_date: string // YYYY-MM-DD
  starts_at_local: string // HH:MM:SS
  ends_at_local: string | null
  capacity: number
  meal_type: MealType
  full_bonus_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type SalonZoneCapacityOverrideRow = {
  id: string
  tenant_id: string
  zone: SalonZone
  override_date: string
  capacity: number
  reason: string | null
  created_at: string
}

export type SalonReservationRow = {
  id: string
  tenant_id: string
  customer_id: string | null
  guest_name: string
  guest_phone: string | null
  guest_email: string | null
  kind: ReservationKind
  meal_type: MealType
  reservation_date: string
  reservation_time_local: string
  zone: SalonZone
  scheduled_event_id: string | null
  estimated_guests: number
  actual_guests: number | null
  cake_count: number
  champagne_count: number
  deposit_cents: number
  origin: ReservationOrigin
  primary_manager_id: string
  assistant_manager_id: string | null
  comments: string | null
  status: SalonReservationStatus
  arrived_at: string | null
  seated_at: string | null
  closed_at: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  arrived_by: string | null
  seated_by: string | null
  closed_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CommissionRateTierRow = {
  id: string
  tenant_id: string
  meal_type: MealType
  min_guests: number
  max_guests: number | null
  rate_per_guest_cents: number
  active: boolean
  created_at: string
  updated_at: string
}

export type CommissionBonusRuleRow = {
  id: string
  tenant_id: string
  scope: 'scheduled_event_full'
  bonus_per_guest_cents: number
  active: boolean
  created_at: string
  updated_at: string
}

export type CommissionLedgerRow = {
  id: string
  tenant_id: string
  reservation_id: string
  manager_id: string
  meal_type: MealType
  guests_billed: number
  base_rate_per_guest_cents: number
  base_total_cents: number
  bonus_per_guest_cents: number
  bonus_total_cents: number
  split_factor_numerator: number
  split_factor_denominator: number
  payable_cents: number
  calculation_version: number
  calculated_at: string
  paid_at: string | null
  paid_payout_id: string | null
}

// ──────────────────────────────────────────────────────────
// Vistas compuestas que devuelven los queries del panel operativo / listas.
// ──────────────────────────────────────────────────────────

export type DayCapacityBucket = {
  bucket: string // 'zone:planta_alta' | 'zone:planta_baja' | 'event:<uuid>'
  used: number
  capacity: number
  available: number
}

export type ReservationWithJoins = SalonReservationRow & {
  primary_manager: Pick<ReservationManagerRow, 'id' | 'display_name'> | null
  assistant_manager: Pick<ReservationManagerRow, 'id' | 'display_name'> | null
  scheduled_event:
    | (Pick<ScheduledEventRow, 'id' | 'capacity' | 'starts_at_local' | 'meal_type'> & {
        template: Pick<
          ScheduledEventTemplateRow,
          'id' | 'name' | 'slug' | 'color_hex' | 'consume_special_reservations'
        > | null
      })
    | null
  customer: { id: string; first_name: string; last_name: string; phone: string } | null
}

export type ZoneCapacityLabels = Record<Exclude<SalonZone, 'event_floating'>, string>

export const ZONE_LABELS: ZoneCapacityLabels = {
  planta_alta: 'Planta Alta',
  planta_baja: 'Planta Baja',
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  tea_time: 'Merienda',
  dinner: 'Cena',
  hub_event: 'Evento HUB',
}

export const RESERVATION_KIND_LABELS: Record<ReservationKind, string> = {
  normal: 'Normal',
  birthday: 'Cumpleaños',
  special: 'Reserva especial',
}

export const ORIGIN_LABELS: Record<ReservationOrigin, string> = {
  whatsapp: 'WhatsApp Hub',
  instagram: 'Instagram Hub',
  messenger: 'Messenger Hub',
  in_person: 'Presencial Hub',
  partner_referral: 'Amigo/Conocido de socio',
}

export const STATUS_LABELS: Record<SalonReservationStatus, string> = {
  pending: 'Pendiente',
  arrived: 'Llegó',
  seated: 'Sentada',
  closed: 'Cerrada',
  no_show: 'No vino',
  cancelled: 'Cancelada',
}
