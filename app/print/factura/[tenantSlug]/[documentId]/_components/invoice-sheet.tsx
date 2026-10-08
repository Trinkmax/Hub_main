import Image from 'next/image'
import { ARCA_DISCLAIMER, type InvoicePrintModel } from '@/lib/arca/print'

/**
 * La factura en A4 (RG 1415): recuadro con la letra y el código, emisor, número
 * y fecha, cliente, detalle, importes, leyendas, CAE y el QR de ARCA. Blanco y
 * negro siempre (es papel), con o sin el tema oscuro del panel. Server-safe.
 */
export function InvoiceSheet({
  model,
  qrDataUrl,
}: {
  model: InvoicePrintModel
  qrDataUrl: string
}) {
  return (
    <article
      aria-label={model.documentLabel}
      className="relative mt-4 overflow-hidden rounded-lg border border-neutral-300 bg-white text-[13px] leading-snug text-black shadow-sm print:mt-0 print:rounded-none print:border-0 print:shadow-none"
    >
      {model.testData ? (
        <p className="border-b-2 border-black bg-neutral-100 px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.16em]">
          Prueba (homologación de ARCA) · Sin validez fiscal
        </p>
      ) : null}

      <p className="border-b border-neutral-300 py-1.5 text-center text-xs font-semibold tracking-[0.3em]">
        {model.copy}
      </p>

      {/* Cabecera: emisor · letra · comprobante */}
      <header className="relative grid border-b border-neutral-300 sm:grid-cols-2 print:grid-cols-2">
        <div className="space-y-1 p-4 sm:border-r sm:border-neutral-300 sm:pr-14 print:border-r print:pr-14">
          <p className="font-serif text-xl font-semibold leading-tight">{model.issuer.name}</p>
          {model.issuer.legalName ? (
            <p className="text-xs font-medium">{model.issuer.legalName}</p>
          ) : null}
        </div>
        <div className="space-y-1 p-4 sm:pl-14 print:pl-14">
          <p className="text-lg font-bold tracking-wide">{model.title}</p>
          <p>
            <span className="text-neutral-600">Punto de venta: </span>
            <span className="font-semibold tabular-nums">{model.pointOfSaleText}</span>
            <span className="text-neutral-600"> · Comp. Nro: </span>
            <span className="font-semibold tabular-nums">{model.numberText}</span>
          </p>
          <p>
            <span className="text-neutral-600">Fecha de emisión: </span>
            <span className="font-semibold tabular-nums">{model.issueDateText}</span>
          </p>
        </div>
        {/* El recuadro de la letra, centrado sobre la división. */}
        <div className="order-first mx-auto mt-3 flex size-16 flex-col items-center justify-center border-2 border-black bg-white sm:absolute sm:top-0 sm:left-1/2 sm:m-0 sm:-translate-x-1/2 print:absolute print:top-0 print:left-1/2 print:m-0 print:-translate-x-1/2">
          <span className="text-3xl font-bold leading-none">{model.letter}</span>
          <span className="mt-0.5 text-[10px] font-medium tabular-nums">{model.codeText}</span>
        </div>
      </header>

      <section
        aria-label="Emisor"
        className="grid gap-x-6 gap-y-0.5 border-b border-neutral-300 p-4 sm:grid-cols-2 print:grid-cols-2"
      >
        {model.issuer.lines.map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
      </section>

      <section aria-label="Cliente" className="space-y-0.5 border-b border-neutral-300 p-4">
        <p>
          <span className="text-neutral-600">Cliente: </span>
          <span className="font-semibold">{model.receiver.name}</span>
        </p>
        <p className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2">
          <span>
            <span className="text-neutral-600">Documento: </span>
            <span className="tabular-nums">{model.receiver.docText}</span>
          </span>
          <span>
            <span className="text-neutral-600">Condición frente al IVA: </span>
            {model.receiver.conditionText}
          </span>
        </p>
        <p>
          <span className="text-neutral-600">Domicilio: </span>
          {model.receiver.addressText ?? '—'}
        </p>
        <p>
          <span className="text-neutral-600">Concepto: </span>
          {model.conceptText}
          {model.serviceText ? ` · ${model.serviceText}` : ''}
          {model.paymentDueText ? ` · ${model.paymentDueText}` : ''}
        </p>
        {model.associatedText ? <p>{model.associatedText}</p> : null}
      </section>

      <section aria-label="Detalle" className="border-b border-neutral-300">
        <div className="flex items-center justify-between gap-4 border-b border-neutral-300 bg-neutral-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide print:bg-neutral-100">
          <span>Detalle</span>
          <span>Importe</span>
        </div>
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <p className="min-w-0 whitespace-pre-line break-words">{model.item.description}</p>
          <p className="shrink-0 font-semibold tabular-nums">{model.item.amount}</p>
        </div>
      </section>

      <section aria-label="Importes" className="flex justify-end border-b border-neutral-300 p-4">
        <dl className="grid w-full max-w-xs grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1">
          {model.amountRows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-neutral-600">{row.label}</dt>
              <dd className="text-right tabular-nums">{row.amount}</dd>
            </div>
          ))}
          <dt className="border-t border-neutral-300 pt-1 text-base font-bold">Total</dt>
          <dd className="border-t border-neutral-300 pt-1 text-right text-base font-bold tabular-nums">
            {model.totalText}
          </dd>
        </dl>
      </section>

      <footer className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          {model.legends.transparency ? (
            <div className="rounded border border-neutral-400 p-2 text-xs">
              <p className="font-semibold">{model.legends.transparency.title}</p>
              <p className="tabular-nums">{model.legends.transparency.vatText}</p>
              <p className="tabular-nums">{model.legends.transparency.otherTaxesText}</p>
            </div>
          ) : null}
          {model.legends.lines.map((line) => (
            <p key={line} className="text-xs font-medium text-pretty">
              {line}
            </p>
          ))}
          <p className="text-[11px] text-neutral-600 text-pretty">{ARCA_DISCLAIMER}</p>
        </div>
        <div className="flex items-end gap-4 sm:justify-end">
          <Image
            src={qrDataUrl}
            alt={`Código QR de ARCA del comprobante ${model.documentLabel}`}
            width={112}
            height={112}
            className="size-28 shrink-0 [image-rendering:pixelated]"
            unoptimized
            priority
          />
          <dl className="grid gap-0.5 text-xs">
            <dt className="text-neutral-600">CAE N°</dt>
            <dd className="font-semibold tabular-nums">{model.caeText}</dd>
            <dt className="text-neutral-600">Vencimiento del CAE</dt>
            <dd className="font-semibold tabular-nums">{model.caeDueText}</dd>
          </dl>
        </div>
      </footer>
    </article>
  )
}
