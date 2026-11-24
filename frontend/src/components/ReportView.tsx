// 报告展示组件：用 react-markdown 渲染 Markdown 报告
import ReactMarkdown from 'react-markdown'
import { memo, useMemo, useState } from 'react'
import type { FinalReport } from '../types'
import reportNavigation from '../reportNavigation'
import { formatReportText } from '../reportText'
import PaperStill from './PaperStill'

const ReportMarkdown = memo(function ReportMarkdown({ markdown, taskId, result }: {
  markdown: string
  taskId?: string | null
  result?: FinalReport
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown rehypePlugins={[[reportNavigation, result?.innovations ?? []]]} components={{
        header: ({ node: _node, children, ...props }) => (
          <header {...props}>
            {children}
            <ReportActions markdown={markdown} taskId={taskId} />
          </header>
        ),
        a: ({ node: _node, href, ...props }) => {
          const newTab = Boolean(href && !href.startsWith('#'))
          return <a {...props} href={href} target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noopener noreferrer' : undefined}
            onClick={event => {
              const menu = event.currentTarget.closest<HTMLDetailsElement>('.report-toc details')
              if (menu) {
                menu.open = false
                menu.querySelector('summary')?.focus({ preventScroll: true })
              }
            }} />
        },
      }}>{markdown}</ReactMarkdown>
    </div>
  )
})

interface ReportViewProps {
  /** Markdown 字符串 */
  markdown: string
  taskId?: string | null
  pendingMessage?: string
  error?: string
  onShowProgress?: () => void
  result?: FinalReport
}

function ReportActions({ markdown, taskId }: { markdown: string; taskId?: string | null }) {
  const [copyStatus, setCopyStatus] = useState('')

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopyStatus('全文已复制')
    } catch {
      setCopyStatus('复制失败，请下载 Markdown 后复制')
    }
  }

  function downloadMarkdown() {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `PaperMind-${taskId || 'report'}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="report-actions">
      <button type="button" className="btn btn-secondary" onClick={() => void copyReport()}>复制全文</button>
      <details className="export-menu">
        <summary className="btn btn-secondary">导出报告 <span aria-hidden>↓</span></summary>
        <div className="export-options">
          <button type="button" onClick={downloadMarkdown}>下载 Markdown</button>
          {taskId && <a href={`/api/report/${encodeURIComponent(taskId)}/pdf`} download>下载 PDF</a>}
        </div>
      </details>
      <span role="status" className="report-copy-status">{copyStatus}</span>
    </div>
  )
}

export default function ReportView({
  markdown: sourceMarkdown, taskId, pendingMessage, error, onShowProgress, result,
}: ReportViewProps) {
  const markdown = useMemo(() => formatReportText(sourceMarkdown), [sourceMarkdown])
  if (pendingMessage || error) {
    return (
      <div className="report-empty">
        <div className="loading-overlay" role={error ? 'alert' : 'status'}>
          {pendingMessage && <span className="spinner" aria-hidden />}
          <span>{pendingMessage || error}</span>
        </div>
        {onShowProgress && <button type="button" className="btn btn-secondary" onClick={onShowProgress}>查看分析进度</button>}
      </div>
    )
  }

  if (!markdown || !markdown.trim()) {
    return (
      <div className="report-welcome">
        <div className="report-welcome-copy">
          <span className="workspace-kicker">阅读 · 发现 · 探索</span>
          <h2>从一篇论文，<br />到新的研究方向。</h2>
          <p>选择文献，梳理研究空白。<br />让创新思路与实验方案，在这里逐渐清晰。</p>
          <div className="welcome-route"><span><b>01</b> 添加文献</span><i>→</i><span><b>02</b> 设定方向</span><i>→</i><span><b>03</b> 开始探索</span></div>
        </div>
        <PaperStill />
      </div>
    )
  }

  return <ReportMarkdown markdown={markdown} taskId={taskId} result={result} />
}
