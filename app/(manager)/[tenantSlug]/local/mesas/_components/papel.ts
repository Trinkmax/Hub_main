import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'

/**
 * Las clases que necesita todo lo del editor que se dibuja fuera de su árbol
 * (ventanitas, diálogos, hojas): `pos` trae los tokens de papel, la variable de
 * la letra viaja aparte y `fpe-scope` deja los controles del panel en papel
 * aunque el panel esté en tema oscuro (ver floor-editor.css).
 */
export const PAPEL = cn('pos', posFont.variable, 'fpe-scope')
