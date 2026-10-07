/**
 * Motor de imputación (Sprint 1, E.5): un `build*` por comprobante, todos con
 * la firma `(input, ctx, meta) => PostingResult` y deterministas. Puro: corre
 * igual en el navegador (vista previa) y en la server action (lo que se
 * guarda, E.7). `toRpcPayload` traduce la propuesta al `p_bundle` de
 * `acc_post_bundle` (C.3.1).
 */
export * from './adjustment'
export * from './collection'
export * from './common'
export * from './expense'
export * from './iva-settlement'
export * from './manual'
export * from './opening'
export * from './payment'
export * from './purchase'
export * from './quick-expense'
export * from './sales-close'
export * from './sales-invoice'
export * from './treasury'
export * from './year-end'
