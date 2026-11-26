import '@/components/pos/kitchen/kds.css'

/**
 * Mientras llega la cola: el tablero vacío, con el mismo esqueleto que la pantalla (la franja de
 * arriba, un panel y la barra del teclado). Quieto: una tele que se prende no tiene que parpadear.
 */
export default function KitchenTvLoading() {
  return (
    <div className="pos">
      <div className="kds" data-mode="solo" aria-busy="true">
        <p className="sr-only" role="status">
          Cargando la cocina…
        </p>
        <header className="kds-top" aria-hidden />
        <main className="kds-panes" aria-hidden>
          <section className="kds-pane" />
        </main>
        <footer className="kds-bar" aria-hidden />
      </div>
    </div>
  )
}
