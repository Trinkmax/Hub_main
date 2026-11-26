import './carta.css'

export default function CartaNotFound() {
  return (
    <div className="force-light">
      <div className="carta flex flex-col justify-center px-6">
        <div className="mx-auto w-full max-w-md">
          <h1 className="font-serif text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-balance">
            No encontramos esta carta.
          </h1>
          <p className="mt-4 text-[1rem] leading-[1.55] text-(--carta-soft)">
            El enlace puede estar vencido o el bar todavía no publicó su carta. Pedile el QR
            actualizado a quien te atiende.
          </p>
        </div>
      </div>
    </div>
  )
}
