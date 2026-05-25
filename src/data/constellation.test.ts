import { describe, it, expect } from 'vitest'
import {
  NODES,
  LINKS,
  getNodeById,
  getChildren,
  getNodeLinks,
  getConnectedIds,
  getVisibleNodes,
  getVisibleLinks,
} from './constellation'

describe('constellation data', () => {
  describe('getNodeById', () => {
    it('returns a node for a valid id', () => {
      expect(getNodeById('tesla')?.label).toBe('Tesla')
    })

    it('returns undefined for an unknown id', () => {
      expect(getNodeById('nonexistent')).toBeUndefined()
    })
  })

  describe('getChildren', () => {
    it('returns child nodes for a parent with children', () => {
      const children = getChildren('tesla')
      expect(children.map(c => c.id)).toEqual(
        expect.arrayContaining(['tesla-energy', 'tesla-autonomy', 'tesla-optimus']),
      )
      expect(children).toHaveLength(3)
    })

    it('returns empty array for nodes without children', () => {
      expect(getChildren('neuralink')).toEqual([])
    })

    it('returns empty array for unknown id', () => {
      expect(getChildren('missing')).toEqual([])
    })
  })

  describe('getNodeLinks', () => {
    it('returns links in both directions', () => {
      const links = getNodeLinks('tesla-energy')
      expect(links.some(l => l.source === 'tesla' && l.target === 'tesla-energy')).toBe(true)
      expect(links.some(l => l.source === 'tesla-energy' && l.target === 'xai-colossus')).toBe(true)
    })

    it('returns empty array for unknown id', () => {
      expect(getNodeLinks('missing')).toEqual([])
    })
  })

  describe('getConnectedIds', () => {
    it('returns neighbor ids for a node', () => {
      const connected = getConnectedIds('xai')
      expect(connected).toContain('xai-colossus')
      expect(connected).toContain('xai-grok')
      expect(connected).toContain('x')
    })
  })

  describe('link validation', () => {
    it('every link source and target references a real node', () => {
      for (const link of LINKS) {
        expect(getNodeById(link.source), `source "${link.source}"`).toBeDefined()
        expect(getNodeById(link.target), `target "${link.target}"`).toBeDefined()
      }
    })

    it('includes the global-customers link from starlink', () => {
      const link = LINKS.find(
        l => l.source === 'spacex-starlink' && l.target === 'global-customers',
      )
      expect(link).toBeDefined()
      expect(link?.type).toBe('partners')
    })

    it('has no dangling external target ids', () => {
      const invalidTargets = LINKS.filter(l => !getNodeById(l.target)).map(l => l.target)
      expect(invalidTargets).toEqual([])
    })
  })

  describe('children and assist refs', () => {
    it('every child id references a real node', () => {
      for (const node of NODES) {
        for (const childId of node.children ?? []) {
          expect(getNodeById(childId), `${node.id} → ${childId}`).toBeDefined()
        }
      }
    })

    it('every assist target references a real node', () => {
      for (const node of NODES) {
        for (const assist of node.assists ?? []) {
          expect(getNodeById(assist.target), `${node.id} assist → ${assist.target}`).toBeDefined()
        }
      }
    })
  })

  describe('getVisibleNodes', () => {
    it('returns only core and external nodes when nothing is expanded', () => {
      const visible = getVisibleNodes([])
      const ids = visible.map(n => n.id)
      expect(ids).toContain('tesla')
      expect(ids).toContain('nasa')
      expect(ids).toContain('global-customers')
      expect(ids).not.toContain('tesla-energy')
      expect(ids).not.toContain('spacex-starlink')
      expect(visible.every(n => n.type !== 'sub')).toBe(true)
    })

    it('includes expanded children without duplicating base nodes', () => {
      const visible = getVisibleNodes(['tesla'])
      const ids = visible.map(n => n.id)
      expect(ids).toContain('tesla-energy')
      expect(ids).toContain('tesla-autonomy')
      expect(ids).toContain('tesla-optimus')
      expect(ids.filter(id => id === 'tesla')).toHaveLength(1)
    })

    it('includes starlink when spacex is expanded', () => {
      const visible = getVisibleNodes(['spacex'])
      const ids = visible.map(n => n.id)
      expect(ids).toContain('spacex-starlink')
      expect(ids).not.toContain('tesla-energy')
    })
  })

  describe('getVisibleLinks', () => {
    it('only returns links where both endpoints are visible', () => {
      const visible = getVisibleNodes(['spacex'])
      const links = getVisibleLinks(visible)
      expect(links.every(l => visible.some(n => n.id === l.source))).toBe(true)
      expect(links.every(l => visible.some(n => n.id === l.target))).toBe(true)
    })

    it('includes starlink → global-customers when spacex is expanded', () => {
      const visible = getVisibleNodes(['spacex'])
      const links = getVisibleLinks(visible)
      expect(
        links.some(l => l.source === 'spacex-starlink' && l.target === 'global-customers'),
      ).toBe(true)
    })
  })
})
