import { useCallback, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

export function useReportScroll(visibleReportId: string | null, containerRef: RefObject<HTMLDivElement>) {
  const positions = useRef(new Map<string, { page: number; panel: number }>())
  const remember = useCallback(() => {
    if (visibleReportId) positions.current.set(visibleReportId, {
      page: window.scrollY,
      panel: containerRef.current?.scrollTop ?? 0,
    })
  }, [visibleReportId, containerRef])

  useLayoutEffect(() => {
    if (!visibleReportId) return
    const container = containerRef.current
    const previous = positions.current.get(visibleReportId)
    if (previous !== undefined) window.scrollTo({ top: previous.page, behavior: 'instant' })
    container?.scrollTo({ top: previous?.panel ?? 0, behavior: 'instant' })
    window.addEventListener('scroll', remember, { passive: true })
    container?.addEventListener('scroll', remember, { passive: true })
    return () => {
      window.removeEventListener('scroll', remember)
      container?.removeEventListener('scroll', remember)
    }
  }, [visibleReportId, remember, containerRef])

  const forget = useCallback((reportId: string) => positions.current.delete(reportId), [])
  return { remember, forget }
}
