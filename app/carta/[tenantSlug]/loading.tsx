import './carta.css'

/**
 * Lo primero que se ve mientras llega la carta: el papel crema con la forma del inicio (el saludo, el
 * buscador y la primera portada). Sin esto se veía el «Cargando…» genérico de la plataforma, y con el
 * teléfono en modo oscuro, sobre negro: un parpadeo antes de la carta.
 */
export default function CartaLoading() {
  return (
    <div className="force-light">
      <div className="carta" aria-busy="true">
        <p className="sr-only" role="status">
          Cargando la carta…
        </p>
        <div aria-hidden className="mx-auto w-full max-w-6xl animate-pulse px-4 sm:px-6">
          <div className="pt-[max(env(safe-area-inset-top),1.25rem)]">
            <div className="h-11 w-28 rounded-xl bg-(--carta-paper-2)" />
          </div>
          <div className="pt-9 lg:pt-14">
            <div className="h-10 w-3/5 max-w-sm rounded-xl bg-(--carta-paper-2) sm:h-12" />
            <div className="mt-2.5 h-10 w-4/5 max-w-md rounded-xl bg-(--carta-paper-2) sm:h-12" />
            <div className="mt-7 h-[3.375rem] w-full max-w-xl rounded-full bg-(--carta-paper-2)" />
          </div>
          <div className="mt-9 grid gap-x-6 gap-y-11 md:grid-cols-2 lg:mt-14 lg:grid-cols-3">
            <div className="aspect-[5/4] rounded-[1.75rem] bg-(--carta-paper-2)" />
            <div className="hidden aspect-[5/4] rounded-[1.75rem] bg-(--carta-paper-2) md:block" />
            <div className="hidden aspect-[5/4] rounded-[1.75rem] bg-(--carta-paper-2) lg:block" />
          </div>
        </div>
      </div>
    </div>
  )
}
