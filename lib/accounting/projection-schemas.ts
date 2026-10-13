/**
 * Validación de lo que guarda Ventas › Proyección y «Ventas contra caja»
 * (12/10/2026): los objetivos por día y lo que entró en cada caja. Sin
 * `'use server'`: el mismo esquema sirve en el cliente y en el servidor.
 * Los topes copian los de las RPC (`acc_save_sales_targets`,
 * `acc_save_daily_cash`).
 */

import { z } from 'zod'
import { isoDay, MAX_CENTS, uuidField } from './schemas'

/** La nota del día («2x1 burger»): hasta 120 caracteres, como la columna. */
export const TARGET_NOTE_MAX = 120
/** Dos meses de objetivos de una vez, como mucho. */
export const TARGET_ITEMS_MAX = 62
/** Cajas y bancos de un día. */
export const CASH_ITEMS_MAX = 50

const targetCents = z
  .number({ message: 'Revisá el objetivo.' })
  .int('El objetivo tiene que estar en centavos enteros.')
  .min(0, 'El objetivo va sin signo menos.')
  .max(MAX_CENTS, 'Ese objetivo es demasiado grande. Revisalo.')
  .nullable()
  // Un objetivo en cero es un día sin objetivo.
  .transform((v) => (v === 0 ? null : v))

const targetNote = z
  .string({ message: 'Revisá la nota.' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(TARGET_NOTE_MAX, `La nota puede tener hasta ${TARGET_NOTE_MAX} caracteres.`))
  .transform((v) => (v === '' ? null : v))
  .nullable()

/**
 * Viaja solo lo que cambia: sin `note` la nota del día queda como estaba, y
 * sin `targetCents`, el objetivo. `targetCents: null` saca el objetivo.
 */
const targetItem = z
  .object(
    {
      day: isoDay,
      targetCents: targetCents.optional(),
      note: targetNote.optional(),
    },
    { message: 'Revisá los datos.' },
  )
  .refine((v) => v.targetCents !== undefined || v.note !== undefined, {
    message: 'Falta el objetivo o la nota.',
  })

export const salesTargetsSchema = z.object(
  {
    items: z
      .array(targetItem, { message: 'Revisá la lista.' })
      .min(1, 'Cargá al menos un día.')
      .max(TARGET_ITEMS_MAX, `Hasta ${TARGET_ITEMS_MAX} días por vez.`)
      .refine((items) => new Set(items.map((i) => i.day)).size === items.length, {
        message: 'Hay un día repetido en la lista.',
      }),
  },
  { message: 'Revisá los datos.' },
)

export type SalesTargetsInput = z.infer<typeof salesTargetsSchema>

/** `null`: esa caja queda sin cargar ese día (que no es lo mismo que cero). */
const cashAmount = z
  .number({ message: 'Revisá el importe.' })
  .int('El importe tiene que estar en centavos enteros.')
  .min(0, 'El importe va sin signo menos.')
  .max(MAX_CENTS, 'Ese importe es demasiado grande. Revisalo.')
  .nullable()

export const dailyCashSchema = z.object(
  {
    day: isoDay,
    items: z
      .array(
        z.object(
          { treasuryAccountId: uuidField('Falta la caja.'), amountCents: cashAmount },
          { message: 'Revisá los datos.' },
        ),
        { message: 'Revisá la lista.' },
      )
      .max(CASH_ITEMS_MAX, `Hasta ${CASH_ITEMS_MAX} cajas por día.`)
      .refine((items) => new Set(items.map((i) => i.treasuryAccountId)).size === items.length, {
        message: 'Hay una caja repetida.',
      }),
  },
  { message: 'Revisá los datos.' },
)

export type DailyCashInput = z.infer<typeof dailyCashSchema>
