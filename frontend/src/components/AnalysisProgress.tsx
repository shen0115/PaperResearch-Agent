import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { STAGE_LIST } from '../types'
import type { ProgressEvent, StageKey, StepStatus } from '../types'
import ProgressBar from './ProgressBar'

export interface AnalysisIssue {
  kind: 'start' | 'task' | 'connection' | 'report'
  message: string
}

interface AnalysisProgressProps {
  eventsByStage: Record<StageKey, ProgressEvent | undefined>
  progress: number
  running: boolean
  reportLoading: boolean
  issue: AnalysisIssue | null
  onRetry: () => void
  cost?: ReactNode
  startedAt?: number | null
}

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: '等待进度',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  degraded: '降级完成',
  cached: '复用缓存',
}

const STATUS_ICON: Partial<Record<StepStatus, string>> = {
  done: '✓',
  failed: '×',
  degraded: '!',
  cached: '↻',
}

const RETRY_LABEL: Record<AnalysisIssue['kind'], string> = {
  start: '重新启动',
  task: '重新分析',
  connection: '重新连接',
  report: '重试获取报告',
}

const SWIPE_DISTANCE = 56
const PHASE_DESCRIPTIONS = [
  '读取论文内容，识别章节和段落。', '提取研究问题、方法和实验结果。',
  '整理检索索引，为后续分析查找证据。', '对比论文，寻找尚未解决的问题。',
  '结合研究方向提出创新思路。', '为创新思路设计可验证的实验方案。', '汇总研究报告与评估结果。',
]

interface Phase {
  index: number
  title: string
  description: string
  status: StepStatus
  message?: string
  issue: AnalysisIssue | null
}

