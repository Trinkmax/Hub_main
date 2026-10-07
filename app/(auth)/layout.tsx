export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-app-gradient relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[480px] w-[680px] rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </main>
  )
}
