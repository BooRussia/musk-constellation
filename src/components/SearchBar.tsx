import { useCallback, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search } from 'lucide-react'
import { GROUP_COLORS } from '../data/constellation'
import type { Node } from '../data/constellation'

interface SearchBarProps {
  query: string
  onQueryChange: (query: string) => void
  results: Node[]
  onSelect: (id: string) => void
  compact?: boolean
  className?: string
}

export default function SearchBar({
  query,
  onQueryChange,
  results,
  onSelect,
  compact = false,
  className = '',
}: SearchBarProps) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const isOpen = query.trim().length > 0
  const safeActiveIndex =
    results.length === 0 ? -1 : Math.min(activeIndex < 0 ? 0 : activeIndex, results.length - 1)

  const selectResult = useCallback(
    (index: number) => {
      const node = results[index]
      if (!node) return
      onSelect(node.id)
      setActiveIndex(-1)
    },
    [results, onSelect],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length === 0) return
      setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setActiveIndex(prev => (prev <= 0 ? results.length - 1 : prev - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (safeActiveIndex >= 0 && results[safeActiveIndex]) {
        selectResult(safeActiveIndex)
      } else if (results.length > 0) {
        selectResult(0)
      }
    }
  }

  const activeDescendant =
    safeActiveIndex >= 0 && results[safeActiveIndex]
      ? `${listboxId}-option-${results[safeActiveIndex].id}`
      : undefined

  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        aria-label="Search companies, subs, and partners"
        value={query}
        onChange={e => {
          onQueryChange(e.target.value)
          setActiveIndex(e.target.value.trim() ? 0 : -1)
        }}
        onKeyDown={handleKeyDown}
        placeholder={compact ? 'Search…' : 'Search companies, subs, partners...'}
        className="search-input w-full rounded-full pl-10 font-mono text-sm placeholder:text-white/30 focus:outline-none"
      />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-0 right-0 z-50 mt-1.5 min-w-[240px] rounded-xl border border-white/10 bg-black/95 p-1 shadow-2xl backdrop-blur-xl md:w-[320px]"
          >
            {results.length === 0 ? (
              <div
                role="status"
                className="px-3 py-3 text-sm text-white/50"
              >
                No matches for &ldquo;{query.trim()}&rdquo;
              </div>
            ) : (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Search results"
                className="max-h-64 overflow-y-auto"
              >
                {results.map((node, index) => {
                  const isActive = index === safeActiveIndex
                  return (
                    <li key={node.id} role="presentation">
                      <button
                        type="button"
                        id={`${listboxId}-option-${node.id}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectResult(index)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                          isActive ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: GROUP_COLORS[node.group] }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="search-result-title block text-white">{node.label}</span>
                          <span className="block truncate text-xs text-white/50">{node.short}</span>
                        </span>
                        <span className="text-[11px] text-white/30">{node.type.toUpperCase()}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
