'use client'

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/components/theme/theme-provider'
import { Spinner } from '@/components/ui/spinner'
import { TOAST_ACTION_CLASS, TOAST_CANCEL_CLASS } from '@/components/ui/toast'

/**
 * Los avisos del panel (kit HUB §3.4). Va una sola vez, en el root layout y
 * ADENTRO del `ThemeProvider`: sigue el tema de la app (`useTheme`), no el del
 * sistema operativo. El salón y lo público siguen con el Toaster de
 * `ui-legacy`, igual que antes.
 *
 * - **Sin el estilo propio de sonner** (`unstyled`): su CSS gana por
 *   especificidad (0,3,0) y forzaba su fuente del sistema y colores sólidos.
 *   Todos los avisos se ven igual y el tono va solo en el ícono: informan sin
 *   gritar (sin `richColors`).
 * - **En español para el lector de pantalla:** sin `containerAriaLabel` y
 *   `closeButtonAriaLabel`, anuncia «Notifications alt+T» y «Close toast».
 * - **No tapa la barra fija de `FormActions`:** el borde de abajo suma
 *   `--sticky-actions-h`, que esa barra escribe en `<html>` mientras está
 *   montada (sin barra, vale 0 y queda el margen de siempre).
 * - Alt + T lleva el foco a los avisos y los frena (atajo de sonner).
 *
 * Lo que flota se puede tocar aunque haya un diálogo modal abierto:
 * `[data-sonner-toaster] { pointer-events: auto }` en globals.css, y los
 * overlays del kit aplican `keepOpenOnToast` (`@/components/ui/toast`).
 */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      visibleToasts={3}
      closeButton
      containerAriaLabel="Avisos"
      offset={{ bottom: 'calc(var(--sticky-actions-h, 0px) + 24px)' }}
      mobileOffset={{ bottom: 'calc(var(--sticky-actions-h, 0px) + 16px)' }}
      icons={{
        success: <CircleCheck aria-hidden="true" />,
        error: <CircleAlert aria-hidden="true" />,
        warning: <TriangleAlert aria-hidden="true" />,
        info: <Info aria-hidden="true" />,
        loading: <Spinner size={16} aria-hidden />,
        close: <X className="size-4" aria-hidden="true" />,
      }}
      style={
        {
          // Sonner fuerza `ui-sans-serif` en el <ol>: sin esto los avisos no
          // salen en Inter.
          fontFamily: 'var(--font-sans, var(--font-inter), ui-sans-serif, system-ui, sans-serif)',
          // Aunque los avisos vayan sin estilo, en oscuro sonner pinta la X con
          // estas variables (`[data-sonner-theme='dark'] [data-close-button]`,
          // CSS sin capa: le gana a cualquier utilidad). Sin ellas sale negra.
          // El hover usa el `--hover` del kit, el mismo que en claro.
          '--normal-bg': 'var(--popover)',
          '--normal-bg-hover': 'var(--hover)',
          '--normal-border': 'transparent',
          '--normal-border-hover': 'transparent',
          '--normal-text': 'var(--muted-foreground)',
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: 'Cerrar aviso',
        classNames: {
          // Sin `relative`: la posición (absoluta, apilada) es de sonner.
          toast:
            'flex w-full items-start gap-3 rounded-xl border border-border bg-popover p-4 pr-11 text-popover-foreground shadow-float data-[expanded=false]:data-[front=false]:*:opacity-0',
          // `relative` + tamaño fijo: el spinner de carga de sonner es absoluto
          // y se centra contra esta caja (sin ella, se centraba en el aviso).
          icon: 'relative mt-px flex size-4 shrink-0 items-center justify-center [&_svg]:size-4',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'type-label text-foreground',
          // `!` a propósito: en oscuro sonner pinta la descripción casi blanca
          // (`[data-sonner-theme='dark'] [data-description]`, sin capa, también
          // en los avisos sin estilo) y solo un !important le gana desde una capa.
          description: 'type-small text-pretty text-muted-foreground!',
          actionButton: TOAST_ACTION_CLASS,
          cancelButton: TOAST_CANCEL_CLASS,
          closeButton:
            'absolute top-2 right-2 grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground hit-area focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
          success: '[&_[data-icon]]:text-success-text',
          error: '[&_[data-icon]]:text-destructive-text',
          warning: '[&_[data-icon]]:text-warning-text',
          info: '[&_[data-icon]]:text-info-text',
          loading: '[&_[data-icon]]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
