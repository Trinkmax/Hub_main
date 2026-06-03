import { Gift } from 'lucide-react'

export function CaptureHero({ headline, subtext }: { headline: string; subtext: string }) {
  return (
    <div className="relative overflow-hidden rounded-t-2xl bg-app-gradient px-6 pt-6 pb-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[--forest-glow] blur-2xl"
      />
      <div className="relative">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <Gift className="size-6" />
        </div>
        <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
          {headline}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{subtext}</p>
      </div>
    </div>
  )
}
