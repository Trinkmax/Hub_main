import {
  GUIDE_EVERYWHERE,
  GUIDE_PAPERS,
  GUIDE_RECIPES,
  GUIDE_SECTIONS,
  PAPER_FACTS,
} from '@/lib/accounting/guides'
import { ONBOARDING_GLOSSARY } from '@/lib/accounting/onboarding'

/** El manual de Administración, con el mismo contenido de la Guía: Tex nunca dice otra cosa que la pantalla. */
export function administracionManual(): string {
  const sections = GUIDE_SECTIONS.map(
    (s) => `- **${s.title}**: ${s.what}${s.tabs.length ? ` Solapas: ${s.tabs.join(', ')}.` : ''}`,
  ).join('\n')

  const everywhere = GUIDE_EVERYWHERE.map((e) => `- **${e.title}**: ${e.what}`).join('\n')

  const recipes = GUIDE_RECIPES.map((recipe) => {
    const steps = recipe.steps.map((step, i) => `  ${i + 1}. ${step.text}`).join('\n')
    const checks = recipe.checks.length ? `\n  Se chequea: ${recipe.checks.join(' ')}` : ''
    const troubles = recipe.troubles.length
      ? `\n  Si algo sale mal: ${recipe.troubles.map((t) => `${t.problem} → ${t.fix}`).join(' ')}`
      : ''
    return `### ${recipe.title}\n  Dónde: ${recipe.where}. ${recipe.hint}.\n${steps}${checks}${troubles}\n  Queda: ${recipe.result}`
  }).join('\n')

  const papers = GUIDE_PAPERS.map((paper) => {
    const facts = PAPER_FACTS.map((fact) => `${fact.question} ${paper.facts[fact.id].text}`).join(
      ' ',
    )
    return `- **${paper.title}**: ${paper.lead} Figura en «${paper.filter}». ${facts}`
  }).join('\n')

  const glossary = ONBOARDING_GLOSSARY.map((g) => `- **${g.term}**: ${g.meaning}`).join('\n')

  return `# Cómo está armada Administración
Seis secciones arriba, el engranaje con Ajustes, Guía e Importar, y el botón «+ Cargar».
${sections}

## En cualquier pantalla
${everywhere}

## Reglas que conviene saber
- Cada cierre del día devenga Ingresos Brutos y Comercio e Industria con los porcentajes de Ajustes › Impuestos, contra Rentas y Municipalidad. Se pagan después, con un Pago a esos organismos.
- Cada pago con banco o billetera suma el impuesto al cheque (0,6 % por defecto), salvo que esté apagado en Ajustes › Impuestos.
- La contadora reimputa y hace asientos; no carga compras, pagos ni ventas.
- Un comprobante recién cargado se deshace con un toque durante 10 minutos. Después se anula desde su ficha, con motivo.
- Un mes cerrado no se toca: lo que se carga con esa fecha entra el primer día abierto.
- La Proyección (Ventas) es el objetivo de cada día. El objetivo lo escribe la persona, día por día: el sistema no calcula ni sugiere objetivos. Lo que sale solo es el tipo: comparando ese objetivo con el promedio de los días del mes que tienen objetivo, más de 10 % arriba es Fuerte, más de 10 % abajo es Flojo y el resto es Normal. «Sin objetivo» es que nadie lo escribió todavía. «Vendido» sale del cierre de ese día, y «Cumpl.» es vendido contra objetivo.

## Las recetas: una por situación
${recipes}

## Con factura y sin factura
${papers}

## Palabras
${glossary}`
}
