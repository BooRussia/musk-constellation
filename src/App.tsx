import React, { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import {
  X, RotateCcw, Layers, ZoomIn, Info,
  Globe, ChevronUp, ChevronDown, Menu, Network, Activity,
  PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import SearchBar from './components/SearchBar'
import NodeBrowser from './components/NodeBrowser'
import WebGLErrorBoundary from './components/WebGLErrorBoundary'
import CanvasLoader from './components/CanvasLoader'
import {
  NODES, LINKS,
  getChildren, getNodeLinks, getNodeById, getParentId, getVisibleNodes,
  getLinkRole, getLinkRoleLabel,
  GROUP_COLORS, LINK_COLORS, LINK_LABELS,
  INITIAL_FOCUS,
} from './data/constellation'
import type { Link } from './data/constellation'

const ConstellationCanvas = lazy(() => import('./components/ConstellationCanvas'))

function formatLinkDescription(link: Link): string {
  return link.note || `${LINK_LABELS[link.type]} connection`
}

/**
 * Mobile bottom-sheet drag handle. Tap to collapse; swipe down past a
 * threshold (or with high velocity) to dismiss. Uses inline transforms
 * for buttery-smooth tracking during the drag, then either snaps back
 * to open or hands off to the CSS slide-off animation on dismiss.
 *
 * Also drives a `--sheet-drag` CSS variable on the panel so the camera
 * (and anything else that wants to track drag progress) can read where
 * the sheet currently is between fully-open (0) and fully-closed (1).
 */
function SheetHandle({ onDismiss }: { onDismiss: () => void }) {
  const dragStartY = useRef<number | null>(null)
  const dragStartTime = useRef(0)
  const dragOffset = useRef(0)
  const panelRef = useRef<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const setSheetProgress = (panel: HTMLElement, progress: number) => {
    // progress: 0 = fully open, 1 = fully dismissed
    panel.style.setProperty('--sheet-drag', progress.toFixed(4))
  }

  const onTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    const panel = e.currentTarget.closest('.details-panel') as HTMLElement | null
    if (!panel) return
    panelRef.current = panel
    dragStartY.current = e.touches[0].clientY
    dragStartTime.current = Date.now()
    dragOffset.current = 0
    setIsDragging(true)
    // Suspend the CSS transform transition so the drag follows the finger
    // 1:1 without easing lag.
    panel.style.transition = 'none'
  }

  const onTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null || !panelRef.current) return
    const delta = e.touches[0].clientY - dragStartY.current
    if (delta < 0) {
      // Don't allow dragging the sheet above its fully-open resting position.
      panelRef.current.style.transform = 'translateY(0)'
      dragOffset.current = 0
      setSheetProgress(panelRef.current, 0)
      return
    }
    dragOffset.current = delta
    panelRef.current.style.transform = `translateY(${delta}px)`
    const panelH = panelRef.current.getBoundingClientRect().height || 1
    setSheetProgress(panelRef.current, Math.min(1, delta / panelH))
  }

  // Commit a close: drive React state, then drop the inline transform on
  // the next frame so the CSS class (.details-panel--mobile-hidden) wins
  // the cascade and the CSS transition animates from the finger's last
  // position down to translateY(100%). If we cleared the inline transform
  // first the panel would snap to 0 before transitioning, producing a
  // visible jump.
  const commitClose = (panel: HTMLElement) => {
    panel.style.transition = ''
    setSheetProgress(panel, 1)
    onDismiss()
    requestAnimationFrame(() => {
      if (panel) panel.style.transform = ''
    })
  }

  // Snap back to fully open: clear inline transform with the CSS
  // transition restored so the panel eases from the drag offset back
  // to translateY(0).
  const snapBackOpen = (panel: HTMLElement) => {
    panel.style.transition = ''
    setSheetProgress(panel, 0)
    panel.style.transform = ''
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    const panel = panelRef.current
    if (!panel) {
      dragStartY.current = null
      setIsDragging(false)
      return
    }
    const panelH = panel.getBoundingClientRect().height || 1
    const elapsed = Date.now() - dragStartTime.current
    const velocity = dragOffset.current / Math.max(elapsed, 1) // px/ms
    const distanceClose = dragOffset.current > panelH * 0.28
    const flickClose = velocity > 0.6 && dragOffset.current > 24
    const isTap = dragOffset.current === 0 && elapsed < 350

    // Suppress the iOS-synthesized click so it can't fire onDismiss a
    // second time (with the panel already gone) and create the "ghost
    // tap that falls through to the canvas and deselects the node" bug.
    if (isTap || distanceClose || flickClose) {
      e.preventDefault()
    }

    if (isTap || distanceClose || flickClose) {
      commitClose(panel)
    } else {
      snapBackOpen(panel)
    }
    dragStartY.current = null
    dragOffset.current = 0
    setIsDragging(false)
  }

  const onTouchCancel = () => {
    const panel = panelRef.current
    if (panel) snapBackOpen(panel)
    dragStartY.current = null
    dragOffset.current = 0
    setIsDragging(false)
  }

  return (
    <button
      type="button"
      onClick={onDismiss}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className={`details-panel-handle md:hidden ${isDragging ? 'is-dragging' : ''}`}
      aria-label="Collapse details panel — tap or swipe down"
      aria-controls="main-content"
    >
      <span className="handle-grip" aria-hidden="true" />
      <span className="handle-hint">
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
        Tap or swipe down
      </span>
    </button>
  )
}

