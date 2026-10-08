'use client'

import { Unplug } from 'lucide-react'
import { useId, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { disconnectArca, saveArcaSettings } from '@/lib/arca/actions'
import type { ArcaEnvironment } from '@/lib/arca/endpoints'
import { DISCONNECT_CONFIRMATION } from '@/lib/arca/schemas'
import type { ArcaConnectionView } from '@/lib/arca/views'
import { cn } from '@/lib/utils'
import { ArcaFailureNotice, useArcaRun } from './arca-shared'
import { INPUT_CLASS, SwitchRow } from './inputs'

/**
 * «Emitir facturas desde la plataforma» (solo producción, diseño §2.2): se prende con una
 * confirmación (cada factura que sale es real) y solo con la prueba de conexión en verde. Se
 * apaga sin preguntar.
 */
export function ArcaEmissionSwitch({
  slug,
  connection,
  readOnly = false,
}: {
  slug: string
  connection: ArcaConnectionView
  readOnly?: boolean
}) {
  const id = useId()
  const enabled = connection.emissionEnabled
  const canEnable = connection.status === 'connected' && connection.pointOfSale !== null
  const [askOn, setAskOn] = useState(false)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const { pending, run } = useArcaRun()

  const save = (value: boolean) => {
    setFailure(null)
    run(
      () =>
        saveArcaSettings(slug, {
          environment: 'produccion',
          emissionEnabled: value,
          expectedUpdatedAt: connection.updatedAt || null,
        }),
      {
        onSuccess: () => setAskOn(false),
        onFailure: (f) => {
          setAskOn(false)
          setFailure(f)
        },
      },
    )
  }

  const description = (
    <>
      Para las facturas de eventos y las ventas sueltas, con CAE (el código de ARCA que hace válida
      cada factura). Las ventas del salón las sigue facturando el sistema de caja que usás hoy.
      {!enabled && !canEnable ? (
        <span className="mt-1 block font-medium text-foreground">
          Se puede prender cuando la prueba de conexión da todo bien.
        </span>
      ) : null}
    </>
  )

  if (readOnly) {
    return (
      <div className="rounded-lg border bg-background/50 p-4">
        <p className="text-sm font-medium">Emitir facturas desde la plataforma</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {enabled ? 'Prendido: se emite con ARCA desde Ventas.' : 'Apagado.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <SwitchRow
        id={id}
        label="Emitir facturas desde la plataforma"
        description={description}
        checked={enabled}
        disabled={pending || (!enabled && !canEnable)}
        onCheckedChange={(value) => {
          if (value) setAskOn(true)
          else save(false)
        }}
      />
      <ArcaFailureNotice failure={failure} slug={slug} />
      <AlertDialog open={askOn} onOpenChange={setAskOn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Prendemos la emisión?</AlertDialogTitle>
            <AlertDialogDescription>
              Desde ahora, en Ventas › Factura de venta vas a poder emitir con CAE. Cada factura
              emitida es real: si te equivocás, se anula con una nota de crédito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                save(true)
              }}
            >
              {pending ? 'Prendiendo…' : 'Prender'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * «Desconectar» (destructivo): borra la clave y el certificado de ese ambiente. Pide escribir
 * DESCONECTAR para que no se haga sin querer.
 */
export function ArcaDisconnectButton({
  slug,
  environment,
  className,
}: {
  slug: string
  environment: ArcaEnvironment
  className?: string
}) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const { pending, run } = useArcaRun()
  const matches = text.trim().toUpperCase() === DISCONNECT_CONFIRMATION

  const confirm = () => {
    setError(null)
    setFailure(null)
    run(() => disconnectArca(slug, { environment, confirm: text.trim().toUpperCase() }), {
      onSuccess: () => {
        setOpen(false)
        setText('')
      },
      onFailure: (f) => {
        const field = f.fieldErrors?.confirm
        if (field) setError(field)
        else {
          setOpen(false)
          setFailure(f)
        }
      },
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn('h-11 gap-2 text-destructive hover:text-destructive md:h-9', className)}
        onClick={() => setOpen(true)}
      >
        <Unplug className="size-4" aria-hidden />
        Desconectar
      </Button>
      <ArcaFailureNotice failure={failure} slug={slug} environment={environment} className="mt-2" />
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setText('')
            setError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {environment === 'produccion' ? '¿Desconectar ARCA?' : '¿Desconectar las pruebas?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {environment === 'produccion'
                ? 'Se borran la clave de la plataforma y el certificado. Se apaga la emisión de facturas y «Completar con ARCA» deja de andar. Para volver a facturar vas a tener que repetir los pasos 5 a 9 de la guía.'
                : 'Se borran la clave y el certificado de pruebas. Para volver a probar vas a tener que generar otro pedido y subir otro certificado de WSASS.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>
              Para confirmar, escribí <span className="font-mono">{DISCONNECT_CONFIRMATION}</span>
            </Label>
            <Input
              id={inputId}
              value={text}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setText(event.target.value)
                setError(null)
              }}
              className={cn(INPUT_CLASS, 'font-mono uppercase')}
            />
            {error ? (
              <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9"
              disabled={!matches || pending}
              onClick={(event) => {
                event.preventDefault()
                confirm()
              }}
            >
              {pending ? 'Desconectando…' : 'Desconectar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
