import { useRef } from 'react'
import type { PointerEvent } from 'react'

/** Decorative paper responds to a mouse without affecting touch scrolling. */
export default function PaperStill() {
  const frame = useRef<HTMLDivElement>(null)

  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const element = frame.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
    element.style.setProperty('--paper-tilt-x', `${-y * 20}deg`)
    element.style.setProperty('--paper-tilt-y', `${x * 25}deg`)
    element.style.setProperty('--paper-shine', `${x * 24}%`)
  }

  function reset() {
    frame.current?.style.setProperty('--paper-tilt-x', '0deg')
    frame.current?.style.setProperty('--paper-tilt-y', '0deg')
    frame.current?.style.setProperty('--paper-shine', '-24%')
  }

  return (
    <div ref={frame} className="research-still" aria-hidden onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset} onDragStart={event => event.preventDefault()}>
      <span className="research-ground-shadow" />
      <div className="research-paper-float"><div className="research-paper-scene">
        <div className="research-sheet research-sheet-back" />
        <div className="research-sheet research-sheet-middle" />
        <div className="research-sheet research-sheet-front"><span>PM / RESEARCH</span><strong>Ideas<br />begin here.</strong><div className="research-lines"><i /><i /><i /></div><small>文献与灵感之间</small></div>
        <span className="research-seal">PM</span>
      </div></div>
    </div>
  )
}