/**
 * Peek tab at the bottom of the screen when the sheet is collapsed.
 * Tap to open, or drag UPWARD to slide the sheet up in lockstep with
 * the finger. Mirrors SheetHandle so the bottom sheet has matching
 * tactile gestures in both directions. Writes the same `--sheet-drag`
 * CSS var (0 = open, 1 = dismissed) so the camera reframe in the 3D
 * canvas tracks the partial-open state smoothly.
 */
function PeekTab({ label, onExpand }: { label: string; onExpand: () => void }) {
  const dragStartY = useRef<number | null>(null)
  const dragStartTime = useRef(0)
  const dragOffset = useRef(0) // positive = dragged up (toward open)
  const panelRef = useRef<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const findPanel = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.details-panel')

  const onTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    dragStartY.current = e.touches[0].clientY
    dragStartTime.current = Date.now()
    dragOffset.current = 0
    panelRef.current = findPanel()
    if (panelRef.current) {
      // Freeze CSS transitions so the drag tracks the finger 1:1.
      panelRef.current.style.transition = 'none'
      // Start position = fully dismissed; we'll lift it as the user drags up.
      panelRef.current.style.transform = 'translateY(100%)'
      panelRef.current.style.setProperty('--sheet-drag', '1')
    }
    setIsDragging(true)
  }

  const onTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null || !panelRef.current) return
    const delta = dragStartY.current - e.touches[0].clientY // positive = up
    if (delta <= 0) {
      panelRef.current.style.transform = 'translateY(100%)'
      panelRef.current.style.setProperty('--sheet-drag', '1')
      dragOffset.current = 0
      return
    }
    const panelH = panelRef.current.getBoundingClientRect().height || 1
    const clamped = Math.min(delta, panelH)
    dragOffset.current = clamped
    // panelH px when fully dismissed, 0 when fully open
    const translateY = panelH - clamped
    panelRef.current.style.transform = `translateY(${translateY}px)`
    panelRef.current.style.setProperty('--sheet-drag', (1 - clamped / panelH).toFixed(4))
  }

  // Commit open: drive React state, drop the inline transform on the
  // next frame so the absence of the .details-panel--mobile-hidden class
  // (transform: translateY(0)) wins via CSS transition from the finger's
  // last position up to fully open. Avoids the snap-back-to-100% bug.
  const commitOpen = (panel: HTMLElement) => {
    panel.style.transition = ''
    panel.style.setProperty('--sheet-drag', '0')
    onExpand()
    requestAnimationFrame(() => {
      if (panel) panel.style.transform = ''
    })
  }

  // Snap back to dismissed: restore the CSS transition + clear the
  // inline transform so the panel eases from drag offset back to
  // translateY(100%) (the --mobile-hidden CSS rule).
  const snapBackClosed = (panel: HTMLElement) => {
    panel.style.transition = ''
    panel.style.transform = ''
    panel.style.setProperty('--sheet-drag', '1')
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    const panel = panelRef.current
    if (!panel) {
      dragStartY.current = null
      dragOffset.current = 0
      setIsDragging(false)
      return
    }
    const panelH = panel.getBoundingClientRect().height || 1
    const elapsed = Date.now() - dragStartTime.current
    const velocity = dragOffset.current / Math.max(elapsed, 1) // px/ms upward
    const distanceOpen = dragOffset.current > panelH * 0.28
    const flickOpen = velocity > 0.6 && dragOffset.current > 24
    const isTap = dragOffset.current === 0 && elapsed < 350

    if (isTap || distanceOpen || flickOpen) {
      // Suppress the iOS-synthesized click so onExpand isn't fired twice.
      e.preventDefault()
      commitOpen(panel)
    } else {
      snapBackClosed(panel)
    }
    dragStartY.current = null
    dragOffset.current = 0
    setIsDragging(false)
  }

  const onTouchCancel = () => {
    const panel = panelRef.current
    if (panel) snapBackClosed(panel)
    dragStartY.current = null
    dragOffset.current = 0
    setIsDragging(false)
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className={`mobile-panel-peek md:hidden ${isDragging ? 'is-dragging' : ''}`}
      aria-expanded={false}
      aria-controls="main-content"
      aria-label="Expand details panel — tap or swipe up"
    >
      <span className="mobile-panel-peek-grip" aria-hidden="true" />
      <span className="mobile-panel-peek-label">
        {label}
        <ChevronUp className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
      </span>
    </button>
  )
}

