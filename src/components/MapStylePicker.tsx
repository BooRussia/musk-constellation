import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Image as ImageIcon } from 'lucide-react'
import { MAP_STYLES, getMapStyle } from '../data/mapStyles'

interface Props {
  value: string
  onChange: (id: string) => void
  /** Disabled in Map view (the style only affects the Satellite globe). */
  disabled?: boolean
}

/**
 * Map-style picker — a custom dropdown at the top-right that drops a
 * column of thumbnail previews down the right side of the screen. Each
 * row shows a small image of the map so you pick by look, not name.
 * Thumbnails reuse each style's own equirectangular image (the photoreal
 * 8K is already cached by the 3D scene, so there's no extra load).
 */
export default function MapStylePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = getMapStyle(value)

  // Close on outside click / Escape.
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

  // When disabled (Map view) the menu is hidden by the render guard
  // below, so no explicit close effect is needed.
  return (
    <div className="mapstyle" ref={ref}>
      <button
        type="button"
        className={`mapstyle-trigger ${open ? 'mapstyle-trigger--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          disabled
            ? 'Switch to Satellite view to change the planet skin'
            : 'Swap the planet map'
        }
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="mapstyle-trigger-label">{current.label}</span>
        <ChevronDown className="mapstyle-trigger-chevron h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && !disabled && (
          <motion.ul
            key="menu"
            className="mapstyle-menu"
            role="listbox"
            aria-label="Map style"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          >
            {MAP_STYLES.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.id === value}
                  className={`mapstyle-item ${s.id === value ? 'mapstyle-item--on' : ''}`}
                  onClick={() => {
                    onChange(s.id)
                    setOpen(false)
                  }}
                >
                  <span
                    className="mapstyle-thumb"
                    style={{ backgroundImage: `url("${s.dayUrl}")` }}
                  />
                  <span className="mapstyle-item-label">{s.label}</span>
                  {s.id === value && (
                    <Check className="mapstyle-item-check h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
