import { useLayoutEffect, useRef, useState } from 'react'

type TabKey = 'report' | 'evaluation' | 'progress'

interface Props {
  active: TabKey
  onChange: (tab: TabKey) => void
  progressEnabled: boolean
  evaluationCount?: number
  canFocus: boolean
  focused: boolean
  onToggleFocus: () => void
}

export default function WorkspaceTabs({ active, onChange, progressEnabled, evaluationCount, canFocus, focused, onToggleFocus }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const measure = () => {
      const button = element.querySelector<HTMLButtonElement>(`[data-view="${active}"]`)
      if (button) setIndicator({ left: button.offsetLeft, width: button.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, evaluationCount])

  return (
    <div className="tabs workspace-tabs">
      <div ref={list} className="workspace-tab-list" role="group" aria-label="分析视图">
        <span className="tab-highlight" aria-hidden style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
        <button className={`tab ${active === 'progress' ? 'active' : ''}`} data-view="progress" aria-pressed={active === 'progress'} disabled={!progressEnabled} onClick={() => onChange('progress')}>分析进度</button>
        <button className={`tab ${active === 'report' ? 'active' : ''}`} data-view="report" aria-pressed={active === 'report'} onClick={() => onChange('report')}>研究报告</button>
        <button className={`tab ${active === 'evaluation' ? 'active' : ''}`} data-view="evaluation" aria-pressed={active === 'evaluation'} onClick={() => onChange('evaluation')}>
          评估指标 {evaluationCount !== undefined && <span className="badge">{evaluationCount}</span>}
        </button>
      </div>
      {canFocus && <button className="reading-toggle" aria-pressed={focused} onClick={onToggleFocus}>{focused ? '退出专注阅读' : '专注阅读'}</button>}
    </div>
  )
}
