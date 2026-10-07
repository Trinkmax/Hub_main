/**
 * La acción principal adentro del clon de WhatsApp (chat, ficha, diálogos del
 * chat): el verde de WhatsApp sobre el `Button` del kit.
 *
 * Fondo `--wa-accent-deep` y texto `--wa-panel` porque es el único par de los
 * tokens del `.wa` que pasa AA en los dos temas: en claro, casi blanco sobre
 * #008069 (4,8:1); en oscuro, casi negro sobre #21c063 (7,5:1). El verde
 * claro de antes (`--wa-accent` con texto blanco) daba 3,0:1 en claro y 2,4:1
 * en oscuro.
 */
export const waActionClass =
  'bg-(--wa-accent-deep) text-(--wa-panel) hover:bg-(--wa-accent-deep)/90'
