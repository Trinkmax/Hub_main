/**
 * Los pares de tokens que mide la tabla de contraste en vivo del catálogo
 * (kit HUB §6.4): texto sobre fondo, borde de campo sobre superficie, foco e
 * indicadores, los mismos de §2.7. Son los mismos pares que recalcula
 * tests/lib/tokens-contrast.test.ts desde `app/globals.css`; acá se miden en
 * el navegador, con `getComputedStyle`, sobre muestras adentro de cada panel
 * de tema. Si alguien toca un token, el catálogo lo muestra.
 *
 * `--selected sobre --background`: un token con alfa compuesto sobre la
 * superficie donde va (así se pinta una fila elegida o un ítem activo).
 */

import { WCAG_MIN } from '@/lib/color/contrast'

export type ContrastPair = {
  /** Primer plano: un token o «token sobre token». */
  fg: string
  /** Fondo: un token o «token sobre token». */
  bg: string
  /** Mínimo de WCAG 2.x AA: 4,5 para texto, 3 para bordes, foco e indicadores. */
  min: number
  /** Para qué se usa el par en el kit. */
  use: string
}

const TEXT = WCAG_MIN.text
const UI = WCAG_MIN.nonText

function pair(fg: string, bg: string, min: number, use: string): ContrastPair {
  return { fg, bg, min, use }
}

