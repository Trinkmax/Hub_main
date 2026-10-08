import {
  HowToBanco,
  HowToMercadoPago,
  HowToMisComprobantes,
} from '@/components/administracion/guias/how-to'
import type { OnboardingHowTo } from '@/lib/accounting/onboarding'

/**
 * La mini guía «¿Cómo lo bajo?» de cada archivo que se sube (diseño §5.1.4;
 * contrato C1: las arma la guía de ARCA en `guias/how-to`). Un solo lugar
 * que la elige por fuente, para «Cómo arrancar» y el índice de Guías.
 */
export function HowToFor({
  source,
  defaultOpen,
  className,
}: {
  source: OnboardingHowTo
  defaultOpen?: boolean
  className?: string
}) {
  switch (source) {
    case 'mis_comprobantes':
      return <HowToMisComprobantes defaultOpen={defaultOpen} className={className} />
    case 'mercado_pago':
      return <HowToMercadoPago defaultOpen={defaultOpen} className={className} />
    case 'banco':
      return <HowToBanco defaultOpen={defaultOpen} className={className} />
  }
}
