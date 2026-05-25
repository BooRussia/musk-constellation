import React from 'react'
import { NODES, GROUP_COLORS } from '../data/constellation'
import type { Node } from '../data/constellation'

interface Props {
  children: React.ReactNode
  onSelect?: (id: string) => void
}

interface State {
  hasError: boolean
}

export default class WebGLErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('WebGL constellation failed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          id="constellation"
          className="flex flex-col overflow-y-auto bg-black p-6 md:p-10"
          role="alert"
        >
          <h2 className="mb-2 text-xl font-semibold text-white">3D view unavailable</h2>
          <p className="mb-6 max-w-lg text-sm text-white/60">
            WebGL could not initialize. Browse the empire nodes below or try a browser with
            hardware acceleration enabled.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {NODES.map((node: Node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => this.props.onSelect?.(node.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/3 px-3 py-2.5 text-left transition hover:border-white/25 hover:bg-white/5"
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: GROUP_COLORS[node.group] }}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block font-medium text-white/90">{node.label}</span>
                    <span className="block truncate text-xs text-white/50">{node.short}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )
    }

    return this.props.children
  }
}
