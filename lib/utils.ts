import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge no conoce las utilidades de tipo del kit (`type-*`, en
 * app/globals.css). Sin esto, `cn('type-body', 'text-lg')` deja las dos clases
 * y gana la que Tailwind ordene última en el CSS: `text-3xl` le gana a
 * `type-title`, pero `type-caption` le gana a `text-sm` (empatan en
 * propiedades y desempata el alfabeto). Con el grupo `type-style` vuelve a
 * valer «la última clase gana»:
 *
 * - un `type-*` pisa al `text-{tamaño}` y al `leading-*` anteriores, y al revés;
 * - el peso y el tracking (`font-semibold`, `tracking-wide`) conviven con el
 *   `type-*`: van después en el CSS, así que lo pisan sin sacarlo;
 * - `type-amount` queda afuera: son cifras tabulares, no un tamaño.
 *
 * Las sombras de lo que flota (`shadow-float`, `shadow-modal`) se suman a la
 * escala de sombras: tailwind-merge solo reconoce talles (`sm`, `lg`…) y las
 * tomaba por un COLOR de sombra, así que `cn('shadow-float', 'shadow-black/10')`
 * se comía la elevación y `cn('shadow-sm', 'shadow-float')` dejaba las dos.
 */
const twMerge = extendTailwindMerge<'type-style'>({
  extend: {
    theme: {
      shadow: ['float', 'modal'],
    },
    classGroups: {
      'type-style': [
        {
          type: [
            'title',
            'kpi',
            'section',
            'subtitle',
            'body',
            'small',
            'label',
            'caption',
            'group',
          ],
        },
      ],
    },
    conflictingClassGroups: {
      'type-style': ['font-size', 'leading'],
      'font-size': ['type-style'],
      leading: ['type-style'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
