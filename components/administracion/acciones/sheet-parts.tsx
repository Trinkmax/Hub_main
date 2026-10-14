import type { ReactNode } from 'react'
import { ActionSheetRequiredMark } from '../action-sheet'

/**
 * Lo que comparten las hojas de carga («Pagar», «Registrar un cobro», «Mover
 * plata», «¿Coincide la caja?», «Otra entrada o salida»): la pregunta en
 * Fraunces, el importe grande y los dos links de texto. Es lo que «Nuevo
 * gasto» tiene escrito adentro, copiado tal cual, para que una hoja no se vea
 * distinta de la otra. `administracion-gasto-papel.test.ts` comprueba que no
 * se desvíen de «Nuevo gasto».
 *
 *   <div className={SHEET_QUESTION_BLOCK}>
 *     <SheetQuestion id={ids.cajaLabel} required>¿De dónde sale?</SheetQuestion>
 *     <TreasuryPicker aria-labelledby={ids.cajaLabel} … />
 *   </div>
 *
 *   <MoneyField label="¿Cuánto entró?" fieldClassName={ACTION_SHEET_QUESTION_FIELD}
 *               className={BIG_MONEY_FIELD} … />
 *
 * Sirve igual en un componente de servidor: por eso la voz de la pregunta va
 * escrita acá y no importada de `action-sheet.tsx` (una constante de un módulo
 * `'use client'` no se puede leer desde el servidor).
 *
 * Cuándo NO:
 * - un campo común («Fecha», «Referencia», «Detalle») no es una pregunta: va
 *   con su `Label` de siempre. Las preguntas son las decisiones de la hoja,
 *   tres o cuatro como mucho;
 * - un solo importe grande por hoja (el número del que habla la hoja); los
 *   demás importes son `MoneyField` comunes;
 * - fuera de una hoja o de un paso a paso de carga: el título de un bloque de
 *   una pantalla es `Panel` / `PanelSection`, no una pregunta.
 */

/**
 * La voz de las preguntas de una hoja: Fraunces, un escalón debajo del título.
 * Es la misma cadena que `ACTION_SHEET_QUESTION` de `action-sheet.tsx`.
 */
const SHEET_QUESTION = 'font-serif text-lg leading-snug font-semibold tracking-tight'

/**
 * Una de las decisiones de la hoja, dicha como pregunta («¿Con qué pagás?»,
 * «¿A dónde entró?»). El `id` es el que usa su grupo como etiqueta
 * (`aria-labelledby` de un `TreasuryPicker`, de unos `ChoiceChips`…). Cuando
 * la pregunta es la etiqueta de un `MoneyField`, no va esta pieza: va
 * `ACTION_SHEET_QUESTION_FIELD` en su `fieldClassName`.
 */
export function SheetQuestion({
  id,
  required = false,
  children,
}: {
  id: string
  /** Suma el asterisco chico de «obligatoria». */
  required?: boolean
  children: ReactNode
}) {
  return (
    <span id={id} className={SHEET_QUESTION}>
      {children}
      {required ? <ActionSheetRequiredMark /> : null}
    </span>
  )
}

/**
 * El envoltorio de una pregunta con lo que se contesta debajo. Una sola
 * columna que se puede achicar (`minmax(0, 1fr)`): con la columna automática
 * de un `grid` pelado, un nombre largo adentro la estiraba y lo de la derecha
 * se salía de la hoja.
 */
export const SHEET_QUESTION_BLOCK = 'grid grid-cols-[minmax(0,1fr)] gap-2.5'

/**
 * El importe grande de una hoja (64 px de alto, el número en Fraunces): va en
 * el `className` del `MoneyField` del que habla la hoja («¿Cuánto gastaste?»,
 * «¿Cuánto te entró?»).
 */
export const BIG_MONEY_FIELD =
  '[&_input]:h-16 [&_input]:rounded-2xl [&_input]:bg-card [&_input]:pl-11 [&_input]:font-serif [&_input]:text-[2rem] [&_input]:font-semibold [&_input]:tracking-tight [&>span]:left-4 [&>span]:font-serif [&>span]:text-2xl'

/**
 * «＋ Agregar una nota», «＋ Agregar n.º de remito»: abre un campo opcional
 * que casi nunca hace falta. Va en un `<button type="button">` con el ícono
 * `Plus` (`size-3.5`) adelante; al abrirlo, el foco pasa al campo que aparece.
 * 44 px de alto en el celular y foco a la vista.
 */
export const ADD_LINK =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/**
 * Un link de texto dentro de una hoja («Usar ese importe», «Ver la ficha»): la
 * salida callada, nunca la acción principal (esa es el botón del pie). 44 px
 * de alto en el celular y foco a la vista.
 */
export const TEXT_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'
