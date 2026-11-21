// 报告展示组件：用 react-markdown 渲染 Markdown 报告
import ReactMarkdown from 'react-markdown'
import { memo, useEffect, useMemo, useState } from 'react'
import type { FinalReport, ModelUsage } from '../types'
import { CostLabel } from './HistoryPanel'
import reportNavigation from '../reportNavigation'
import { formatReportText } from '../reportText'
import PaperStill from './PaperStill'

const ReportMarkdown = memo(function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown rehypePlugins={[reportNavigation]} components={{
        a: ({ node: _node, href, ...props }) => {
          const newTab = Boolean(href && !href.startsWith('#'))
          return <a {...props} href={href} target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noopener noreferrer' : undefined} />
        },
      }}>{markdown}</ReactMarkdown>
    </div>
  )
})

interface ReportViewProps {
  /** Markdown 字符串 */
  markdown: string
  taskId?: string | null
  model?: string
  usage?: ModelUsage | null
  pendingMessage?: string
  error?: string
  onShowProgress?: () => void
  result?: FinalReport
  onShowEvaluation?: () => void
}

export default function ReportView({
  markdown: sourceMarkdown, taskId, model, usage, pendingMessage, error, onShowProgress, result, onShowEvaluation,
}: ReportViewProps) {
  const markdown = useMemo(() => formatReportText(sourceMarkdown), [sourceMarkdown])
  const [copyStatus, setCopyStatus] = useState('')
  const innovations = result?.innovations ?? []
  const experimentCount = result?.experiment_plans?.length ?? 0
  useEffect(() => { setCopyStatus('') }, [markdown])

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
    link.download = `PaperResearch-Agent-${taskId || 'report'}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
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

  return (
    <>
      <div className="report-toolbar">
        <div className="report-model-meta">
          <details className="report-runtime"><summary>{model || '研究报告'}<span>运行详情</span></summary><div><CostLabel usage={usage} /></div></details>
        </div>
        <div className="report-actions">
          <button className="btn btn-secondary" onClick={() => void copyReport()}>复制全文</button>
          <details className="export-menu"><summary className="btn btn-secondary">导出报告 <span aria-hidden>↓</span></summary><div className="export-options">
            <button onClick={downloadMarkdown}>下载 Markdown</button>
            {taskId && <a href={`/api/report/${encodeURIComponent(taskId)}/pdf`} download>下载 PDF</a>}
          </div></details>
        </div>
      </div>
      {copyStatus && <p role="status" className="report-copy-status">{copyStatus}</p>}
      {Boolean(innovations.length || experimentCount) && <section className="report-overview" aria-label="研究成果概览">
        <details className="overview-disclosure"><summary>
          <span className="overview-label">研究成果概览</span>
          <span className="overview-counts">
            {Boolean(innovations.length) && <span><strong>{innovations.length}</strong> 条创新点</span>}
            {Boolean(experimentCount) && <span><strong>{experimentCount}</strong> 项实验方案</span>}
          </span>
          <span className="overview-expand" aria-hidden />
        </summary>
        {Boolean(innovations.length) && <ol className="overview-innovations">{innovations.map((item, index) => <li key={`${item.title}-${index}`}>
          <span className="overview-index">{String(index + 1).padStart(2, '0')}</span>
          <div><h3>{item.title || `创新点 ${index + 1}`}</h3>
            {item.idea && <details><summary>查看思路</summary><p>{item.idea}</p></details>}
          </div>
        </li>)}</ol>}
        {onShowEvaluation && innovations.length > 0 && <button className="text-action" onClick={onShowEvaluation}>查看创新点评分与依据 →</button>}
        </details>
      </section>}
      <ReportMarkdown markdown={markdown} />
    </>
  )
}
