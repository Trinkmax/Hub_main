import type { ElementRow } from '@/lib/floor-plan/queries'

/** Nombre es-AR de cada tipo de elemento del plano (etiquetas y títulos). */
export const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
  door: 'Puerta',
  text: 'Texto',
  stage: 'Escenario',
  booth: 'Box',
}

/** Con artículo, para las preguntas de confirmación: «¿Borrar la pared «Fondo»?». */
export const KIND_WITH_ARTICLE: Record<ElementRow['kind'], string> = {
  table: 'la mesa',
  wall: 'la pared',
  pillar: 'la columna',
  island: 'la isla',
  bar: 'la barra',
  door: 'la puerta',
  text: 'el texto',
  stage: 'el escenario',
  booth: 'el box',
}
