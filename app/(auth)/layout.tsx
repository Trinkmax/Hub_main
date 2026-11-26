export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    // `min-h-dvh`: en un celular «100vh» mide más que lo que se ve. El manchón de fondo va solo en
    // pantallas grandes: en un teléfono modesto es lo más caro de dibujar de toda la pantalla.
    <main className="bg-app-gradient relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8 sm:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto hidden h-[480px] w-[680px] rounded-full bg-primary/15 blur-3xl sm:block"
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </main>
  )
}
