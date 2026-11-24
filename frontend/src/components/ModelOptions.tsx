import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ReasoningEffort } from '../types'

export default function ModelOptions({
  model, models, efforts = [], effort, disabled, onOpen, onModelChange, onEffortChange, status, label, note,
}: {
  model: string
  models: string[]
  efforts?: ReasoningEffort[]
  effort?: ReasoningEffort
  disabled: boolean
  onOpen?: () => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: ReasoningEffort) => void
  status?: ReactNode
  label: string
  note?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const expanded = open && !disabled
  const index = Math.max(0, efforts.indexOf(effort ?? 'high'))
  const currentEffort = efforts[index]
  const hasSlider = efforts.length > 1
  const selectingModel = showModels || !hasSlider

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!expanded) return
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div className="model-options" ref={root}
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !expanded) return
        event.preventDefault()
        close()
      }}>
      <button type="button" className="model-options-trigger" ref={trigger} disabled={disabled}
        aria-label={`${label}：${model || '选择模型'}${hasSlider ? `，推理强度 ${currentEffort}` : ''}`}
        aria-expanded={expanded} title={model}
        onClick={() => {
          setOpen(!expanded)
          setShowModels(false)
          if (!expanded) onOpen?.()
        }}>
        <span className="model-option-name">{model || '选择模型'}</span>
        {hasSlider && <span className="model-effort-value">{currentEffort}</span>}
      </button>
      {expanded && (
        <div className="model-options-popover" aria-label={label}>
          {hasSlider && (
            <button type="button" className="model-options-switch" onClick={() => setShowModels(!showModels)}>
              {selectingModel ? '‹ 返回推理强度' : '切换模型 ›'}
            </button>
          )}
          {selectingModel ? (
            <div className="model-options-list" key="models">
              {[...new Set([model, ...models].filter(Boolean))].map(name => (
                <button type="button" key={name} aria-pressed={name === model} title={name}
                  onClick={() => { onModelChange(name); close() }}>
                  <span>{name}</span>{name === model && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              {status}
            </div>
          ) : (
            <div className="model-effort" key="effort">
              <div className="model-effort-heading"><span>推理强度</span><strong>{currentEffort}</strong></div>
              <div className="model-effort-slider" style={{ '--effort-position': `${100 * index / (efforts.length - 1)}%` } as CSSProperties}>
                <div className="model-effort-track" aria-hidden="true">
                  <span className="model-effort-fill" />
                  <span className="model-effort-ticks">{efforts.map(value => <i key={value} />)}</span>
                  <span className="model-effort-thumb" />
                </div>
                <input type="range" min={0} max={efforts.length - 1} step={1} value={index}
                  aria-label="推理强度" aria-valuetext={currentEffort}
                  onChange={event => onEffortChange(efforts[event.currentTarget.valueAsNumber])} />
              </div>
              <div className="model-effort-tick-labels" aria-hidden="true">
                {efforts.map(value => <span key={value} data-current={value === currentEffort}>{value}</span>)}
              </div>
              {note && <p>{note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
