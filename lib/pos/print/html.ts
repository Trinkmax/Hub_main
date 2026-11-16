/**
 * El tique, dibujado — PURO (devuelve el HTML; no toca el navegador).
 *
 * Es una hoja angosta para una impresora de rollo: una sola columna del ancho que imprime el cabezal,
 * sin márgenes de página (los pone la impresora) y todo en negro pleno. Varios tiques en el mismo
 * trabajo se separan con un salto de página: ahí corta la comandera.
 *
 * Todo texto pasa por `escapeHtml`: en un tique van nombres de productos, notas del mozo y motivos
 * escritos a mano.
 */
import { PRINTABLE_MM, type PrintDoc, type PrintJob, type PrintLine, type TextSize } from './doc'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const SIZE_CLASS: Readonly<Record<TextSize, string>> = {
  sm: 's-sm',
  md: 's-md',
  lg: 's-lg',
  xl: 's-xl',
  xxl: 's-xxl',
}

function classes(...names: (string | false | null | undefined)[]): string {
  const list = names.filter(Boolean).join(' ')
  return list ? ` class="${list}"` : ''
}

function marksHtml(marks: readonly string[]): string {
  return marks.map((mark) => `<span class="mark">${escapeHtml(mark)}</span>`).join('')
}

function lineHtml(line: PrintLine): string {
  switch (line.kind) {
    case 'text':
      return `<p${classes(
        't',
        line.align === 'center' && 'a-c',
        line.align === 'right' && 'a-r',
        line.bold && 'b',
        line.upper && 'up',
        line.indent && 'ind',
        SIZE_CLASS[line.size ?? 'md'],
      )}>${escapeHtml(line.text)}</p>`
    case 'row':
      return `<p${classes('row', line.bold && 'b', SIZE_CLASS[line.size ?? 'md'])}><span class="row-l">${escapeHtml(
        line.left,
      )}</span>${line.dots ? '<span class="row-dots"></span>' : ''}<span class="row-r">${escapeHtml(line.right)}</span></p>`
    case 'item': {
      const variants =
        line.variants.length > 0
          ? `<div class="variants">${line.variants
              .map(
                (variant) =>
                  `<p class="variant"><span class="vqty">${escapeHtml(variant.qty)}</span><span class="vmarks">${marksHtml(variant.marks)}</span></p>`,
              )
              .join('')}</div>`
          : ''
      const marks = line.marks.length > 0 ? `<p class="marks">${marksHtml(line.marks)}</p>` : ''
      return `<div${classes('item', line.done && 'done')}><span class="qty">${escapeHtml(line.qty)}</span><div class="what"><p class="name">${escapeHtml(
        line.name,
      )}</p>${marks}${variants}</div></div>`
    }
    case 'banner':
      return `<p class="banner">${escapeHtml(line.text)}</p>`
    case 'rule':
      return `<hr${classes('rule', `r-${line.style ?? 'solid'}`)}>`
    case 'space':
      return `<div class="space" style="height:${Math.max(1, Math.min(8, line.lines ?? 1)) * 3}mm"></div>`
    case 'blank':
      return `<p class="blank"><span>${escapeHtml(line.label)}</span><span class="blank-line"></span></p>`
  }
}

function docHtml(doc: PrintDoc): string {
  return `<section class="ticket">${doc.lines.map(lineHtml).join('')}<div class="tail"></div></section>`
}

/**
 * La hoja de estilos del tique. Las medidas van en milímetros y puntos: lo que importa es el papel,
 * no la pantalla. `--w` es el ancho que imprime el cabezal.
 */
export function ticketCss(printableMm: number): string {
  return `
@page { margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; color: #000; }
body {
  width: ${printableMm}mm;
  font-family: "Arial Narrow", "Helvetica Neue", Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  line-height: 1.22;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.ticket { width: ${printableMm}mm; padding: 1.5mm 1mm 0; break-after: page; page-break-after: always; }
.ticket:last-child { break-after: auto; page-break-after: auto; }
.tail { height: 7mm; }
.t { overflow-wrap: anywhere; }
.a-c { text-align: center; }
.a-r { text-align: right; }
.b { font-weight: 700; }
.up { text-transform: uppercase; letter-spacing: 0.04em; }
.ind { padding-left: 5mm; }
.s-sm { font-size: 8.5pt; }
.s-md { font-size: 10.5pt; }
.s-lg { font-size: 14pt; line-height: 1.12; }
.s-xl { font-size: 22pt; line-height: 1.04; font-weight: 800; }
.s-xxl { font-size: 38pt; line-height: 0.98; font-weight: 800; }
.row { display: flex; align-items: baseline; gap: 1.5mm; }
.row-l { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
.row-dots { flex: 1 1 4mm; min-width: 2mm; border-bottom: 1px dotted #000; transform: translateY(-1mm); }
.row-r { flex: none; margin-left: auto; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.row .row-dots + .row-r { margin-left: 0; }
.item { display: flex; align-items: flex-start; gap: 2mm; padding: 1.4mm 0; border-top: 1px dashed #000; }
.item:first-of-type { border-top: 0; }
.qty { flex: none; min-width: 10mm; font-size: 18pt; font-weight: 800; line-height: 1; white-space: nowrap; }
.what { flex: 1 1 auto; min-width: 0; }
.name { font-size: 14pt; font-weight: 700; line-height: 1.08; overflow-wrap: anywhere; text-transform: uppercase; }
.marks { margin-top: 0.8mm; }
.mark { display: block; font-size: 12pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.mark::before { content: "· "; }
.variants { margin-top: 0.8mm; }
.variant { display: flex; align-items: flex-start; gap: 1.5mm; padding-top: 0.6mm; }
.vqty { flex: none; min-width: 7mm; font-size: 12pt; font-weight: 800; line-height: 1.15; white-space: nowrap; }
.vmarks { flex: 1 1 auto; min-width: 0; }
.item.done .name { text-decoration: line-through; }
.banner { margin: 1.2mm 0; padding: 1.2mm 1.5mm; background: #000; color: #fff; font-size: 13pt; font-weight: 800; text-align: center; text-transform: uppercase; letter-spacing: 0.03em; overflow-wrap: anywhere; }
.rule { border: 0; margin: 1.6mm 0; height: 0; }
.r-solid { border-top: 1.5px solid #000; }
.r-dashed { border-top: 1px dashed #000; }
.r-double { border-top: 3px double #000; }
.blank { display: flex; align-items: flex-end; gap: 2mm; padding-top: 5mm; font-size: 9.5pt; }
.blank-line { flex: 1 1 auto; border-bottom: 1px solid #000; }
@media screen {
  html { background: #d9d6cf; }
  body { margin: 6mm auto; }
  .ticket { margin-bottom: 6mm; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3); }
}
`
}

/** El documento entero, listo para mandarle a imprimir. */
export function renderPrintJob(job: PrintJob): string {
  const width = PRINTABLE_MM[job.paper]
  const title = escapeHtml(job.docs[0]?.title ?? 'Tique')
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><title>${title}</title><style>${ticketCss(
    width,
  )}</style></head><body>${job.docs.map(docHtml).join('')}</body></html>`
}
