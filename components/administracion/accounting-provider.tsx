'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ACTION_SHEETS } from './acciones/registry'
import {
  type AccountingAction,
  type ActionParams,
  actionHref,
  clearActionHref,
  readAction,
} from './acciones/types'

export type AccountingUiAccess = {
  read: boolean
  /** Carga, anula y cierra: solo dueños con acceso. La contadora es `false`. */
  write: boolean
  /** Da y quita accesos. */
  admin: boolean
}

export type AccountingContextValue = {
  tenantSlug: string
  /** Hoy en Córdoba (`yyyy-MM-dd`): el de la base, igual en el server y en el cliente. */
  today: string
  access: AccountingUiAccess
  /** Contadora (o dueño sin escritura): se esconden todas las acciones de carga. */
  readOnly: boolean
  /** Abre una hoja de acción rápida sobre la pantalla actual (`?accion=`). */
  openAction: (action: AccountingAction, params?: ActionParams) => void
  /** Cierra la hoja abierta (sin preguntar). */
  closeAction: () => void
}

const AccountingContext = createContext<AccountingContextValue | null>(null)

/** El contexto de Administración. Solo adentro de `/administracion`. */
export function useAccounting(): AccountingContextValue {
  const value = useContext(AccountingContext)
  if (!value)
    throw new Error('useAccounting: falta <AccountingProvider> (layout de /administracion).')
  return value
}

/** Igual, pero `null` fuera de `/administracion` (piezas que también se usan afuera). */
export function useAccountingOptional(): AccountingContextValue | null {
  return useContext(AccountingContext)
}

/**
 * Lo monta el layout de `/administracion` alrededor de cada pantalla: da hoy,
 * los permisos de la persona y las hojas de acciones rápidas, que se abren con
 * `?accion=gasto|pagar|cobrar|mover|ajustar|movimiento` desde cualquier
 * pantalla de la sección (botones, ⌘K, filas de «Necesita atención»).
 */
export function AccountingProvider({
  tenantSlug,
  today,
  access,
  children,
}: {
  tenantSlug: string
  today: string
  access: AccountingUiAccess
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  // ¿La hoja abierta la abrimos nosotros con push? Entonces cerrar = volver
  // atrás (el botón «atrás» del celular también la cierra). Si se llegó con el
  // link ya armado (⌘K desde otra sección, un link compartido), cerrar
  // reemplaza la URL: «atrás» no tiene que sacarte de la pantalla.
  const pushedRef = useRef(false)

  const openAction = useCallback(
    (action: AccountingAction, params: ActionParams = {}) => {
      if (!access.write) return
      const search = typeof window === 'undefined' ? '' : window.location.search
      const href = actionHref(pathname, search, action, params)
      // Con una hoja ya abierta (de una hoja a otra), se reemplaza: cerrar
      // tiene que volver a la pantalla, no a la hoja anterior.
      if (new URLSearchParams(search).has('accion')) {
        router.replace(href, { scroll: false })
        return
      }
      pushedRef.current = true
      router.push(href, { scroll: false })
    },
    [access.write, pathname, router],
  )

  const closeAction = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false
      router.back()
      return
    }
    const search = typeof window === 'undefined' ? '' : window.location.search
    router.replace(clearActionHref(pathname, search), { scroll: false })
  }, [pathname, router])

  const value = useMemo<AccountingContextValue>(
    () => ({
      tenantSlug,
      today,
      access,
      readOnly: !access.write,
      openAction,
      closeAction,
    }),
    [tenantSlug, today, access, openAction, closeAction],
  )

  return (
    <AccountingContext.Provider value={value}>
      {children}
      {access.write ? (
        // useSearchParams adentro de un Suspense propio: la pantalla nunca
        // espera a las hojas para pintarse.
        <Suspense fallback={null}>
          <ActionSheetHost
            tenantSlug={tenantSlug}
            today={today}
            onClose={closeAction}
            onUrlCleared={() => {
              pushedRef.current = false
            }}
          />
        </Suspense>
      ) : null}
    </AccountingContext.Provider>
  )
}

/** Tocar un toast («Deshacer») no cierra la hoja. */
function keepOpenOnToast(event: Event): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) event.preventDefault()
}

function ActionSheetHost({
  tenantSlug,
  today,
  onClose,
  onUrlCleared,
}: {
  tenantSlug: string
  today: string
  onClose: () => void
  onUrlCleared: () => void
}) {
  const searchParams = useSearchParams()
  const current = readAction(searchParams)
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const action = current?.action ?? null

  // Cada hoja arranca limpia; y si la URL ya no tiene la acción (navegó a otra
  // pantalla, «atrás» del navegador), se olvida cómo se había abierto.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se resetea al cambiar de hoja
  useEffect(() => {
    setDirty(false)
    setConfirming(false)
    if (!action) onUrlCleared()
  }, [action])

  const requestClose = () => {
    if (dirty) setConfirming(true)
    else onClose()
  }

  const Body = action ? ACTION_SHEETS[action] : null

  return (
    <>
      <Sheet
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 p-0 sm:max-w-lg"
          onPointerDownOutside={keepOpenOnToast}
          onInteractOutside={keepOpenOnToast}
        >
          {Body && current ? (
            <Body
              key={`${current.action}:${JSON.stringify(current.params)}`}
              tenantSlug={tenantSlug}
              today={today}
              params={current.params}
              close={() => {
                setDirty(false)
                onClose()
              }}
              setDirty={setDirty}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartás lo que cargaste?</AlertDialogTitle>
            <AlertDialogDescription>
              Si cerrás ahora, lo que escribiste en esta hoja no se guarda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir cargando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDirty(false)
                setConfirming(false)
                onClose()
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
