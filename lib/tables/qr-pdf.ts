import 'server-only'
import QRCode from 'qrcode'

export type QrSheet = {
  tableLabel: string
  tenantName: string
  qrUrl: string
  qrDataUrl: string
}

/**
 * Genera la información necesaria para imprimir un QR de mesa.
 * Devuelve el data URL del QR (PNG en base64) y los textos a renderizar.
 * El componente client se encarga de presentar el sheet y disparar window.print().
 */
export async function buildQrSheet(opts: {
  qrToken: string
  tableLabel: string
  tenantName: string
  baseUrl: string
}): Promise<QrSheet> {
  const qrUrl = `${opts.baseUrl.replace(/\/+$/, '')}/m/${opts.qrToken}`
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 1024,
    color: { dark: '#000000', light: '#ffffff' },
  })
  return {
    tableLabel: opts.tableLabel,
    tenantName: opts.tenantName,
    qrUrl,
    qrDataUrl,
  }
}