function PhaseCard({ phase, onRetry }: { phase: Phase; onRetry?: () => void }) {
  return (
    <div className={`phase-card phase-card-${phase.status}`}>
      <div className="phase-card-header">
        <span className="phase-number">第 {phase.index + 1} 步</span>
        <span className="phase-status">
          <span className={STATUS_ICON[phase.status] ? 'phase-status-icon' : 'phase-status-dot'} aria-hidden>
            {STATUS_ICON[phase.status]}
          </span>
          {STATUS_LABEL[phase.status]}
        </span>
      </div>
      <div className="phase-card-content">
        <h3>{phase.title}</h3>
        <p>{PHASE_DESCRIPTIONS[phase.index]}</p>
        <details className="phase-technical"><summary>技术详情</summary><p>{phase.description}</p></details>
        {phase.message && <p className="phase-message">{phase.message}</p>}
        {phase.issue && (
          <div className="phase-issue">
            <p role={onRetry ? 'alert' : undefined}>{phase.issue.message}</p>
            {onRetry && (
              <button type="button" className="btn btn-secondary" onClick={onRetry}>
                {RETRY_LABEL[phase.issue.kind]}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AnalysisProgress({
  eventsByStage, progress, running, reportLoading, issue, onRetry, cost, startedAt,
}: AnalysisProgressProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [transition, setTransition] = useState<{ previous: Phase; direction: 'forward' | 'backward' } | null>(null)
  const previousPhase = useRef<Phase | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState(0)
  const [gestureIndex, setGestureIndex] = useState<number | null>(null)

  // The server can replay earlier events when the connection opens again.
  const liveIndex = Math.max(0, STAGE_LIST.reduce((latest, stage, index) => (
    eventsByStage[stage.key] ? index : latest
  ), -1))
  const index = gestureIndex ?? reviewIndex ?? liveIndex
  const stage = STAGE_LIST[index]
  const event = eventsByStage[stage.key]
  const visibleIssue = index === liveIndex ? issue : null
  const waitingForReport = index === liveIndex && (
    reportLoading || (running && index === STAGE_LIST.length - 1 && event?.status === 'done')
  )
  const phase: Phase = {
    index,
    title: stage.label,
    description: stage.description,
    status: visibleIssue?.kind === 'task' || visibleIssue?.kind === 'start' ? 'failed'
      : waitingForReport ? 'running' : event?.status ?? 'pending',
    message: waitingForReport ? '正在汇总研究报告与评估结果。' : event?.message,
    issue: visibleIssue,
  }
  const neighborIndex = drag < 0 ? index + 1 : index - 1
  const neighbor = drag && neighborIndex >= 0 && neighborIndex <= liveIndex ? STAGE_LIST[neighborIndex] : null
  const readyToSwitch = neighbor && Math.abs(drag) >= SWIPE_DISTANCE
  const dragHint = neighbor
    ? `${readyToSwitch ? '松开切换' : '继续拖动'} · 第 ${neighborIndex + 1} 步 ${neighbor.label}`
    : '按住卡片左右拖动'

  useEffect(() => { heading.current?.focus() }, [])

  useLayoutEffect(() => {
    if (issue?.kind === 'task') setReviewIndex(null)
  }, [issue])

  useLayoutEffect(() => {
    const previous = previousPhase.current
    if (previous && previous.index !== phase.index) {
      setTransition({ previous, direction: phase.index > previous.index ? 'forward' : 'backward' })
    }
    previousPhase.current = phase
  })

  function goTo(target: number) {
    if (target < 0 || target > liveIndex) return
    setReviewIndex(target === liveIndex ? null : target)
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button, a')) return
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    setGestureIndex(index)
    setTransition(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.pointerType === 'mouse') event.preventDefault()
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current
    if (!start || start.id !== event.pointerId) return
    const distance = event.clientX - start.x
    if (Math.abs(distance) < Math.abs(event.clientY - start.y)) {
      setDrag(0)
      return
    }
    const canMove = distance < 0 ? index < liveIndex : index > 0
    const limit = Math.min(event.currentTarget.clientWidth * 0.43, 230)
    setDrag(Math.max(-limit, Math.min(limit, distance * (canMove ? 1 : 0.18))))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = pointer.current
    if (!start || start.id !== event.pointerId) return
    pointer.current = null
    setDrag(0)
    setGestureIndex(null)
    const distance = event.clientX - start.x
    if (!cancelled && Math.abs(distance) >= SWIPE_DISTANCE && Math.abs(distance) > Math.abs(event.clientY - start.y)) {
      goTo(index + (distance < 0 ? 1 : -1))
    }
  }

  return (
    <section className="analysis-progress" aria-labelledby="analysis-progress-title">
      <header className="analysis-progress-header">
        <h2 id="analysis-progress-title" ref={heading} tabIndex={-1}>分析进度</h2>
        <span>第 {liveIndex + 1} 步 / 共 {STAGE_LIST.length} 步</span>
      </header>
      <ProgressBar progress={progress} active={running && !issue} />
      <ol className="phase-overview" aria-label="分析阶段总览">{STAGE_LIST.map((item, step) => {
        const status = eventsByStage[item.key]?.status ?? 'pending'
        return <li key={item.key}><button type="button" disabled={step > liveIndex} aria-current={step === index ? 'step' : undefined}
          className={`phase-step phase-step-${status}`} onClick={() => goTo(step)}>
          <span>{status === 'done' || status === 'cached' ? '✓' : step + 1}</span><strong>{item.label}</strong>
          <small>{STATUS_LABEL[status]}</small>
        </button></li>
      })}</ol>
      {running && startedAt && <p className="elapsed-time">已等待 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒 · 分析耗时取决于论文数量与模型响应</p>}
      <div className="phase-controls">
        <div className="run-cost">{cost}</div>
        <button type="button" className="phase-follow" disabled={reviewIndex === null} onClick={() => setReviewIndex(null)}>
          {reviewIndex === null ? '跟随当前进度' : '回到当前进度'}
        </button>
      </div>
      <div className={`phase-drag-hint${readyToSwitch ? ' phase-drag-ready' : ''}`} aria-hidden>
        <span>↔</span> {dragHint}
      </div>
      <div className="phase-carousel">
        <button type="button" className="phase-arrow" aria-label="上一步" disabled={index === 0} onClick={() => goTo(index - 1)}>‹</button>
        <div className={`phase-deck phase-deck-${transition?.direction ?? 'forward'}${gestureIndex !== null ? ' phase-deck-dragging' : ''}`}
          role="group" aria-label="阶段卡片，可拖动或用左右方向键切换" tabIndex={0}
          onPointerDown={beginDrag} onPointerMove={moveDrag}
          onPointerUp={endDrag} onPointerCancel={event => endDrag(event, true)}
          onLostPointerCapture={event => endDrag(event, true)}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              goTo(index + (event.key === 'ArrowLeft' ? -1 : 1))
            }
          }}
        >
          {neighbor && (
            <div className={`phase-preview ${drag < 0 ? 'phase-preview-next' : 'phase-preview-previous'}${readyToSwitch ? ' phase-preview-ready' : ''}`} aria-hidden>
              <span>第 {neighborIndex + 1} 步</span>
              <strong>{neighbor.label}</strong>
            </div>
          )}
          {transition && (
            <div key={`out-${transition.previous.index}`} className="phase-slide phase-exit" aria-hidden>
              <PhaseCard phase={transition.previous} />
            </div>
          )}
          <div
            key={`in-${index}`}
            className={`phase-slide${transition ? ' phase-enter' : ''}`}
            style={drag ? { translate: `${drag}px -6px`, rotate: `${drag / 34}deg`, scale: 0.97 } : undefined}
            onAnimationEnd={() => setTransition(null)}
          >
            <PhaseCard phase={phase} onRetry={onRetry} />
          </div>
        </div>
        <button type="button" className="phase-arrow" aria-label="下一步" disabled={index >= liveIndex} onClick={() => goTo(index + 1)}>›</button>
      </div>
      <p className="sr-only" role="status">
        第 {index + 1} 步，{stage.label}，{STATUS_LABEL[phase.status]}
      </p>
    </section>
  )
}
