import 'server-only'
import QRCode from 'qrcode'

/**
 * Genera un QR como SVG inline para incrustar en una página.
 * Sin route handler — `dangerouslySetInnerHTML={{ __html: svg }}`.
 */
export async function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  })
}

/**
 * Genera un QR como data URL PNG para descarga directa.
 */
export async function renderQrPngDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  })
}
