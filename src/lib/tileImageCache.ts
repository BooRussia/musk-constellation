// ============================================
// Shared tile image cache — warm XYZ imagery
// ============================================
// Preloads Esri slippy-map tiles into decoded HTMLImageElements so
// DetailTiles can build Three textures instantly on zoom-in. Concurrent
// queue + LRU keep network and memory sane; browser HTTP cache still
// helps for tiles we evict from the decoded pool.

import { TILE_PROVIDERS, type TileProvider } from './tiles'

const MAX_CONCURRENT = 10
/** Soft cap on decoded images retained in memory. */
const MAX_IMAGES = 2800
/** Global warm levels when Preload Earth runs (z4→z5→z6). */
export const PRELOAD_ZOOM_LEVELS = [4, 5, 6] as const
export type PreloadZoom = (typeof PRELOAD_ZOOM_LEVELS)[number]

export interface TilePreloadProgress {
  provider: TileProvider
  /** Zoom currently being filled, or null when idle/done. */
  zoom: number | null
  done: number
  total: number
  /** 0–1 across the whole job (all zoom levels). */
  fraction: number
  running: boolean
  cancelled: boolean
  complete: boolean
}

type ProgressListener = (p: TilePreloadProgress) => void

interface CacheEntry {
  key: string
  img: HTMLImageElement
  lastUsed: number
}

interface QueueItem {
  key: string
  provider: TileProvider
  z: number
  x: number
  y: number
  resolve: (img: HTMLImageElement | null) => void
  /** Higher = sooner (global preload uses low priority). */
  priority: number
}

function tileKey(provider: TileProvider, z: number, x: number, y: number): string {
  return `${provider}/${z}/${x}/${y}`
}

function isConstrainedNetwork(): boolean {
  try {
    const c = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }).connection
    if (!c) return false
    if (c.saveData) return true
    const t = c.effectiveType
    return t === 'slow-2g' || t === '2g' || t === '3g'
  } catch {
    return false
  }
}

function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches
}

/** Zoom levels for a full-Earth warm pass (drops z6 on constrained clients). */
export function defaultPreloadZooms(): PreloadZoom[] {
  if (isConstrainedNetwork() || isMobileLike()) return [4, 5]
  return [4, 5, 6]
}

class TileImageCache {
  private images = new Map<string, CacheEntry>()
  private inflight = new Map<string, Promise<HTMLImageElement | null>>()
  private queue: QueueItem[] = []
  private active = 0
  private clock = 0

  private jobId = 0
  private progress: TilePreloadProgress = {
    provider: 'satellite',
    zoom: null,
    done: 0,
    total: 0,
    fraction: 0,
    running: false,
    cancelled: false,
    complete: false,
  }
  private listeners = new Set<ProgressListener>()

  has(provider: TileProvider, z: number, x: number, y: number): boolean {
    return this.images.has(tileKey(provider, z, x, y))
  }

  get(provider: TileProvider, z: number, x: number, y: number): HTMLImageElement | null {
    const key = tileKey(provider, z, x, y)
    const e = this.images.get(key)
    if (!e) return null
    e.lastUsed = ++this.clock
    return e.img
  }

  subscribe(fn: ProgressListener): () => void {
    this.listeners.add(fn)
    fn(this.progress)
    return () => this.listeners.delete(fn)
  }

  getProgress(): TilePreloadProgress {
    return this.progress
  }

