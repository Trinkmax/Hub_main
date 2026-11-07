/**
 * Lo que Tex lee con `leer_manual` de Compras: cómo funciona de verdad, sacado del código
 * (`lib/purchasing/*`) y de `docs/features/compras.md`. Vale para cualquier bar.
 */
export const pedidosManual = `## Cómo funciona Compras
- Es para pedirle a los proveedores lo que hace falta. «Pedido» es lo que se le pide a un proveedor; una «Compra» en Administración es la factura o el papel de lo que ya se compró. No es lo mismo: si quiere cargar una factura, es Administración.
- La cocina cuenta el stock en su celular (Salón › Stock), los días de conteo de los Ajustes de Compras. Recorre las zonas y marca cada producto: Alcanza, Poco o No hay; lo que pide un evento, con el número exacto. Se guarda solo.
- Al mandar el conteo, el sistema arma un pedido por proveedor, «para revisar»: el objetivo, menos lo que hay, más lo que piden los eventos, menos lo que ya está en camino, redondeado hacia arriba a lo que se compra (cajas, bolsas, kg). «Poco» sin número cuenta como la mitad del objetivo. Un producto sin objetivo queda «a definir»: alguien tiene que decir cuánto.
- Quien compra revisa cada pedido, corrige lo que no cierra y lo manda por WhatsApp desde su propio teléfono: el mensaje sale armado, con el día de entrega. No sale del WhatsApp del bar.
- Cuando el proveedor contesta, se confirma: tal cual, o con cambios (lo que no tiene, otra cantidad, otro día). La cocina puede recibir un pedido mandado sin confirmar, con un aviso.
- La cocina recibe en Salón › Stock › Recibir: «Llegó todo bien» o producto por producto. Si algo llegó distinto, el pedido queda «con diferencias»: se le reclama al proveedor por WhatsApp y se cierra. Lo que faltó vuelve solo en el próximo pedido sugerido.
- El camino de un pedido: para revisar → enviado → confirmado (por llegar) → completado, o con diferencias → completado. «Hoy no pido» descarta uno para revisar. Uno enviado puede volver a borrador para corregirlo.
- Un Refuerzo es un conteo corto entre conteos: suma a los pedidos para revisar, no los borra. Si la cocina manda otro conteo, lo que contó reemplaza esos productos en el pedido que todavía no se mandó.
- Eventos: salen solos del calendario. Cada formato tiene su receta, pensada para una cantidad de personas; se compra para las reservadas y nunca menos que la receta. Quien compra puede fijar otro número para una fecha. Si el formato tiene varias variantes (el Ramen), hasta que se elige la de esa fecha no suma.
- Cantidades: se piden en lo que se compra («3 × Caja x 12», «66 kg»); la cocina cuenta en la unidad del insumo. Objetivo: cuánto tiene que haber después de recibir. En camino: lo mandado o confirmado que todavía no llegó.

## Lo que hacés con un tique
- Armar o corregir un pedido (preparar_pedido): lo que tiene que quedar pedido de cada producto (0 lo saca), sumar productos de la lista de insumos, la nota para el proveedor y, en uno «Sin proveedor», a quién se le pide. Si el proveedor no tiene uno para revisar, se le arma uno nuevo.
- Mandarlo (preparar_envio_pedido): un tique por pedido. El botón del tique lo marca enviado y abre WhatsApp con el mensaje en el mismo toque; sin WhatsApp cargado, copia el mensaje para pegarlo. Un «sí» escrito no lo manda: tiene que tocar el botón. Si dice «mandá todo», prepará uno por cada pedido para revisar.
- Antes de mandar tiene que estar todo definido: si hay algo «a definir», preguntá cuánto o sacalo con 0.
- Confirmar lo que contestó el proveedor (preparar_confirmacion_pedido). Reclamar lo que llegó distinto (preparar_reclamo_pedido, también abre WhatsApp, y no cierra el pedido). «Hoy no pido», volver a borrador y cerrar las diferencias (preparar_estado_pedido).
- El WhatsApp, el contacto, los días de entrega y la anticipación de un proveedor (preparar_proveedor_compras). Sin WhatsApp el pedido se copia a mano; sin días de entrega el mensaje le pregunta cuándo puede.
- Solo en la pantalla: contar y recibir (los hace la cocina), los insumos y sus objetivos, las recetas, la variante y las personas de un evento, las zonas y los Ajustes de Compras.`
