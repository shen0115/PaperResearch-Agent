import { Component } from 'react'
import type { ReactNode } from 'react'

export default class PanelErrorBoundary extends Component<{
  title: string
  children: ReactNode
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="report-empty">
        <div className="empty-title" role="alert">{this.props.title}暂时无法显示</div>
        <button type="button" className="btn btn-secondary" onClick={() => this.setState({ failed: false })}>
          重新显示
        </button>
      </div>
    )
  }
}
