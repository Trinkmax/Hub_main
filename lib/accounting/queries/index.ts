import 'server-only'

/**
 * Lecturas de Administración (G.7). Server-only: las páginas (Server
 * Components) llaman `requireAccountingAccess(slug, 'read')` y después estas
 * funciones con `access.tenant.id`. Los textos y links que también usan los
 * componentes de cliente están en `./labels` (sin `server-only`).
 */

export * from './access'
export * from './accounts'
export * from './books'
export * from './columns'
export * from './documents'
export * from './forms'
export * from './history'
export * from './labels'
export * from './parties'
export * from './periods'
export * from './settings'
export {
  AccQueryError,
  type Cursor,
  type CursorValue,
  decodeCursor,
  decodePageToken,
  encodeCursor,
  JOURNAL_PAGE_LIMIT,
  LIST_PAGE_SIZE,
  type PageToken,
  QUERY_FAILED_MESSAGE,
  type QueryOutcome,
  type QueryPage,
  REPORT_PAGE_LIMIT,
  REPORT_UNAVAILABLE_MESSAGE,
  settleQuery,
} from './shared'
export * from './summary'
export * from './treasury'
