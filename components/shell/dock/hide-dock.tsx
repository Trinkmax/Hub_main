/**
 * Esconde la barra de abajo del celular mientras esté en pantalla, como iOS al entrar a una tarea: una
 * pantalla con su propia barra de acciones abajo («Guardar», «Cerrar la caja») no tiene que pelearse con
 * las pestañas. Es una marca invisible: la regla vive en `components/shell/dock/dock.css`
 * (`html:has([data-dock-hide])`).
 *
 * Donde se puede, la marca va directo en la barra de acciones (`data-dock-hide=""`); esto es para cuando
 * la barra es un componente que no deja pasar atributos.
 */
export function HideDock() {
  return <span hidden data-dock-hide="" />
}
