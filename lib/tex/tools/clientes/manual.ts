/**
 * El manual de Clientes y Club: lo que el sistema HACE, sacado del código (`lib/points`, las funciones de
 * la base y las pantallas). Es para cualquier bar: sin nombres de niveles, socios ni montos de ninguno.
 */
export const clientesManual = `# Clientes y Club

## Clientes
Un cliente tiene nombre, apellido y WhatsApp; mail y cumpleaños son opcionales. El teléfono es su identidad: un alta con un teléfono o un mail que ya existen no duplica. Se suma solo con el QR del club (formulario en la carta), aparece al cargar una reserva con teléfono, o se carga a mano en Nuevo cliente.
- **Personas**: pestañas Todos, Con puntos (ya consumieron) y Solo contacto (sin visitas); filtros por etiqueta, última visita y origen (Reservas o Walk-in).
- **Acepta promos**: se marca solo si el cliente lo confirmó y queda con fecha, hora e IP. Sin eso no le llegan difusiones.
- **No contactar**: no le llega ningún mensaje.
- **Avisos** (celíaco, alergia, vegetariano, vegano, movilidad reducida): salen solos en sus reservas y en el panel de mozos. Se sacan solo desde la ficha.
Teléfonos y mails completos, notas y avisos no los leés: sabés si tiene (tiene_notas, tiene_avisos) y para verlos llevás a su ficha.

## Dos tipos de puntos
- **Puntos canjeables**: el saldo. Suben al ganar, bajan al canjear, no vencen.
- **Puntos de categoría**: lo ganado en los últimos meses (la ventana del bar, 4 por defecto). Definen el nivel. Canjear no los baja: bajan porque lo viejo sale de la ventana.
El socio ve los dos en su billetera, pero no cuánto suma cada peso: eso es del panel.

## Cómo se ganan
1. **Sumar puntos** (el botón de Resumen, Clientes, la ficha y el Operativo: se busca al socio o se le escanea el QR, y se carga lo que pagó): usa solo la regla por monto activa de mayor prioridad: monto dividido «cada», redondeado para abajo, por sus puntos. Suma también una visita con ese monto. Sin regla activa queda la visita sin puntos. El mismo monto al mismo socio se rechaza por 3 minutos.
2. **Visita con detalle** (lo consumido de la carta, ítem por ítem): no tiene pantalla, la cargás vos con preparar_visita. Aplica todas las reglas activas a la vez, más los puntos extra de cada ítem.
3. **Bienvenida**: si tiene puntos de regalo, los recibe una vez al sumarse al club.
4. **Eventos**: cuando a su reserva de un evento le marcan «Llegó», suma los puntos del evento o los que el bar tenga por defecto.
No existe cargar ni restar puntos sueltos. Si te piden «sumale 500 puntos», explicalo y ofrecé cargar el consumo real: uno inventado infla sus visitas y lo gastado.

## Reglas de puntos
**Por monto** («1 punto cada $ X») o **por producto** (puntos por unidad de un ítem o de una categoría; la categoría cuenta solo sus ítems directos, no los de subcategorías). Las de producto no cuentan en Sumar puntos. No se editan: cambiar la tasa es crear la nueva y pausar la anterior, y preparar_regla_puntos lo hace en un tique. Con dos reglas por monto activas, la visita con detalle suma las dos y Sumar puntos usa la de mayor prioridad. Un cambio rige de ahí en más.

## Niveles
Es el de mayor umbral que alcanzan sus puntos de categoría, entre los activos. Sube en el momento en que gana puntos. Baja cuando vencen: un recálculo corre cada madrugada. Quien no llega a ningún umbral queda sin nivel. Cambiar un umbral o pausar un nivel no mueve a nadie al instante: se aplica con su próximo movimiento o con el recálculo. La billetera avisa qué puntos vencen en 30 días.
Beneficios de un nivel:
- **Ítem gratis**: una recompensa que sale sola, en la tanda de cada madrugada: una vez por mes, o una vez por año en el mes de su cumpleaños. Le queda para retirar, sin gastar puntos.
- **Descuento**, **Beneficio** y **Marca aliada**: se muestran en la billetera y los aplica el personal.

## Recompensas y canjes
Cuesta puntos; puede tener stock, nivel mínimo, estar fuera del catálogo o pausada. Dos formas de canjear:
- **Desde el panel** (Canjear puntos en la ficha, o preparar_canje): descuenta en el momento y queda entregada.
- **Desde la billetera**: al socio le sale un QR que vence a los 30 minutos; los puntos se descuentan cuando el personal lo escanea en Sumar puntos › Escanear QR. Un QR activo por socio.
Los regalos que salen solos (bienvenida, ítem gratis, punch card completa) quedan para retirar: también se entregan escaneando su QR en Sumar puntos.
**Pagar con puntos**: si está prendido, el saldo sirve de descuento al cobrar una mesa en el salón, con un valor por punto y un tope sobre su parte de la cuenta.

## Marcas aliadas
Cada marca tiene beneficios y cada uno llega a los niveles que se elijan, en cualquier combinación. El socio ve solo el de su nivel. Una marca nueva arranca en borrador y no se ve hasta activarla; un beneficio sin niveles no lo ve nadie.

## Punch cards
Piden N sellos y dan una recompensa: «6 cafés y el 7mo gratis» son 6. Se sellan a mano con el «+1» de Sumar puntos; también pueden sellarse solas por consumir un ítem, categoría o etiqueta (en una visita con detalle) o por visita en un horario. Pueden tener tope por día, vencimiento y niveles: al que no llega se le muestra bloqueada o no se le muestra. Quien baja de nivel no pierde sus sellos. Al completarla le queda el premio para retirar y arranca otra. Subir los sellos pedidos no alarga las ya empezadas.

## QR
Hay dos QR fijos: el de la carta, para las mesas (botón «QR de la carta» en Carta), y el del club, que abre la carta con el formulario (botón «QR del club» en Club). Además, cada socio tiene su QR personal en la billetera: se lo escanea desde Sumar puntos para sumarle y sellar.

## Lo que se hace en su pantalla
Con un tique tuyo va casi todo lo de arriba. Para esto llevala:
- Borrar un cliente o regenerar su QR: su ficha.
- Mandarles algo a muchos clientes: una difusión, en Mensajería.
- El equipo y sus roles: Configuración.
- Entregar un canje o un regalo: Sumar puntos › Escanear QR, porque hay que escanear el QR.
- Borrar una regla, un nivel, una recompensa, un aliado o una tarjeta: Club (mejor pausar, que se puede volver atrás).
- Fotos, logos, íconos, el orden, punch cards que se sellan solas y el aviso de captura de datos: Club.
- Qué recompensa regala la bienvenida: Club › Bienvenida.
- Cómo lo ve el socio: Club › Simular wallet.
Cargar muchos clientes de una vez no se hace desde acá.

## Palabras
Socio: el cliente que está en el club, con su billetera. Saldo: los puntos canjeables. Categoría: el nivel. Tarjeta de sellos: punch card. Sumar puntos (antes «Acreditar») es cargar un consumo para que sume; canjear es gastar.`
