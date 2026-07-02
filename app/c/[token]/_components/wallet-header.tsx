// Encabezado liviano de la wallet: un saludo cálido. El carnet (abajo) es el que
// lleva el logo del bar en foil + el nombre completo del socio, así que acá no se
// duplica identidad ni marca.

export function WalletHeader({ firstName }: { firstName: string }): React.JSX.Element {
  return (
    <header className="text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Hola, {firstName}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Tu billetera de beneficios</p>
    </header>
  )
}
