'use client'

import { toast } from 'sonner'

export const CONNECTION_ERROR = 'Se cortó la conexión o algo falló. Probá de nuevo.'

/**
 * Para las acciones que corren adentro de `startTransition`: en React 19 una promesa
 * rechazada ahí se vuelve a tirar en el render y deja la pantalla de error. Acá se
 * convierte en un aviso y la pantalla sigue andando.
 */
export async function guard(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.error('[tareas]', error instanceof Error ? error.message : 'error')
    toast.error(CONNECTION_ERROR)
  }
}