export const LIGHT_PAIRS: readonly ContrastPair[] = [
  pair('--foreground', '--card', TEXT, 'texto principal'),
  pair('--foreground', '--background', TEXT, 'texto principal'),
  pair('--foreground', '--muted', TEXT, 'encabezado de tabla'),
  pair('--foreground', '--secondary', TEXT, 'chip'),
  pair('--foreground', '--selected sobre --background', TEXT, 'ítem activo del menú'),
  pair('--foreground', '--hover sobre --background', TEXT, 'hover'),
  pair('--muted-foreground', '--card', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--background', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--muted', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--secondary', TEXT, 'etiqueta neutra'),
  pair('--muted-foreground', '--selected sobre --background', TEXT, 'menú'),
  pair('--muted-foreground', '--selected sobre --card', TEXT, 'fila elegida'),
  pair('--muted-foreground', '--hover sobre --background', TEXT, 'menú en hover'),
  pair('--muted-foreground', '--accent', TEXT, 'listbox'),
  pair('--muted-foreground', '--success-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--warning-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--destructive-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--info-soft', TEXT, 'cuerpo de Callout'),
  pair('--subtle-foreground', '--card', TEXT, 'apoyo de 12 px y placeholder'),
  pair('--subtle-foreground', '--background', TEXT, 'apoyo de 12 px'),
  pair('--subtle-foreground', '--muted', TEXT, 'apoyo de 12 px'),
  pair('--subtle-foreground', '--accent', TEXT, 'apoyo en listbox'),
  pair('--subtle-foreground', '--hover sobre --card', TEXT, 'celda de tabla en hover'),
  pair('--subtle-foreground', '--selected sobre --card', TEXT, 'celda de fila elegida'),
  pair('--primary', '--card', TEXT, 'link e ícono activo'),
  pair('--primary', '--background', TEXT, 'link e ícono activo'),
  pair('--primary', '--secondary', TEXT, 'contorno del segmentado elegido'),
  pair('--primary', '--accent', TEXT, 'ícono en opción resaltada'),
  pair('--primary-foreground', '--primary', TEXT, 'botón principal, día y página elegidos'),
  pair('--primary-foreground', '--primary-hover', TEXT, 'botón principal en hover'),
  pair('--destructive-foreground', '--destructive', TEXT, 'botón de peligro'),
  pair('--destructive-foreground', '--destructive-hover', TEXT, 'botón de peligro en hover'),
  pair('--success-text', '--card', TEXT, 'texto de éxito'),
  pair('--success-text', '--background', TEXT, 'texto de éxito'),
  pair('--success-text', '--success-soft', TEXT, 'etiqueta de éxito'),
  pair('--warning-text', '--card', TEXT, 'texto de aviso'),
  pair('--warning-text', '--background', TEXT, 'texto de aviso'),
  pair('--warning-text', '--warning-soft', TEXT, 'etiqueta de aviso'),
  pair('--destructive-text', '--card', TEXT, 'texto de peligro'),
  pair('--destructive-text', '--background', TEXT, 'texto de peligro'),
  pair('--destructive-text', '--destructive-soft', TEXT, 'etiqueta de peligro'),
  pair('--destructive-text', '--accent', TEXT, 'ítem de menú de peligro resaltado'),
  pair('--info-text', '--card', TEXT, 'texto informativo'),
  pair('--info-text', '--background', TEXT, 'texto informativo'),
  pair('--info-text', '--info-soft', TEXT, 'etiqueta informativa'),
  pair('--brand-text', '--brand-soft', TEXT, 'etiqueta de marca'),
  pair('--warning-foreground', '--warning', TEXT, 'chip ámbar relleno'),
  pair('--gold-foreground', '--gold', TEXT, 'sello dorado'),
  pair('--gold-text', '--gold-soft', TEXT, 'etiqueta del club'),
  pair('--background', '--foreground', TEXT, 'tooltip'),
  pair('--input', '--card', UI, 'borde de campo, pista del switch, paso por venir'),
  pair('--input', '--background', UI, 'borde de campo'),
  pair('--input', '--muted', UI, 'borde de campo'),
  pair('--card', '--input', UI, 'perilla del switch sobre la pista'),
  pair('--ring', '--background', UI, 'foco'),
  pair('--ring', '--card', UI, 'foco'),
  pair('--ring', '--selected sobre --background', UI, 'foco y barra del ítem activo'),
  pair('--warning', '--card', UI, 'punto o ícono de aviso'),
  pair('--warning', '--background', UI, 'punto o ícono de aviso'),
  pair('--warning', '--warning-soft', UI, 'ícono de aviso en su fondo'),
  pair('--chart-1', '--card', UI, 'gráfico'),
  pair('--chart-2', '--card', UI, 'gráfico'),
  pair('--chart-3', '--card', UI, 'gráfico'),
  pair('--chart-4', '--card', UI, 'gráfico'),
  pair('--chart-5', '--card', UI, 'gráfico'),
]

export const DARK_PAIRS: readonly ContrastPair[] = [
  pair('--foreground', '--card', TEXT, 'texto principal'),
  pair('--foreground', '--background', TEXT, 'texto principal'),
  pair('--foreground', '--muted', TEXT, 'encabezado de tabla'),
  pair('--foreground', '--popover', TEXT, 'menú'),
  pair('--foreground', '--secondary', TEXT, 'chip'),
  pair('--foreground', '--accent', TEXT, 'opción resaltada'),
  pair('--muted-foreground', '--card', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--background', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--muted', TEXT, 'texto secundario'),
  pair('--muted-foreground', '--popover', TEXT, 'texto secundario en menú'),
  pair('--muted-foreground', '--secondary', TEXT, 'etiqueta neutra'),
  pair('--muted-foreground', '--accent', TEXT, 'listbox'),
  pair('--muted-foreground', '--selected sobre --card', TEXT, 'fila elegida'),
  pair('--muted-foreground', '--success-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--warning-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--destructive-soft', TEXT, 'cuerpo de Callout'),
  pair('--muted-foreground', '--info-soft', TEXT, 'cuerpo de Callout'),
  pair('--subtle-foreground', '--card', TEXT, 'apoyo de 12 px y placeholder'),
  pair('--subtle-foreground', '--background', TEXT, 'apoyo de 12 px'),
  pair('--subtle-foreground', '--muted', TEXT, 'apoyo de 12 px'),
  pair('--subtle-foreground', '--popover', TEXT, 'apoyo en menú'),
  pair('--subtle-foreground', '--secondary', TEXT, 'apoyo en chip'),
  pair('--subtle-foreground', '--accent', TEXT, 'apoyo en listbox'),
  pair('--subtle-foreground', '--selected sobre --background', TEXT, 'apoyo en ítem activo'),
  pair('--subtle-foreground', '--selected sobre --card', TEXT, 'celda de fila elegida'),
  pair('--primary', '--card', TEXT, 'link, foco y contorno de lo elegido'),
  pair('--primary', '--background', TEXT, 'link, foco y contorno de lo elegido'),
  pair('--primary', '--popover', TEXT, 'check de la opción elegida'),
  pair('--primary', '--secondary', TEXT, 'contorno del segmentado elegido'),
  pair('--primary', '--selected sobre --background', TEXT, 'ícono y barra del ítem activo'),
  pair('--primary-foreground', '--primary', TEXT, 'botón principal'),
  pair('--primary-foreground', '--primary-hover', TEXT, 'botón principal en hover'),
  pair('--destructive-foreground', '--destructive', TEXT, 'botón de peligro'),
  pair('--destructive-foreground', '--destructive-hover', TEXT, 'botón de peligro en hover'),
  pair('--success-text', '--card', TEXT, 'texto de éxito'),
  pair('--success-text', '--success-soft', TEXT, 'etiqueta de éxito'),
  pair('--warning-text', '--card', TEXT, 'texto de aviso'),
  pair('--warning-text', '--warning-soft', TEXT, 'etiqueta de aviso'),
  pair('--destructive-text', '--card', TEXT, 'texto de peligro'),
  pair('--destructive-text', '--destructive-soft', TEXT, 'etiqueta de peligro'),
  pair('--info-text', '--card', TEXT, 'texto informativo'),
  pair('--info-text', '--info-soft', TEXT, 'etiqueta informativa'),
  pair('--gold-text', '--gold-soft', TEXT, 'etiqueta del club'),
  pair('--brand-text', '--brand-soft', TEXT, 'etiqueta de marca'),
  pair('--background', '--foreground', TEXT, 'tooltip'),
  pair('--input', '--card', UI, 'borde de campo y pista del switch'),
  pair('--input', '--background', UI, 'borde de campo'),
  pair('--input', '--muted', UI, 'borde de campo'),
  pair('--input', '--popover', UI, 'borde de campo en un menú'),
  pair('--card', '--input', UI, 'perilla del switch sobre la pista'),
  pair('--ring', '--card', UI, 'foco'),
  pair('--ring', '--background', UI, 'foco'),
  pair('--success', '--card', UI, 'punto de estado'),
  pair('--warning', '--card', UI, 'punto de estado'),
  pair('--destructive', '--card', UI, 'punto de estado'),
  pair('--info', '--card', UI, 'punto de estado'),
  pair('--chart-1', '--card', UI, 'gráfico'),
  pair('--chart-2', '--card', UI, 'gráfico'),
  pair('--chart-3', '--card', UI, 'gráfico'),
  pair('--chart-4', '--card', UI, 'gráfico'),
  pair('--chart-5', '--card', UI, 'gráfico'),
]

/** `'--selected sobre --card'` → `['--selected', '--card']`; un token suelto, `[token]`. */
export function layersOf(layer: string): [top: string, under?: string] {
  const [top = '', under] = layer.split(' sobre ')
  return under === undefined ? [top] : [top, under]
}

/** Los tokens que hay que muestrear para medir estos pares, sin repetir. */
export function tokensOf(pairs: readonly ContrastPair[]): string[] {
  const tokens = new Set<string>()
  for (const { fg, bg } of pairs) {
    for (const layer of [fg, bg]) for (const token of layersOf(layer)) if (token) tokens.add(token)
  }
  return [...tokens]
}
