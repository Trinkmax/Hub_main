export default function CustomerNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Link inválido</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este link ya no funciona o el bar regeneró tu QR. Pasá por la caja y pedile tu link nuevo.
        </p>
      </div>
    </main>
  )
}
