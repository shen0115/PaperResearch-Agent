// Paper Innovation Agent - 主应用组件
// 状态管理 + 布局 + 交互流程
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { deleteHistory, deletePaper, getHealth, getHistory, getReport, listPapers, startAnalysis, subscribeProgress, uploadPaper } from './api'
import { STAGE_LIST } from './types'
import type { AnalyzeParams, Evaluation, HistoryEntry, Paper, ProgressEvent, Report, StageKey } from './types'
import AnalysisProgress from './components/AnalysisProgress'
import type { AnalysisIssue } from './components/AnalysisProgress'
import EvaluationPanel from './components/EvaluationPanel'
import ReportView from './components/ReportView'
import PaperLibrary from './components/PaperLibrary'
import ModelSettingsDialog from './components/ModelSettingsDialog'
import ModelPicker from './components/ModelPicker'
import HistoryPanel, { CostLabel } from './components/HistoryPanel'
import PanelErrorBoundary from './components/PanelErrorBoundary'
import { useReportScroll } from './useReportScroll'
import WorkspaceTabs from './components/WorkspaceTabs'

/** 初始化：所有阶段事件为空 */
function createEmptyEvents(): Record<StageKey, ProgressEvent | undefined> {
  const obj = {} as Record<StageKey, ProgressEvent | undefined>
  STAGE_LIST.forEach((s) => (obj[s.key] = undefined))
  return obj
}

type TabKey = 'report' | 'evaluation' | 'progress'
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'papermind-theme'

function getInitialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Local storage can be unavailable in private or embedded browsers.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const nextTheme = theme === 'light' ? 'dark' : 'light'

  function switchTheme() {
    setTheme(nextTheme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // The theme still applies for the current visit.
    }
  }

  // 输入与任务状态
  const [folderPath, setFolderPath] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)

  // 输入模式：上传论文 / 文件夹路径
  const [inputMode, setInputMode] = useState<'upload' | 'folder'>('upload')
  // 论文库列表与选中状态
  const [papers, setPapers] = useState<Paper[]>([])
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  // 研究方向（注入创新点生成提示词）
  const [researchDirection, setResearchDirection] = useState('')
  // 上传中状态
  const [uploading, setUploading] = useState(false)
  const uploadLock = useRef(false)
  const [uploadQueue, setUploadQueue] = useState<Array<{ name: string; status: 'waiting' | 'uploading' | 'done' | 'failed'; message?: string }>>([])
  const [papersLoading, setPapersLoading] = useState(true)
  const [papersError, setPapersError] = useState('')
  const papersRequest = useRef(0)
  const [focusReading, setFocusReading] = useState(false)

  // 进度与报告
  const [eventsByStage, setEventsByStage] = useState<Record<StageKey, ProgressEvent | undefined>>(
    createEmptyEvents,
  )
  const [overallProgress, setOverallProgress] = useState(0)
  const [runNumber, setRunNumber] = useState(0)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [analysisIssue, setAnalysisIssue] = useState<AnalysisIssue | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportId, setReportId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyReportError, setHistoryReportError] = useState('')
  const historyRequest = useRef(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyError, setHistoryError] = useState(false)
  const historyRefresh = useRef(0)

  // 错误与健康检查
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string>('deepseek-chat')
  const [modelRevision, setModelRevision] = useState(0)
  const [modelSaving, setModelSaving] = useState(false)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthRevision, setHealthRevision] = useState(0)

  // Tab 切换
  const [activeTab, setActiveTab] = useState<TabKey>('report')
  const reportContainerRef = useRef<HTMLDivElement>(null)
  const markdown = report?.markdown ?? report?.report?.markdown ?? ''
  const { remember: rememberReportScroll, forget: forgetReportScroll } = useReportScroll(
    activeTab === 'report' && markdown && !historyLoading && !reportLoading ? reportId : null,
    reportContainerRef,
  )

  function openTab(tab: TabKey) {
    if (tab === activeTab) return
    rememberReportScroll()
    setActiveTab(tab)
  }

  function toggleReading() {
    setFocusReading(value => !value)
    if (window.matchMedia('(max-width: 900px)').matches) {
      window.requestAnimationFrame(() => {
        reportContainerRef.current?.parentElement?.scrollIntoView({ block: 'start', behavior: 'instant' })
      })
    }
  }

  // EventSource 引用，便于卸载/重试时关闭
  const sourceRef = useRef<EventSource | null>(null)

  /** 关闭当前 SSE 订阅 */
  const closeSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
  }, [])

  /** 拉取论文库列表 */
  const refreshPapers = useCallback(async () => {
    const request = ++papersRequest.current
    setPapersLoading(true)
    setPapersError('')
    try {
      const { papers } = await listPapers()
      if (request !== papersRequest.current) return false
      setPapers(papers)
      setSelectedPaperIds(ids => new Set([...ids].filter(id => papers.some(paper => paper.paper_id === id))))
      return true
    } catch (err) {
      if (request === papersRequest.current) setPapersError(`论文库加载失败：${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      if (request === papersRequest.current) setPapersLoading(false)
    }
  }, [])

  /** 顺序上传，单篇失败不影响队列中的其他文件。 */
  const handleUpload = useCallback(async (files: File[]) => {
    if (uploadLock.current || !files.length) return
    uploadLock.current = true
    setUploading(true)
    setError(null)
    setUploadQueue(files.map(file => ({ name: file.name, status: 'waiting' })))
    const uploadedIds: string[] = []
    const update = (index: number, status: 'uploading' | 'done' | 'failed', message?: string) =>
      setUploadQueue(queue => queue.map((item, i) => i === index ? { ...item, status, message } : item))
    try {
      for (const [index, file] of files.entries()) {
        if (!/\.pdf$/i.test(file.name)) {
          update(index, 'failed', '请选择 PDF 文件')
          continue
        }
        update(index, 'uploading')
        try {
          const result = await uploadPaper(file)
          uploadedIds.push(result.paper_id)
          update(index, 'done', result.duplicate ? '论文已存在' : '上传成功')
        } catch (err) {
          update(index, 'failed', err instanceof Error ? err.message : String(err))
        }
      }
      if (uploadedIds.length) {
        const refreshed = await refreshPapers()
        if (refreshed) {
          setSelectedPaperIds(ids => new Set([...ids, ...uploadedIds]))
          setUploadQueue(queue => queue.map(item => item.status === 'done'
            ? { ...item, message: `${item.message}，已选中` } : item))
        }
        else setUploadQueue(queue => queue.map(item => item.status === 'done'
          ? { ...item, message: '上传成功，请刷新论文库后选择' } : item))
      }
    } finally {
      uploadLock.current = false
      setUploading(false)
    }
  }, [refreshPapers])

  /** 删除论文 */
  const handleDeletePaper = useCallback(async (paperId: string) => {
    await deletePaper(paperId)
    setPapers(papers => papers.filter(paper => paper.paper_id !== paperId))
    setSelectedPaperIds((prev) => {
      const next = new Set(prev)
      next.delete(paperId)
      return next
    })
  }, [])

  /** 切换论文选中状态 */
  const handleToggleSelect = useCallback((paperId: string) => {
    setSelectedPaperIds((prev) => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }, [])

  /** 健康检查：拉取后端模型信息 */
  useEffect(() => {
    let cancelled = false
    setHealthOk(null)
    getHealth()
      .then((info) => {
        if (cancelled) return
        setModel(info.model || 'deepseek-chat')
        setHealthOk(info.status === 'ok')
      })
      .catch(() => {
        if (!cancelled) setHealthOk(false)
      })
    return () => {
      cancelled = true
    }
  }, [healthRevision])

  /** 挂载时拉取论文库 */
  useEffect(() => {
    void refreshPapers()
  }, [refreshPapers])

  const refreshHistory = useCallback(async () => {
    const request = ++historyRefresh.current
    try {
      const { tasks } = await getHistory()
      if (request !== historyRefresh.current) return
      setHistory(tasks)
      setHistoryError(false)
    } catch {
      if (request === historyRefresh.current) setHistoryError(true)
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
    if (!running) return
    const timer = window.setInterval(() => void refreshHistory(), 3000)
    return () => window.clearInterval(timer)
  }, [refreshHistory, running, taskId])

  /** 卸载时关闭 SSE */
  useEffect(() => {
    return () => closeSource()
  }, [closeSource])

  /** 拉取最终报告 */
  const fetchReport = useCallback(async (id: string) => {
    historyRequest.current += 1
    setHistoryLoading(false)
    setHistoryReportError('')
    setReportLoading(true)
    try {
      const r = await getReport(id)
      const showReport = () => {
        setReport(r)
        setReportId(id)
        setReportLoading(false)
        setActiveTab('report')
      }
      if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const transition = document.startViewTransition(() => flushSync(showReport))
        await transition.updateCallbackDone
      } else {
        showReport()
      }
    } catch (err) {
      setAnalysisIssue({
        kind: 'report',
        message: `获取报告失败：${err instanceof Error ? err.message : String(err)}`,
      })
      setActiveTab('progress')
    } finally {
      setReportLoading(false)
    }
  }, [])

  async function openHistory(id: string) {
    rememberReportScroll()
    const request = ++historyRequest.current
    setHistoryLoading(true)
    setHistoryReportError('')
    setReport(null)
    setReportId(id)
    setActiveTab('report')
    try {
      const saved = await getReport(id)
      if (request === historyRequest.current) setReport(saved)
    } catch (err) {
      if (request === historyRequest.current) setHistoryReportError(err instanceof Error ? err.message : String(err))
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false)
    }
  }

  async function removeHistory(id: string) {
    const reportRequest = historyRequest.current
    await deleteHistory(id)
    forgetReportScroll(id)
    historyRefresh.current += 1
    setHistory(entries => entries.filter(entry => entry.task_id !== id))
    if (reportId === id && reportRequest === historyRequest.current) {
      historyRequest.current += 1
      setReport(null)
      setReportId(null)
      setHistoryLoading(false)
      setHistoryReportError('')
      setActiveTab('report')
    }
    if (taskId === id) {
      setTaskId(null)
      setRunNumber(0)
      setAnalysisIssue(null)
      setActiveTab(tab => tab === 'progress' ? 'report' : tab)
    }
    void refreshHistory()
  }

  const connectProgress = useCallback((id: string) => {
    closeSource()
    sourceRef.current = subscribeProgress(
      id,
      (evt) => {
        setEventsByStage((prev) => ({ ...prev, [evt.stage]: evt }))
        if (Number.isFinite(evt.progress)) {
          setOverallProgress((prev) => Math.max(prev, evt.progress))
        }
      },
      (completion) => {
        sourceRef.current = null
        setRunning(false)
        if (completion.status === 'failed') {
          setAnalysisIssue({ kind: 'task', message: completion.error || '分析未能完成。' })
          setActiveTab('progress')
          return
        }
        setAnalysisIssue(null)
        setOverallProgress(1)
        void fetchReport(id)
      },
      () => setAnalysisIssue({ kind: 'connection', message: '进度连接中断，正在尝试重新连接。' }),
      () => setAnalysisIssue((issue) => issue?.kind === 'connection' ? null : issue),
    )
  }, [closeSource, fetchReport])

  /** 启动分析 */
  const handleStart = useCallback(async () => {
    if (uploadLock.current || modelSaving || starting || running || reportLoading) return
    // 根据输入模式构建请求参数
    const params: AnalyzeParams = {}
    if (inputMode === 'folder') {
      const path = folderPath.trim()
      if (!path) {
        setError('请输入 PDF 文件夹路径')
        return
      }
      params.folder_path = path
    } else {
      if (selectedPaperIds.size === 0) {
        setError('请至少选择一篇论文')
        return
      }
      params.paper_ids = Array.from(selectedPaperIds)
    }
    const direction = researchDirection.trim()
    if (direction) params.research_direction = direction

    rememberReportScroll()
    setError(null)
    setAnalysisIssue(null)
    setTaskId(null)
    setStarting(true)
    setRunStartedAt(Date.now())
    setRunning(true)
    setReport(null)
    setReportId(null)
    historyRequest.current += 1
    setHistoryLoading(false)
    setHistoryReportError('')
    setOverallProgress(0)
    setEventsByStage(createEmptyEvents())
    setRunNumber((previous) => previous + 1)
    setActiveTab('progress')

    // 关闭可能存在的旧订阅
    closeSource()

    try {
      const { task_id } = await startAnalysis(params)
      setTaskId(task_id)

      connectProgress(task_id)
    } catch (err) {
      setAnalysisIssue({
        kind: 'start',
        message: `启动分析失败：${err instanceof Error ? err.message : String(err)}`,
      })
      setRunning(false)
    } finally {
      setStarting(false)
    }
  }, [inputMode, folderPath, selectedPaperIds, researchDirection, closeSource, connectProgress, rememberReportScroll, modelSaving, starting, running, reportLoading])

  const handleRetry = useCallback(() => {
    const kind = analysisIssue?.kind
    if (kind === 'start' || kind === 'task') {
      void handleStart()
      return
    }
    if (!taskId) return
    setAnalysisIssue(null)
    if (kind === 'report') void fetchReport(taskId)
    if (kind === 'connection') connectProgress(taskId)
  }, [analysisIssue, taskId, fetchReport, connectProgress, handleStart])

  /** 评估数据：优先取 report.evaluation，其次 report.report.evaluation */
  const evaluation: Evaluation | null = useMemo(() => {
    if (!report) return null
    return report.evaluation ?? report.report?.evaluation ?? null
  }, [report])

  /** Markdown 文本 */

  const analysisBusy = starting || running || reportLoading
  const currentRun = history.find(entry => entry.task_id === taskId)

  return (
    <div className="app" data-theme={theme}>
      {/* 顶部标题栏 */}
      <header className="app-header">
        <div className="brand">
          <div>
            <div className="brand-title brand-wordmark">Paper<span className="brand-wordmark-mind">Research-Agent
              <svg className="brand-vine" viewBox="0 0 90 26" fill="none" aria-hidden="true">
                <path className="brand-vine-stem" pathLength="1" d="M2 17C17 24 23 5 39 12S64 25 77 9" />
                <path className="brand-vine-leaf brand-vine-leaf-first" d="M25 13Q22 5 16 7Q18 13 25 13Z" />
                <path className="brand-vine-leaf brand-vine-leaf-second" d="M51 18Q54 10 60 13Q58 19 51 18Z" />
                <g className="brand-vine-bloom" fill="currentColor">
                  <ellipse cx="78" cy="4.2" rx="1.9" ry="3.2" transform="rotate(-12 78 8)" />
                  <ellipse cx="78" cy="4.2" rx="1.9" ry="3.2" transform="rotate(60 78 8)" />
                  <ellipse cx="78" cy="4.2" rx="1.9" ry="3.2" transform="rotate(132 78 8)" />
                  <ellipse cx="78" cy="4.2" rx="1.9" ry="3.2" transform="rotate(204 78 8)" />
                  <ellipse cx="78" cy="4.2" rx="1.9" ry="3.2" transform="rotate(276 78 8)" />
                  <circle cx="78" cy="8" r="1.6" fill="var(--bg-primary)" />
                </g>
              </svg>
            </span></div>
            <div className="brand-subtitle">论文科研智能体</div>
          </div>
        </div>
        <div className="header-right">
          <span className="model-badge">
            <span className={`dot ${healthOk === null ? 'connecting' : healthOk ? '' : 'offline'}`} />
            <span>{healthOk === null ? '连接中' : healthOk ? '服务正常' : '服务离线'}</span>
          </span>
          {healthOk === false && <button className="text-action" onClick={() => setHealthRevision(value => value + 1)}>重新检测</button>}
          <ModelSettingsDialog onSave={settings => {
            setModel(settings.model)
            setModelRevision(revision => revision + 1)
          }} />
          <button
            type="button"
            className="theme-toggle"
            onClick={switchTheme}
            aria-label={nextTheme === 'dark' ? '切换到深色模式' : '切换到浅色模式'}
          >
            <span className="theme-icon" aria-hidden>
              {nextTheme === 'dark' ? '◐' : '☀'}
            </span>
            <span>{nextTheme === 'dark' ? '深色' : '浅色'}</span>
          </button>
        </div>
      </header>

      <div className={`app-body${focusReading && activeTab === 'report' && markdown ? ' reading-focused' : ''}`}>
        {/* 左侧输入区 + 进度 + 时间线 */}
        <aside className="sidebar">
          <div className="sidebar-scroll">
          <div className="input-card">
            <div className="input-card-header">
              <div><span className="workspace-kicker">你的研究空间</span><h2 className="card-title">研究资料</h2></div>
              <span className="library-total">{papers.length} 篇文献</span>
            </div>

            {/* 输入模式切换 */}
            <div className="mode-toggle" role="group" aria-label="论文来源">
              <button
                className={`mode-btn ${inputMode === 'upload' ? 'active' : ''}`}
                aria-pressed={inputMode === 'upload'}
                onClick={() => setInputMode('upload')}
                disabled={analysisBusy}
              >
                上传论文
              </button>
              <button
                className={`mode-btn ${inputMode === 'folder' ? 'active' : ''}`}
                aria-pressed={inputMode === 'folder'}
                onClick={() => setInputMode('folder')}
                disabled={analysisBusy}
              >
                文件夹路径
              </button>
            </div>

            {/* 上传模式：论文库；文件夹模式：路径输入 */}
            {inputMode === 'upload' ? (
              <PaperLibrary
                papers={papers}
                selectedIds={selectedPaperIds}
                onToggleSelect={handleToggleSelect}
                onDelete={handleDeletePaper}
                onUpload={handleUpload}
                uploading={uploading}
                uploadQueue={uploadQueue}
                loading={papersLoading}
                error={papersError}
                onRetry={() => void refreshPapers()}
                onSelectMany={ids => setSelectedPaperIds(previous => new Set([...previous, ...ids]))}
                onClearSelection={() => setSelectedPaperIds(new Set())}
                disabled={analysisBusy}
              />
            ) : (
              <>
                <input
                  className="path-input"
                  type="text"
                  placeholder="例如：D:/papers 或 /home/user/papers"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !analysisBusy && !modelSaving) {
                      void handleStart()
                    }
                  }}
                  disabled={analysisBusy}
                  aria-label="PDF 文件夹路径"
                />
                <p className="hint">填写存放 PDF 的本地文件夹路径。</p>
              </>
            )}

            {/* 研究方向（两种模式都显示） */}
            <div className="research-direction">
              <label className="research-label" htmlFor="research-direction">
                研究方向（可选）
              </label>
              <input
                id="research-direction"
                className="path-input"
                type="text"
                placeholder="例如：大模型高效微调、多模态推理"
                value={researchDirection}
                onChange={(e) => setResearchDirection(e.target.value)}
                disabled={analysisBusy}
                aria-label="研究方向"
              />
            </div>

            <details className="model-disclosure">
              <summary><span>分析模型</span><span>{analysisBusy ? currentRun?.model || model : model}</span></summary>
              <ModelPicker model={analysisBusy ? currentRun?.model || model : model}
                revision={modelRevision} disabled={analysisBusy} onChange={setModel} onSavingChange={setModelSaving} />
            </details>


          </div>

          {/* 论文库操作错误 */}
          {error && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden>!</span>
              <span className="error-text">{error}</span>
            </div>
          )}
          <HistoryPanel entries={history} error={historyError} active={taskId} busy={analysisBusy}
            selected={activeTab === 'report' ? reportId : taskId}
            onShowActive={() => openTab('progress')}
            onOpen={id => void openHistory(id)} onDelete={removeHistory} />
          </div>
          <div className="analysis-action-bar">
            <button
              className="btn btn-primary"
              onClick={() => void handleStart()}
              disabled={
                analysisBusy ||
                uploading || (inputMode === 'upload' && (papersLoading || Boolean(papersError))) ||
                modelSaving ||
                (inputMode === 'folder' ? !folderPath.trim() : selectedPaperIds.size === 0)
              }
            >
              {starting ? <><span className="spinner" /> 启动中...</> : analysisBusy ? '分析进行中' : uploading ? '正在上传论文…' : inputMode === 'upload' && selectedPaperIds.size ? `分析已选的 ${selectedPaperIds.size} 篇论文` : '启动分析'}
            </button>
            {inputMode === 'upload' && !selectedPaperIds.size && !analysisBusy && <p className="hint">请先上传并选择至少一篇论文。</p>}
          </div>
        </aside>

        {/* 右侧主内容区：Tab 切换 */}
        <main className="main-content">
          <WorkspaceTabs active={activeTab} onChange={openTab} progressEnabled={runNumber > 0}
            evaluationCount={evaluation ? evaluation.innovations_scores?.length || report?.report?.innovations?.length || 0 : undefined}
            canFocus={activeTab === 'report' && Boolean(markdown)} focused={focusReading} onToggleFocus={toggleReading} />

          <div key={activeTab} ref={reportContainerRef} tabIndex={0} role="region" aria-label="分析结果内容"
            className={`report-container tab-panel-enter${activeTab === 'report' && report ? ' report-arrive' : ''}`}>
            {activeTab === 'report' && (
              <PanelErrorBoundary key={`report-${reportId ?? ''}`} title="研究报告">
                <ReportView
                  markdown={markdown}
                  taskId={reportId}
                  model={report?.model}
                  usage={report?.usage}
                  result={report?.report}
                  onShowEvaluation={() => openTab('evaluation')}
                  pendingMessage={historyLoading ? '正在打开历史报告…' : reportLoading ? '正在读取研究报告…' : analysisBusy && !report ? '论文分析中' : undefined}
                  error={historyReportError || (!analysisBusy && !report ? analysisIssue?.message : undefined)}
                  onShowProgress={runNumber > 0 && !historyLoading && !historyReportError ? () => openTab('progress') : undefined}
                />
              </PanelErrorBoundary>
            )}
            {activeTab === 'evaluation' && (
              <PanelErrorBoundary key={`evaluation-${reportId ?? ''}`} title="评估指标">
                <EvaluationPanel evaluation={evaluation} innovations={report?.report?.innovations} />
              </PanelErrorBoundary>
            )}
            {activeTab === 'progress' && (
              <AnalysisProgress
                key={runNumber}
                eventsByStage={eventsByStage}
                progress={overallProgress}
                running={running}
                reportLoading={reportLoading}
                startedAt={runStartedAt}
                issue={analysisIssue}
                onRetry={handleRetry}
                cost={currentRun ? <CostLabel usage={currentRun.usage} /> : null}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
