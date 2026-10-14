'use client'

import { X } from 'lucide-react'
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
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
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
 * pantalla de la sección (botones, ⌘K, el lanzador, las tarjetas de «Hoy te
 * toca»). Lo que precarga cada hoja viaja al lado: `&proveedor=`, `&cliente=`,
 * `&caja=`, `&partida=` y `&gasto-fijo=` (un UUID cada uno).
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
          // La X la dibuja la hoja (abajo): la del primitivo mide 32 px y en el celular no llega a 44.
          showClose={false}
          className={cn(
            // En el celular ocupa la pantalla; desde `sm`, una hoja de 560 px con el borde
            // izquierdo redondeado, como las demás superficies de la sección.
            'w-full gap-0 overflow-hidden p-0 sm:max-w-[35rem] sm:rounded-l-3xl',
            // Es la carga de todos los días: entra rápido (frena al llegar) y sale más rápido.
            'ease-(--ease-out) data-[state=closed]:duration-200 data-[state=open]:duration-300',
            'motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none',
            // En oscuro, un tilde marcado va RELLENO (dorado), como en claro va relleno de verde.
            // El `Checkbox` del panel pinta su fondo de oscuro (`dark:bg-input/30`) por encima
            // del de «marcado» y quedaba un cuadradito con borde y un tilde que casi no se ve:
            // en «Pagar» costaba saber qué facturas se estaban pagando. Se corrige acá, para
            // las seis hojas, sin tocar la pieza compartida.
            'dark:[&_[data-slot=checkbox][data-state=checked]]:bg-primary',
          )}
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
          {/* Después del cuerpo en el DOM (como la X del primitivo): al abrir, el foco cae en el
              primer campo de la hoja y no en «Cerrar». Pasa por `onOpenChange`, así que si hay
              algo cargado pregunta antes de descartarlo. */}
          <SheetClose className="absolute top-2.5 right-2.5 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:top-5 sm:right-5 sm:size-10">
            <X className="size-5 sm:size-4" aria-hidden="true" />
            <span className="sr-only">Cerrar</span>
          </SheetClose>
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