// ============================================
// MAIN APP
// ============================================
export default function MuskConstellation() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['tesla', 'spacex', 'xai']))
  const [searchQuery, setSearchQuery] = useState('')
  const [showLegend, setShowLegend] = useState(false)
  const [showMobilePanel, setShowMobilePanel] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)
  const [showAllWeb, setShowAllWeb] = useState(false)
  const [showAllPulse, setShowAllPulse] = useState(false)
  // Incremented every time RESET is pressed. ConstellationCanvas
  // listens for changes and animates the camera back to the initial
  // fitted home view.
  const [resetSignal, setResetSignal] = useState(0)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)

  // Track whether the bottom-sheet layout is active so the canvas knows
  // when to apply the upward camera reframe (only on mobile, only when
  // the sheet is overlaying part of the canvas).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 767px)')
    const update = () => setIsNarrowViewport(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  // Close mobile menu when tapping anywhere outside it.
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (!mobileMenuRef.current?.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('touchstart', onDocClick as unknown as EventListener)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick as unknown as EventListener)
    }
  }, [mobileMenuOpen])
  const [showDesktopPanel, setShowDesktopPanel] = useState(true)
  const [showLeftSidebar, setShowLeftSidebar] = useState(true)

  const selectedNode = selectedId ? getNodeById(selectedId) : null

  const visibleNodes = useMemo(
    () => getVisibleNodes(expandedIds),
    [expandedIds],
  )

  const highlightLinkIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const links = getNodeLinks(selectedId)
    return new Set(links.map(l => `${l.source}-${l.target}`))
  }, [selectedId])

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return NODES.filter(n =>
      n.label.toLowerCase().includes(q) ||
      n.short.toLowerCase().includes(q) ||
      (n.mission && n.mission.toLowerCase().includes(q)),
    ).slice(0, 6)
  }, [searchQuery])

  // ============================================
  // ACTIONS
  // ============================================
  const handleExpand = useCallback((parentId: string) => {
    const parent = getNodeById(parentId)
    if (!parent || !parent.children || parent.children.length === 0) {
      toast.error('No sub-webs defined for this node')
      return
    }

    setExpandedIds(prev => {
      const next = new Set(prev)
      const wasExpanded = next.has(parentId)
      if (wasExpanded) {
        next.delete(parentId)
        toast('Collapsed sub-webs', { description: parent.label })
      } else {
        next.add(parentId)
        const childCount = parent.children?.length || 0
        toast.success(`Expanded ${parent.label}`, {
          description: `${childCount} sub-webs now visible in the constellation`,
        })
      }
      return next
    })
  }, [])

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    setSearchQuery('')
    if (id) {
      setShowMobilePanel(true)
      setShowDesktopPanel(true)
    }
  }, [])

  const resetView = useCallback(() => {
    // True home state — matches what the page looks like on first load.
    // No selected node, default expanded set, panels closed, search cleared,
    // camera animated back to the initial fitted position.
    // Display preferences (legend, sidebar visibility, WEB/PULSE toggles)
    // are intentionally preserved so the user's view settings survive a
    // reset.
    setSelectedId(null)
    setExpandedIds(new Set(['tesla', 'spacex', 'xai']))
    setSearchQuery('')
    setShowMobilePanel(false)
    setResetSignal(n => n + 1)
    toast('Constellation reset', { description: 'Back to the home view' })
  }, [])

  const expandAll = useCallback(() => {
    const allParents = NODES.filter(n => n.children?.length).map(n => n.id)
    setExpandedIds(new Set(allParents))
    toast.success('All sub-webs expanded', { description: 'Full depth of the empire now visible' })
  }, [])

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set())
    setSelectedId(null)
    toast('All collapsed', { description: 'Showing only core nodes' })
  }, [])

  // Selecting a sub-node from search (or anywhere else) when its parent
  // isn't expanded would previously open the side panel but skip the
  // camera fly-to because the sub orb wasn't in the live simNodes set.
  // Auto-expand the parent first, give the simulation a tick to place
  // the new orb near its real spot, THEN trigger the select so the
  // fly-to animation lands on something visible.
  const flyToNode = useCallback((id: string) => {
    const target = getNodeById(id)
    if (target?.type === 'sub') {
      const parentId = getParentId(id)
      if (parentId && !expandedIds.has(parentId)) {
        setExpandedIds(prev => {
          if (prev.has(parentId)) return prev
          const next = new Set(prev)
          next.add(parentId)
          return next
        })
        // Delay matches the d3-force tick rate enough to let the new
        // orb settle near its connected position before the camera flies.
        window.setTimeout(() => handleSelect(id), 320)
        return
      }
    }
    handleSelect(id)
  }, [handleSelect, expandedIds])

  const handleEscape = useCallback(() => {
    if (showLegend) {
      setShowLegend(false)
      return
    }
    if (searchQuery.trim()) {
      setSearchQuery('')
      return
    }
    if (selectedId) {
      handleSelect(null)
    }
  }, [showLegend, searchQuery, selectedId, handleSelect])

  // The X on the details panel closes the panel + clears the selection
  // but DOES NOT move the camera. If the user wants the camera back at
  // home they can press RESET (or R). This split gives users two
  // distinct verbs:
  //   • X / ESC  — "I'm done reading, leave me where I am"
  //   • RESET    — "take me back to the page-load view"
  const closeDetailsPanel = useCallback(() => {
    setShowDesktopPanel(false)
    setShowMobilePanel(false)
    setSelectedId(null)
  }, [])

  const liveAnnouncement = selectedNode
    ? `Selected ${selectedNode.label}. ${selectedNode.short}`
    : 'No node selected. Overview panel visible.'

  // ============================================
  // RENDER
  // ============================================
  const panelOpen = showDesktopPanel
  const layoutVars = {
    '--panel-w': panelOpen ? '440px' : '0px',
    '--sidebar-w': showLeftSidebar ? '294px' : '0px',
    '--panel-width': panelOpen ? '440px' : '0px',
    '--sidebar-width': showLeftSidebar ? '294px' : '0px',
  } as React.CSSProperties

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="relative h-full w-full overflow-hidden bg-black text-[#e5e5e5]"
        style={layoutVars}
      >
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        <div className={`canvas-viewport ${showMobilePanel ? 'canvas-viewport--mobile-panel-open' : ''}`}>
          <Suspense fallback={<CanvasLoader />}>
            <WebGLErrorBoundary onSelect={flyToNode}>
              <ConstellationCanvas
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={handleSelect}
                onExpand={handleExpand}
                highlightLinkIds={highlightLinkIds}
                bottomOverlayFraction={isNarrowViewport && showMobilePanel ? 0.55 : 0}
                showAllWeb={showAllWeb}
                showAllPulse={showAllPulse}
                resetSignal={resetSignal}
              />
            </WebGLErrorBoundary>
          </Suspense>
        </div>

        <header className="topnav ui-layer">
          <div className="topnav-brand">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/25">
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className="brand-text">
              <p className="brand-eyebrow">THE LIVING WEB</p>
              <h1>CONSTELLATION</h1>
            </div>
            <span className="topnav-tagline">
              ELON MUSK&apos;S INTERCONNECTED EMPIRE
            </span>
          </div>

          <div className="topnav-search">
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchResults}
              onSelect={flyToNode}
              compact
            />
          </div>

          <nav aria-label="Constellation controls" className="topnav-actions">
            <div className="topnav-actions-desktop hidden md:flex">
              <button type="button" onClick={resetView} className="btn" title="Reset to home view — camera + selection (R)">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> RESET
              </button>
              <button type="button" onClick={expandAll} className="btn">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" /> EXPAND
              </button>
              <button type="button" onClick={collapseAll} className="btn btn-ghost">
                COLLAPSE
              </button>
              <button
                type="button"
                onClick={() => setShowAllWeb(v => !v)}
                className={`btn ${showAllWeb ? 'border-white/40 text-white' : ''}`}
                aria-pressed={showAllWeb}
                title="Show all link lines persistently"
              >
                <Network className="h-3.5 w-3.5" aria-hidden="true" /> WEB
              </button>
              <button
                type="button"
                onClick={() => setShowAllPulse(v => !v)}
                className={`btn ${showAllPulse ? 'border-white/40 text-white' : ''}`}
                aria-pressed={showAllPulse}
                title="Pulse animated flow particles on every connection"
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" /> PULSE
              </button>
              <button
                type="button"
                onClick={() => setShowLegend(v => !v)}
                className={`btn ${showLegend ? 'border-white/40' : ''}`}
                aria-expanded={showLegend}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" /> LEGEND
              </button>
            </div>

            <div ref={mobileMenuRef} className="topnav-actions-mobile relative flex items-center gap-2 md:!hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(v => !v)}
                aria-expanded={mobileMenuOpen}
                aria-haspopup="menu"
                className={`btn ${mobileMenuOpen ? 'border-white/40' : ''}`}
              >
                {mobileMenuOpen ? (
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Menu className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="ml-1">{mobileMenuOpen ? 'CLOSE' : 'MENU'}</span>
              </button>
              {mobileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-xl border border-white/10 bg-black/95 p-2 shadow-2xl backdrop-blur-xl"
                >
                  <button
                    type="button"
                    onClick={() => { resetView(); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className="btn mb-1 w-full justify-start gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> RESET
                  </button>
                  <button
                    type="button"
                    onClick={() => { expandAll(); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className="btn mb-1 w-full justify-start gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" /> EXPAND ALL
                  </button>
                  <button
                    type="button"
                    onClick={() => { collapseAll(); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className="btn btn-ghost mb-1 w-full justify-start"
                  >
                    COLLAPSE
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAllWeb(v => !v); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className={`btn mb-1 w-full justify-start gap-1.5 ${showAllWeb ? 'border-white/40 text-white' : ''}`}
                    aria-pressed={showAllWeb}
                  >
                    <Network className="h-3.5 w-3.5" aria-hidden="true" /> WEB
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAllPulse(v => !v); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className={`btn mb-1 w-full justify-start gap-1.5 ${showAllPulse ? 'border-white/40 text-white' : ''}`}
                    aria-pressed={showAllPulse}
                  >
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" /> PULSE
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowLegend(v => !v); setMobileMenuOpen(false) }}
                    role="menuitem"
                    className={`btn w-full justify-start gap-1.5 ${showLegend ? 'border-white/40' : ''}`}
                    aria-expanded={showLegend}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" /> LEGEND
                  </button>
                </div>
              )}
            </div>
          </nav>
        </header>

        <aside
          className={`ui-layer left-sidebar ${showLeftSidebar ? '' : 'left-sidebar--collapsed'} ${showLegend ? 'left-sidebar--legend-open' : ''}`}
        >
          <div className="glass panel rounded-2xl p-5 text-sm">
            <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[2px] text-white/50">
              <h2 className="text-xs font-normal uppercase tracking-[2px]">THE EMPIRE</h2>
              <div className="font-mono text-[12px] tracking-[1px]">
                {NODES.filter(n => n.type === 'core').length} CORES • {expandedIds.size} EXPANDED
              </div>
            </div>

            <div className="space-y-2.5 text-base">
              <div className="flex justify-between"><span className="text-white/60">Combined valuation</span> <span className="font-mono text-white/90">~$3.5T+</span></div>
              <div className="flex justify-between"><span className="text-white/60">Nodes (cores + subs + ext)</span> <span className="font-mono text-white/90">{NODES.length}</span></div>
              <div className="flex justify-between"><span className="text-white/60">Documented links</span> <span className="font-mono text-white/90">{LINKS.length}</span></div>
            </div>

            <div className="my-4 h-px bg-white/10" />

            <NodeBrowser
              nodes={visibleNodes}
              selectedId={selectedId}
              onSelect={flyToNode}
              label="Visible nodes"
            />

            <div className="mt-4 text-xs leading-relaxed text-white/50">
              Drag to rotate • Scroll to zoom • Click any node to focus.<br />
              Use <span className="font-mono text-white/70">EXPAND</span> to reveal sub-webs and deeper revenue drivers.
            </div>
          </div>
        </aside>

        <button
          type="button"
          onClick={() => setShowLeftSidebar(v => !v)}
          className={`ui-layer left-sidebar-toggle hidden lg:flex ${showLeftSidebar ? 'left-sidebar-toggle--open' : ''}`}
          aria-expanded={showLeftSidebar}
          aria-label={showLeftSidebar ? 'Hide empire sidebar' : 'Show empire sidebar'}
        >
          {showLeftSidebar ? (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {/* Mobile peek tab — visible only while the sheet is collapsed.
            Tap or drag UP to expand. Mirrors the SheetHandle drag-down
            gesture so the bottom sheet feels fully tactile in both
            directions. */}
        {!showMobilePanel && (
          <PeekTab
            label={selectedNode ? selectedNode.label : 'Tap for details'}
            onExpand={() => setShowMobilePanel(true)}
          />
        )}

        <AnimatePresence mode="wait">
          {selectedNode ? (
              <motion.main
                key={selectedNode.id}
                id="main-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={`details-panel glass panel border-l border-white/10 bg-black/90 text-sm ${!showMobilePanel ? 'details-panel--mobile-hidden' : ''} ${!showDesktopPanel ? 'details-panel--desktop-collapsed' : ''}`}
              >
                <SheetHandle onDismiss={() => setShowMobilePanel(false)} />
                <div className="details-panel-header mb-6 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div
                      className="mb-1 inline-block rounded px-2 py-px text-[12px] font-medium tracking-[1.5px]"
                      style={{ backgroundColor: GROUP_COLORS[selectedNode.group] + '22', color: GROUP_COLORS[selectedNode.group] }}
                    >
                      {selectedNode.type.toUpperCase()} • {selectedNode.group.toUpperCase()}
                    </div>
                    <h2 className="company-title tracking-[-0.8px]">{selectedNode.label}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetailsPanel}
                    className="btn btn-ghost shrink-0 p-2"
                    aria-label="Close details panel"
                    title="Close panel (keeps camera). RESET to go home."
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                {selectedNode.mission && (
                  <div className="mission mb-6 text-[15px] leading-tight">
                    &ldquo;{selectedNode.mission}&rdquo;
                  </div>
                )}

                <div className="mb-6 grid grid-cols-1 gap-2.5">
                  {selectedNode.metric && (
                    <div className="rounded-xl border border-white/10 bg-white/3 px-4 py-3">
                      <div className="label mb-1">KEY METRIC</div>
                      <div className="stat text-base text-white/90">{selectedNode.metric}</div>
                    </div>
                  )}
                  {selectedNode.revenueNote && (
                    <div className="rounded-xl border border-white/10 bg-white/3 px-4 py-3">
                      <div className="label mb-1">REVENUE / IMPACT</div>
                      <div className="text-sm leading-snug text-white/85">{selectedNode.revenueNote}</div>
                    </div>
                  )}
                </div>

                {selectedNode.children && selectedNode.children.length > 0 && (
                  <div className="mb-8">
                    <h2 className="section-title">SUB-WEBS &amp; REVENUE DRIVERS</h2>
                    <div className="space-y-2.5">
                      {(selectedNode.children ? getChildren(selectedNode.id) : []).map(child => {
                        const isExpanded = expandedIds.has(selectedNode.id)
                        return (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => {
                              if (!isExpanded) handleExpand(selectedNode.id)
                              setTimeout(() => handleSelect(child.id), 120)
                            }}
                            className="group flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/3 px-3 py-2.5 text-left transition hover:border-white/25 hover:bg-white/5"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="h-1.5 w-1.5 rounded-full" style={{ background: GROUP_COLORS[child.group] }} />
                              <span className="font-medium text-white/90 group-hover:text-white">{child.label}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-white/40">
                              {child.metric?.split('•')[0].trim()}
                              <ZoomIn className="h-3 w-3 opacity-40 group-hover:opacity-70" aria-hidden="true" />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExpand(selectedNode.id)}
                      className="mt-2 w-full rounded-lg border border-white/10 py-1.5 text-xs uppercase tracking-widest text-white/50 hover:bg-white/5"
                    >
                      {expandedIds.has(selectedNode.id) ? 'COLLAPSE SUB-WEBS FROM CONSTELLATION' : 'ADD SUB-WEBS TO 3D CONSTELLATION'}
                    </button>
                  </div>
                )}

                <div>
                  <h2 className="section-title">HOW IT WEAVES IN THE WEB</h2>
                  <div className="space-y-2.5">
                    {getNodeLinks(selectedNode.id).length === 0 && (
                      <div className="text-sm text-white/40">No direct documented links in current view.</div>
                    )}
                    {getNodeLinks(selectedNode.id).map((link) => {
                      const role = getLinkRole(link, selectedNode.id)
                      const otherId = role === 'outgoing' ? link.target : link.source
                      const other = getNodeById(otherId)
                      if (!other) return null
                      const roleLabel = getLinkRoleLabel(link, selectedNode.id)
                      const arrow = role === 'outgoing' ? '→' : '←'
                      return (
                        <button
                          key={`${link.source}-${link.target}-${link.type}`}
                          type="button"
                          onClick={() => handleSelect(otherId)}
                          className="w-full rounded-xl border border-white/10 bg-white/3 px-3.5 py-3 text-left transition hover:border-white/30 hover:bg-white/5"
                        >
                          <div className="connection-row flex flex-wrap items-center gap-2">
                            <span
                              className="conn-pill shrink-0"
                              style={{ borderColor: LINK_COLORS[link.type] + '55', color: LINK_COLORS[link.type] }}
                              title={LINK_LABELS[link.type]}
                            >
                              {roleLabel.toUpperCase()}
                            </span>
                            <span
                              aria-hidden="true"
                              className="font-mono text-base leading-none text-white/45"
                            >
                              {arrow}
                            </span>
                            <span className="connection-label font-medium text-white/90">{other.label}</span>
                          </div>
                          <div className="mt-1.5 text-sm leading-tight text-white/70">
                            {formatLinkDescription(link)}
                          </div>
                          {link.label && (
                            <div className="mt-1 font-mono text-xs text-white/40">{link.label}</div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {selectedNode.assists && selectedNode.assists.length > 0 && (
                  <div className="mt-7 border-t border-white/10 pt-5">
                    <h2 className="section-title text-[#f97316]">ASSISTS OUTSIDE THE UMBRELLA</h2>
                    {selectedNode.assists.map((assist) => {
                      const targetNode = getNodeById(assist.target)
                      return (
                        <div key={assist.target} className="mb-4 rounded-xl border-l-2 border-[#f97316] bg-white/3 py-2.5 pl-3.5 text-sm">
                          <div className="font-medium text-white/85">
                            {targetNode ? targetNode.label : assist.target}
                          </div>
                          <div className="text-white/60">{assist.description}</div>
                          {targetNode && (
                            <button type="button" onClick={() => handleSelect(assist.target)} className="mt-1 text-xs text-[#f97316] hover:underline">
                              FOCUS IN CONSTELLATION →
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="mt-8 text-xs text-white/30">
                  Data synthesized from public filings, NASA contracts, company statements (2025-2026).
                  Some figures are estimates. This is an interpretive living map.
                </div>
              </motion.main>
            ) : (
              <motion.main
                key="overview"
                id="main-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`details-panel glass panel border-l border-white/10 bg-black/90 ${!showMobilePanel ? 'details-panel--mobile-hidden' : ''} ${!showDesktopPanel ? 'details-panel--desktop-collapsed' : ''}`}
              >
                <SheetHandle onDismiss={() => setShowMobilePanel(false)} />
                <div className="details-panel-header mb-5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[3px] text-white/50">THE DEEP WEB</p>
                    <h2 className="company-title text-[26px] font-semibold tracking-[-1.2px] text-white">Elon Musk&apos;s Empire</h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetailsPanel}
                    className="btn btn-ghost shrink-0 p-2"
                    aria-label="Close details panel"
                    title="Close panel (keeps camera). RESET to go home."
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="prose prose-invert text-sm leading-relaxed text-white/75">
                  This is a fully interactive 3D spatial constellation of the companies, divisions, products,
                  and external partners that form one of the most ambitious industrial webs in history.
                </div>

                <div className="my-6 h-px bg-white/10" />

                <div className="space-y-4 text-sm">
                  <div>
                    <div className="label mb-1">CORE NODES</div>
                    <div className="text-white/80">Tesla, SpaceX (acq. xAI, Feb 2026), xAI, Neuralink, X, The Boring Company</div>
                  </div>
                  <div>
                    <div className="label mb-1">KEY SUB-WEBS</div>
                    <div className="text-white/80">Robotaxi/FSD • Optimus • Tesla Energy • Tesla Semi • AI5/AI6 silicon • Starlink • Starship • Starshield • Project Celestia (orbital DCs) • Colossus 1 + 2 • Grok 4.3 • Grok Imagine + Voice • Vegas / Music City / Dubai Loops • Neuralink Telepathy + Blindsight + VOICE + R1 • X Ads + Premium + Money + TV</div>
                  </div>
                  <div>
                    <div className="label mb-1">NOTABLE EXTERNAL WEAVES</div>
                    <div className="text-white/80">NASA (Dragon + Artemis HLS) • Anthropic ($1.25B/mo Colossus lease) • US Space Force (NSSL + Starshield + MILNET) • T-Mobile (Starlink D2C) • Cursor ($60B acq option) • Miami Project / Barrow (Neuralink PRIME sites) • Global Starlink customers</div>
                  </div>
                </div>

                <NodeBrowser
                  nodes={visibleNodes}
                  selectedId={selectedId}
                  onSelect={flyToNode}
                  className="mt-6 lg:hidden"
                  label="Browse visible nodes"
                />

                <button type="button" onClick={() => handleSelect(INITIAL_FOCUS)} className="btn btn-primary mt-8 w-full">
                  BEGIN WITH TESLA — THE CENTRAL NODE
                </button>

                <div className="mt-4 text-center text-xs text-white/30">
                  Click any glowing node in the constellation to dive deeper.
                </div>
              </motion.main>
            )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setShowDesktopPanel(v => !v)}
          className={`ui-layer desktop-panel-toggle hidden lg:flex ${showDesktopPanel ? 'desktop-panel-toggle--open' : ''}`}
          aria-controls="main-content"
          aria-expanded={showDesktopPanel}
          aria-label={showDesktopPanel ? 'Hide details panel' : 'Show details panel'}
          title={showDesktopPanel ? 'Hide details panel' : 'Show details panel'}
        >
          {showDesktopPanel ? (
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        <AnimatePresence>
          {showLegend && (
            <motion.aside
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              aria-label="Legend"
              className="ui-layer legend-panel glass panel rounded-xl p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-mono text-[10px] font-normal tracking-[1.5px] text-white/60">LEGEND</h2>
                <button
                  type="button"
                  onClick={() => setShowLegend(false)}
                  className="text-white/40 hover:text-white"
                  aria-label="Close legend"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[1.5px] text-white/45">Shapes</div>
                  <div className="legend-item">
                    <span className="legend-shape legend-shape--core" />
                    <span>Core company</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-shape legend-shape--sub" />
                    <span>Sub-web / division</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-shape legend-shape--external" />
                    <span>External partner</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[1.5px] text-white/45">Companies</div>
                  <div className="grid grid-cols-2 gap-x-2">
                    {Object.entries(GROUP_COLORS).slice(0, 6).map(([key, color]) => (
                      <div key={key} className="legend-item">
                        <div className="dot" style={{ backgroundColor: color }} />
                        <span className="capitalize">{key}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[1.5px] text-white/45">Link types</div>
                  <div className="grid grid-cols-1 gap-x-2 lg:grid-cols-2">
                    {Object.entries(LINK_COLORS).map(([type, color]) => (
                      <div key={type} className="legend-item">
                        <div className="h-px w-4 flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="truncate">{LINK_LABELS[type as keyof typeof LINK_LABELS]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-snug text-white/45">
                Orb size scales with valuation. Cores glow; subs are solid moons; externals are faceted gems.
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className={`ui-layer keyboard-hints hidden text-xs text-white/40 md:block ${panelOpen ? 'keyboard-hints--offset' : ''}`}>
          W/S — up/down &nbsp;•&nbsp; A/D — orbit &nbsp;•&nbsp; Q/E — zoom &nbsp;•&nbsp; Arrows — pan &nbsp;•&nbsp; R — reset &nbsp;•&nbsp; ESC — deselect / clear &nbsp;•&nbsp; Drag nodes to rearrange
        </div>

        <GlobalKeys onReset={resetView} onEscape={handleEscape} />
      </div>
    </MotionConfig>
  )
}

function GlobalKeys({ onReset, onEscape }: { onReset: () => void; onEscape: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        onReset()
      }
      if (e.key === 'Escape') {
        onEscape()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onReset, onEscape])
  return null
}
