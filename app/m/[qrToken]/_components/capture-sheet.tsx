'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RegisterCustomerResult } from '@/lib/m-session/actions'
import { CaptureHero } from './capture-hero'
import { RegisterForm } from './register-form'

export function CaptureSheet({
  qrToken,
  browserToken,
  tenantName,
  headline,
  subtext,
  onClose,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  headline: string
  subtext: string
  onClose: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:max-w-md"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{headline}</SheetTitle>
        </SheetHeader>
        <CaptureHero headline={headline} subtext={subtext} />
        <RegisterForm
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          submitLabel="Quiero sumar"
          onDismiss={onClose}
          onRegistered={onRegistered}
        />
      </SheetContent>
    </Sheet>
  )
}
