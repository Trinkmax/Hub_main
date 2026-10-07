/**
 * Motor contable de Administración (Sprint 1, E): todo lo puro, sin I/O.
 * Sirve igual en el navegador (vista previa) y en el servidor (lo que se
 * guarda). Lo que toca la base (`access.ts`, `context.ts`, `queries/*`,
 * `actions/*`) es `server-only` y NO se exporta desde acá.
 */
export * from './action-state'
export * from './aging'
export * from './balance'
export * from './chart'
export * from './defaults'
export * from './errors'
export * from './iva'
export * from './numbering'
export * from './paste'
export * from './preview'
export * from './schemas'
export * from './system-keys'
export * from './types'
export * from './validate'
export * from './voucher-types'
