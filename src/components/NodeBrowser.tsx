import { useCallback, useEffect, useRef } from 'react'
import { GROUP_COLORS } from '../data/constellation'
import type { Node } from '../data/constellation'

interface NodeBrowserProps {
  nodes: Node[]
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
  label?: string
}

export default function NodeBrowser({
  nodes,
  selectedId,
  onSelect,
  className = '',
  label = 'Visible nodes',
}: NodeBrowserProps) {
  const listRef = useRef<HTMLUListElement>(null)

  const focusOption = useCallback((index: number) => {
    const list = listRef.current
    if (!list) return
    const options = list.querySelectorAll<HTMLElement>('[role="option"]')
    options[index]?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const options = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    if (!options?.length) return

    const currentIndex = Array.from(options).findIndex(el => el === document.activeElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, options.length - 1)
      focusOption(next)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = currentIndex <= 0 ? 0 : currentIndex - 1
      focusOption(prev)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusOption(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusOption(options.length - 1)
    }
  }

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const selected = listRef.current.querySelector<HTMLElement>(`[data-node-id="${selectedId}"]`)
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (nodes.length === 0) return null

  return (
    <div className={className}>
      <div className="mb-2 text-xs uppercase tracking-[2px] text-white/50">{label}</div>
      <ul
        ref={listRef}
        role="listbox"
        aria-label={label}
        aria-activedescendant={selectedId ? `node-option-${selectedId}` : undefined}
        onKeyDown={handleKeyDown}
        className="max-h-48 space-y-1 overflow-y-auto"
        tabIndex={0}
      >
        {nodes.map(node => {
          const isSelected = node.id === selectedId
          return (
            <li key={node.id} role="presentation">
              <button
                type="button"
                id={`node-option-${node.id}`}
                role="option"
                data-node-id={node.id}
                aria-selected={isSelected}
                onClick={() => onSelect(node.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isSelected
                    ? 'border-white/30 bg-white/8 text-white'
                    : 'border-white/10 bg-white/3 text-white/80 hover:border-white/20 hover:bg-white/5'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: GROUP_COLORS[node.group] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-white/35">{node.type}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
