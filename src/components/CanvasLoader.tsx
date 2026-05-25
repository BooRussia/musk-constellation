export default function CanvasLoader() {
  return (
    <div
      id="constellation"
      className="flex items-center justify-center bg-black"
      role="status"
      aria-label="Loading constellation visualization"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 animate-pulse rounded-full border border-white/20" />
          <div className="absolute inset-2 animate-pulse rounded-full border border-white/10 delay-75" />
          <div className="absolute inset-4 rounded-full bg-white/5" />
        </div>
        <p className="font-mono text-xs tracking-[3px] text-white/40">LOADING CONSTELLATION</p>
      </div>
    </div>
  )
}
