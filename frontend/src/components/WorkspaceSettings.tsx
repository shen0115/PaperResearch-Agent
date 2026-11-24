import { useEffect, useRef } from 'react'
import type { ModelSettings } from '../types'
import ModelSettingsDialog from './ModelSettingsDialog'

export default function WorkspaceSettings({ dark, onToggleTheme, health, onSaveModel }: {
  dark: boolean
  onToggleTheme: () => void
  health: boolean | null
  onSaveModel: (settings: ModelSettings) => void
}) {
  const settings = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const panel = settings.current
      if (panel?.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  return (
    <details ref={settings} className="workspace-settings" onKeyDown={event => {
      const container = event.currentTarget
      if (event.key !== 'Escape' || !container.open || container.querySelector('dialog[open]')) return
      event.preventDefault()
      container.open = false
      container.querySelector('summary')?.focus()
    }}>
      <summary><span aria-hidden="true">⚙</span> 设置</summary>
      <div className="workspace-settings-menu">
        <ModelSettingsDialog onSave={onSaveModel} />
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          {dark ? '切换到浅色模式' : '切换到深色模式'}
        </button>
        <div className="workspace-service-status">
          <span data-health={health === null ? 'connecting' : health ? 'online' : 'offline'}>
            {health === null ? '正在检查服务' : health ? '服务正常' : '服务离线'}
          </span>
        </div>
      </div>
    </details>
  )
}
