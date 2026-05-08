export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app-gradient relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[520px] w-[680px] rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative">{children}</div>
    </div>
  )
}
