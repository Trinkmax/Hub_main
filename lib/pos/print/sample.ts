/**
 * La comanda de prueba — PURO.
 *
 * Lo que sale al tocar «Imprimir una prueba»: una comanda inventada que usa todo lo que una de verdad
 * puede traer (productos repetidos, formas distintas, una nota, un aviso de salud), para ver de una
 * vez si el papel, el ancho y la letra están bien.
 */
import { buildCards, type KitchenCard } from '@/lib/pos/kitchen/cards'
import type { KitchenQueue } from '@/lib/pos/types'

export function sampleCard(branchName: string, now: Date): KitchenCard {
  const mod = (label: string) => ({ id: label, label, group: 'Aclaraciones', delta_cents: 0 })
  const item = (
    id: string,
    name: string,
    quantity: number,
    modifiers: ReturnType<typeof mod>[] = [],
    notes: string | null = null,
  ) => ({
    id,
    menu_item_id: `prueba-${name}`,
    name,
    quantity,
    notes,
    modifiers,
    station_id: null,
    prep_status: 'queued' as const,
    started_at: null,
    ready_at: null,
  })
  const queue: KitchenQueue = {
    now: now.toISOString(),
    branch: { id: 'prueba', name: branchName, color: '#14532d' },
    settings: null,
    stations: [],
    tickets: [
      {
        id: 'prueba-0000',
        session_id: 'prueba',
        status: 'accepted',
        course: 1,
        fired_at: now.toISOString(),
        ready_at: null,
        kitchen_seen_at: null,
        is_practice: false,
        table_label: '12',
        area: 'Salón',
        alias: null,
        party_size: 4,
        kind: 'table',
        event: null,
        alerts: ['celiac'],
        items: [
          item('a', 'Cheese Burger', 2),
          item('b', 'Lomito completo', 1, [mod('Jugoso'), mod('Sin lechuga')]),
          item('c', 'Lomito completo', 1, [mod('Papas rústicas')], 'bien cocido'),
          item('d', 'Lomito completo', 1),
          item('e', 'Papas con cheddar', 1, [], 'para compartir'),
        ],
      },
    ],
  }
  const [card] = buildCards(queue, [])
  if (!card) throw new Error('sample_card_unavailable')
  return card
}
