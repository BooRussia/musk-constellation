import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, type LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  label: string
  /** Count of active items, shown as a badge on the trigger. 0 = hidden. */
  badge?: number
  title?: string
  children: ReactNode
}

/**
 * Shared top-bar dropdown shell — the trigger button + a panel that drops
 * down the right side, with outside-click / Escape to close. Both the
 * Layers and Visuals menus render their toggle rows inside one of these so
 * the chrome stays identical.
 */
export default function MenuDropdown({ icon: Icon, label, badge = 0, title, children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="layers" ref={ref}>
      <button
        type="button"
        className={`layers-trigger ${open ? 'layers-trigger--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={title}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="layers-trigger-label">{label}</span>
        {badge > 0 && <span className="layers-badge">{badge}</span>}
        <ChevronDown className="layers-chevron h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="menu"
            className="layers-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
