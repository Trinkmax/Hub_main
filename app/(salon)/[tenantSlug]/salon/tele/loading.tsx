import '@/components/pos/kitchen/kitchen.css'

/**
 * Mientras llega la cola: el riel vacío, con el mismo esqueleto que la pantalla (franja, riel, talones).
 * Quieto: una tele que se prende no tiene que parpadear.
 */
export default function KitchenTvLoading() {
  return (
    <div className="pos">
      <div className="kds" aria-busy="true">
        <p className="sr-only" role="status">
          Cargando la cocina…
        </p>
        <header className="kds-top" aria-hidden />
        <div className="kds-floor" aria-hidden>
          <section className="kds-rail">
            <div className="kds-rail-bar" />
            <ol className="kds-rail-track">
              {[0.62, 0.84, 0.5, 0.7].map((height) => (
                <li key={height} className="kds-slot">
                  <div className="kds-ghost" style={{ height: `${height * 100}%` }} />
                </li>
              ))}
            </ol>
          </section>
        </div>
        <footer className="kds-shelf" aria-hidden />
      </div>
    </div>
  )
}
