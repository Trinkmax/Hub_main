import type { WarningKey } from '@/lib/accounting/types'
import type {
  ImportNeed,
  ProposalError,
  ProposalStatus,
  ProposalSummary,
} from '@/lib/imports/server/types'

/**
 * Una propuesta como la ve la revisión (WP10): lo de `ImportProposalRow` menos
 * los valores del formulario (que no viajan al navegador), más el proveedor o
 * partícipe que ya tiene y si la persona decidió algo.
 */
export type ProposalView = {
  key: string
  form: string
  status: ProposalStatus
  previewHash: string | null
  summary: ProposalSummary
  needs: ImportNeed[]
  warningsAck: WarningKey[]
  documentId: string | null
  error: ProposalError | null
  /** El proveedor (o partícipe) del formulario, si ya se sabe. */
  partyId: string | null
  /** La persona ya eligió algo (se puede «Borrar mis decisiones»). */
  hasDecisions: boolean
  /** Ya tiene el formulario armado (se puede ver el asiento). */
  hasValues: boolean
}