  /** Queue a single tile. Returns the image when ready (or null on failure). */
  preload(
    provider: TileProvider,
    z: number,
    x: number,
    y: number,
    priority = 0,
  ): Promise<HTMLImageElement | null> {
    const key = tileKey(provider, z, x, y)
    const hit = this.images.get(key)
    if (hit) {
      hit.lastUsed = ++this.clock
      return Promise.resolve(hit.img)
    }
    const existing = this.inflight.get(key)
    if (existing) return existing

    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      this.queue.push({ key, provider, z, x, y, resolve, priority })
      // Higher priority first; stable for equal priority.
      this.queue.sort((a, b) => b.priority - a.priority)
      this.pump()
    })
    this.inflight.set(key, promise)
    void promise.finally(() => {
      this.inflight.delete(key)
    })
    return promise
  }

  /** Prefetch without awaiting — used by DetailTiles look-ahead. */
  softPreload(
    provider: TileProvider,
    z: number,
    x: number,
    y: number,
    priority = 1,
  ): void {
    void this.preload(provider, z, x, y, priority)
  }

  /**
   * Warm every tile at a zoom level for the provider (full Earth).
   * Cancels any in-flight global job first.
   */
  async preloadAll(
    provider: TileProvider,
    zooms: readonly number[] = defaultPreloadZooms(),
  ): Promise<void> {
    this.cancel()
    const id = ++this.jobId
    const levels = zooms.filter((z) => z >= 0 && z <= 20)
    let total = 0
    for (const z of levels) total += 2 ** z * 2 ** z

    this.setProgress({
      provider,
      zoom: levels[0] ?? null,
      done: 0,
      total,
      fraction: 0,
      running: true,
      cancelled: false,
      complete: false,
    })

    let done = 0
    for (const z of levels) {
      if (id !== this.jobId) return
      this.setProgress({
        ...this.progress,
        zoom: z,
        done,
        total,
        fraction: total > 0 ? done / total : 1,
        running: true,
      })

      const n = 2 ** z
      const batch: Promise<unknown>[] = []
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (id !== this.jobId) return
          batch.push(
            this.preload(provider, z, x, y, -z).then(() => {
              if (id !== this.jobId) return
              done++
              // Throttle UI updates — every 16 tiles or at boundaries.
              if (done % 16 === 0 || done === total) {
                this.setProgress({
                  ...this.progress,
                  provider,
                  zoom: z,
                  done,
                  total,
                  fraction: total > 0 ? done / total : 1,
                  running: true,
                  cancelled: false,
                  complete: false,
                })
              }
            }),
          )
          // Don't enqueue the entire planet as Promise objects at once for z6.
          if (batch.length >= 64) {
            await Promise.all(batch)
            batch.length = 0
            if (id !== this.jobId) return
          }
        }
      }
      if (batch.length) await Promise.all(batch)
      if (id !== this.jobId) return
    }

    if (id !== this.jobId) return
    this.setProgress({
      provider,
      zoom: null,
      done: total,
      total,
      fraction: 1,
      running: false,
      cancelled: false,
      complete: true,
    })
  }

  /** Abort the global preload job (in-flight HTTP requests still finish). */
  cancel(): void {
    if (!this.progress.running && this.jobId === 0) return
    this.jobId++
    // Drop low-priority queued items from a cancelled global warm.
    this.queue = this.queue.filter((q) => q.priority > 0)
    if (this.progress.running) {
      this.setProgress({
        ...this.progress,
        running: false,
        cancelled: true,
        complete: false,
        zoom: null,
      })
    }
  }

  private setProgress(p: TilePreloadProgress): void {
    this.progress = p
    for (const fn of this.listeners) fn(p)
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const item = this.queue.shift()!
      // Another waiter's promise may have already populated the cache.
      const hit = this.images.get(item.key)
      if (hit) {
        hit.lastUsed = ++this.clock
        item.resolve(hit.img)
        continue
      }
      this.active++
      void this.loadImage(item)
        .then((img) => {
          item.resolve(img)
        })
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }

  private loadImage(item: QueueItem): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const url = TILE_PROVIDERS[item.provider].url(item.z, item.x, item.y)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.onload = () => {
        this.remember(item.key, img)
        resolve(img)
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  private remember(key: string, img: HTMLImageElement): void {
    if (this.images.has(key)) {
      const e = this.images.get(key)!
      e.img = img
      e.lastUsed = ++this.clock
      return
    }
    this.images.set(key, { key, img, lastUsed: ++this.clock })
    this.evictIfNeeded()
  }

  private evictIfNeeded(): void {
    if (this.images.size <= MAX_IMAGES) return
    const entries = [...this.images.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    const drop = this.images.size - MAX_IMAGES
    for (let i = 0; i < drop; i++) {
      this.images.delete(entries[i].key)
    }
  }
}

/** Process-wide singleton — shared by DetailTiles + Visuals preload UI. */
export const tileImageCache = new TileImageCache()
