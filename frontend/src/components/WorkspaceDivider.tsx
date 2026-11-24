import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

const WIDTH_KEY = 'papermind-workspace-sidebar-width'
const MIN_WIDTH = 248
const MAX_WIDTH = 480

function loadWidth() {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : null
  } catch {
    return null
  }
}

function saveWidth(width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(WIDTH_KEY)
    else window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // Resizing still works for the current page when storage is unavailable.
  }
}

export default function WorkspaceDivider() {
  const divider = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; previous: number | null } | null>(null)
  const [preferredWidth, setPreferredWidth] = useState(loadWidth)
  const [frameWidth, setFrameWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(frameWidth * .43), frameWidth - 490))
  const defaultWidth = Math.max(MIN_WIDTH, Math.min(304, Math.round(frameWidth * .22)))
  const width = Math.min(maxWidth, preferredWidth ?? defaultWidth)

  useLayoutEffect(() => {
    const frame = divider.current?.parentElement
    if (!frame) return
    const measure = () => setFrameWidth(frame.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const frame = divider.current?.parentElement
    if (!frame) return
    if (preferredWidth === null) frame.style.removeProperty('--workspace-sidebar-preference')
    else frame.style.setProperty('--workspace-sidebar-preference', `${preferredWidth}px`)
    return () => { frame.style.removeProperty('--workspace-sidebar-preference') }
  }, [preferredWidth])

  function clampWidth(value: number) {
    return Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(value)))
  }

  function commitWidth(value: number | null) {
    setPreferredWidth(value)
    saveWidth(value)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, previous: preferredWidth }
    setDragging(true)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (active?.pointerId === event.pointerId && event.clientX !== active.startX) {
      setPreferredWidth(clampWidth(active.startWidth + event.clientX - active.startX))
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current
    if (active?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    const delta = event.clientX - active.startX
    if (cancelled || delta === 0) setPreferredWidth(active.previous)
    else commitWidth(clampWidth(active.startWidth + delta))
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const sizes: Record<string, number | null> = {
      ArrowLeft: clampWidth(width - 16),
      ArrowRight: clampWidth(width + 16),
      Home: MIN_WIDTH,
      End: maxWidth,
      Enter: null,
    }
    if (!Object.prototype.hasOwnProperty.call(sizes, event.key)) return
    event.preventDefault()
    commitWidth(sizes[event.key])
  }

  return (
    <div ref={divider} className="workspace-divider" role="separator" tabIndex={0}
      aria-label="调整论文库宽度" aria-controls="workspace-library" aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width} 像素`}
      data-dragging={dragging || undefined} title="拖动调整宽度，双击恢复默认"
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}
      onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}
      onDoubleClick={() => commitWidth(null)} onKeyDown={resizeWithKeyboard} />
  )
}
