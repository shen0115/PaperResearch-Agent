// Paper Innovation Agent - 主应用组件
// 状态管理 + 布局 + 交互流程
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { deleteHistory, deletePaper, getHealth, getHistory, getReport, listPapers, startAnalysis, subscribeProgress, uploadPaper } from './api'
import { STAGE_LIST } from './types'
import type { AnalyzeParams, Evaluation, HistoryEntry, Paper, ProgressEvent, ReasoningEffort, Report, StageKey } from './types'
import AnalysisProgress from './components/AnalysisProgress'
import type { AnalysisIssue } from './components/AnalysisProgress'
import EvaluationPanel from './components/EvaluationPanel'
import ReportView from './components/ReportView'
import PaperLibrary from './components/PaperLibrary'
import ModelPicker from './components/ModelPicker'
import HistoryPanel, { CostLabel } from './components/HistoryPanel'
import PanelErrorBoundary from './components/PanelErrorBoundary'
import { useReportScroll } from './useReportScroll'
import WorkspaceTabs from './components/WorkspaceTabs'
import WorkspaceDivider from './components/WorkspaceDivider'
import WorkspaceSettings from './components/WorkspaceSettings'
import AnalysisSetup from './components/AnalysisSetup'
import PaperChatPanel, { PaperChatHistory } from './components/PaperChatPanel'
import { usePaperChat } from './usePaperChat'

/** 初始化：所有阶段事件为空 */
function createEmptyEvents(): Record<StageKey, ProgressEvent | undefined> {
  const obj = {} as Record<StageKey, ProgressEvent | undefined>
  STAGE_LIST.forEach((s) => (obj[s.key] = undefined))
  return obj
}

type TabKey = 'report' | 'evaluation' | 'progress'
type AnalysisView = 'setup' | 'history' | 'results'
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

  // 分析来源：论文库 / 文件夹路径
  const [inputMode, setInputMode] = useState<'upload' | 'folder'>('upload')
  // 论文库列表与选中状态
  const [papers, setPapers] = useState<Paper[]>([])
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  const [workspaceMode, setWorkspaceMode] = useState<'qa' | 'analysis'>('qa')
  const paperChat = usePaperChat()
  const draftSelections = useRef(new Map<string, Set<string>>())
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false)
  // 研究方向（注入创新点生成提示词）
  const [researchDirection, setResearchDirection] = useState('')
  // 上传中状态
  const [uploading, setUploading] = useState(false)
  const uploadLock = useRef(false)
  const paperFileInput = useRef<HTMLInputElement>(null)
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
  const [chatModel, setChatModel] = useState<string>()
  const [chatReasoning, setChatReasoning] = useState<{ model: string; effort: ReasoningEffort }>()
  const [analysisReasoning, setAnalysisReasoning] = useState<{ model: string; effort: ReasoningEffort }>()
  const activeChatModel = chatModel ?? model
  const chatEffort = chatReasoning?.model === activeChatModel ? chatReasoning.effort : undefined
  const analysisEffort = analysisReasoning?.model === model ? analysisReasoning.effort : undefined
  const [modelSaving, setModelSaving] = useState(false)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthRevision, setHealthRevision] = useState(0)

  // Tab 切换
  const [activeTab, setActiveTab] = useState<TabKey>('report')
  const [analysisView, setAnalysisView] = useState<AnalysisView>('setup')
  const reportContainerRef = useRef<HTMLDivElement>(null)
  const markdown = report?.markdown ?? report?.report?.markdown ?? ''
  const { remember: rememberReportScroll, forget: forgetReportScroll } = useReportScroll(
    workspaceMode === 'analysis' && analysisView === 'results' && activeTab === 'report' &&
      markdown && !historyLoading && !reportLoading ? reportId : null,
    reportContainerRef,
  )

  function openTab(tab: TabKey) {
    if (tab === activeTab) return
    rememberReportScroll()
    setActiveTab(tab)
  }

  function showQuestions() {
    if (workspaceMode === 'qa') return
    rememberReportScroll()
    setWorkspaceMode('qa')
  }

  function showAnalysisView(view: AnalysisView) {
    rememberReportScroll()
    setAnalysisView(view)
  }

  function rememberDraftSelection() {
    if (!paperChat.chat) draftSelections.current.set(paperChat.draftId, selectedPaperIds)
  }

  function openPaperDraft(id: string) {
    if (!paperChat.showDraft(id)) return
    rememberDraftSelection()
    const savedSelection = draftSelections.current.get(id)
    if (savedSelection) {
      setSelectedPaperIds(new Set([...savedSelection].filter(id => papers.some(paper => paper.paper_id === id))))
    }
    setMobileLibraryOpen(false)
    showQuestions()
  }

  function newPaperChat() {
    const id = paperChat.chat || paperChat.draft.trim()
      ? `draft:${crypto.randomUUID()}`
      : paperChat.draftId
    openPaperDraft(id)
  }

  function startPaperChatWithSelection() {
    if (!paperChat.showDraft(`draft:${crypto.randomUUID()}`, paperChat.draft)) return
    setMobileLibraryOpen(false)
    showQuestions()
  }

  async function openPaperChat(id: string) {
    rememberDraftSelection()
    showQuestions()
    const conversation = await paperChat.openChat(id)
    if (conversation) {
      setMobileLibraryOpen(false)
      setSelectedPaperIds(new Set(conversation.papers
        .map(paper => paper.paper_id)
        .filter(id => papers.some(paper => paper.paper_id === id))))
    }
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
    const request = ++historyRequest.current
    setHistoryLoading(false)
    setHistoryReportError('')
    setReportLoading(true)
    try {
      const r = await getReport(id)
      if (request !== historyRequest.current) return
      const showReport = () => {
        if (request !== historyRequest.current) return
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
      if (request !== historyRequest.current) return
      setAnalysisIssue({
        kind: 'report',
        message: `获取报告失败：${err instanceof Error ? err.message : String(err)}`,
      })
      setActiveTab('progress')
    } finally {
      if (request === historyRequest.current) setReportLoading(false)
    }
  }, [])

  async function openHistory(id: string) {
    rememberReportScroll()
    const request = ++historyRequest.current
    setReportLoading(false)
    setHistoryLoading(true)
    setHistoryReportError('')
    setReport(null)
    setReportId(id)
    setActiveTab('report')
    setAnalysisView('results')
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
    const source = subscribeProgress(
      id,
      (evt) => {
        if (sourceRef.current !== source) return
        setEventsByStage((prev) => ({ ...prev, [evt.stage]: evt }))
        if (Number.isFinite(evt.progress)) {
          setOverallProgress((prev) => Math.max(prev, evt.progress))
        }
      },
      (completion) => {
        if (sourceRef.current !== source) return
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
      () => {
        if (sourceRef.current === source) {
          setAnalysisIssue({ kind: 'connection', message: '进度连接中断，正在尝试重新连接。' })
        }
      },
      () => {
        if (sourceRef.current === source) setAnalysisIssue((issue) => issue?.kind === 'connection' ? null : issue)
      },
    )
    sourceRef.current = source
  }, [closeSource, fetchReport])

  function openRunningAnalysis(entry: HistoryEntry) {
    if (starting) return
    showAnalysisView('results')
    setActiveTab('progress')
    if (taskId === entry.task_id && (sourceRef.current || entry.status === 'failed' || entry.status === 'interrupted')) return

    historyRequest.current += 1
    setReportLoading(false)
    setHistoryLoading(false)
    setHistoryReportError('')
    setReport(null)
    setReportId(null)
    setTaskId(entry.task_id)
    setRunNumber(previous => previous + 1)
    const startedAt = Date.parse(entry.created_at)
    setRunStartedAt(Number.isFinite(startedAt) ? startedAt : null)
    setEventsByStage(createEmptyEvents())
    setOverallProgress(0)
    setAnalysisIssue(null)
    setRunning(true)
    connectProgress(entry.task_id)
  }

  /** 启动分析 */
  const handleStart = useCallback(async () => {
    if (uploadLock.current || modelSaving || starting || running || reportLoading) return
    // 根据输入模式构建请求参数
    const params: AnalyzeParams = { reasoning_effort: analysisEffort }
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
    setAnalysisView('results')

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
  }, [inputMode, folderPath, selectedPaperIds, researchDirection, analysisEffort, closeSource, connectProgress, rememberReportScroll, modelSaving, starting, running, reportLoading])

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
  const canStartAnalysis = !analysisBusy && !uploading && !modelSaving && (
    inputMode === 'folder' ? Boolean(folderPath.trim()) : !papersLoading && !papersError && selectedPaperIds.size > 0
  )
  const hasAnalysisResults = runNumber > 0 || Boolean(reportId)
  const readingFocused = workspaceMode === 'analysis' && analysisView === 'results' &&
    focusReading && activeTab === 'report' && markdown

  return (
    <div className="app" data-theme={theme}>
      <div className={`app-body${workspaceMode === 'qa' ? ' qa-workspace' : ''}${readingFocused ? ' reading-focused' : ''}`}>
        <aside className="sidebar" id="workspace-library">
          <header className="workspace-brand">
            <div className="brand-title brand-wordmark">Paper<span className="brand-wordmark-mind">Mind
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
          </header>
            <PaperChatHistory state={paperChat} onOpen={id => void openPaperChat(id)} onNew={newPaperChat}
              onResume={openPaperDraft} libraryLoading={papersLoading} />
          <button type="button" className="workspace-library-toggle" aria-expanded={mobileLibraryOpen}
            aria-controls="workspace-library-content" onClick={() => setMobileLibraryOpen(open => !open)}>
            <span>选择论文</span>
            <span>已选 {selectedPaperIds.size} 篇</span>
          </button>
          <div className="sidebar-scroll" id="workspace-library-content" data-mobile-open={mobileLibraryOpen}>
          <div className="input-card">
            <div className="input-card-header">
              <h2 className="card-title">研究资料</h2>
              {papers.length > 0 ? (
                <button type="button" className="library-upload-compact"
                  disabled={uploading || (workspaceMode === 'analysis' && analysisBusy)}
                  title="选择 PDF，也可以拖入论文列表"
                  onClick={() => paperFileInput.current?.click()}>
                  {uploading ? '上传中…' : '＋ 添加论文'}
                </button>
              ) : <span className="library-total">{papers.length} 篇文献</span>}
            </div>

              <PaperLibrary
                fileInputRef={paperFileInput}
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
                disabled={workspaceMode === 'analysis' && analysisBusy}
              />
          </div>

          {/* 论文库操作错误 */}
          {error && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden>!</span>
              <span className="error-text">{error}</span>
            </div>
          )}
          </div>
          <WorkspaceSettings dark={theme === 'dark'} onToggleTheme={switchTheme} health={healthOk}
            onSaveModel={settings => {
              setModel(settings.model)
              setChatModel(undefined)
              setChatReasoning(undefined)
              setAnalysisReasoning(undefined)
              setModelRevision(revision => revision + 1)
            }} />
        </aside>

        <WorkspaceDivider />

        {/* 右侧主内容区：Tab 切换 */}
        <main className="main-content">
          <div className="qa-workspace-tabs" role="group" aria-label="工作台视图">
            <button type="button" aria-pressed={workspaceMode === 'qa'} onClick={showQuestions}>问答</button>
            <button type="button" aria-pressed={workspaceMode === 'analysis'} onClick={() => setWorkspaceMode('analysis')}>
              分析{analysisBusy && <span className="qa-analysis-running" aria-label="进行中" />}
            </button>
            {workspaceMode === 'analysis' && <nav className="analysis-navigation" aria-label="分析工作台">
              <button type="button" aria-pressed={analysisView === 'setup'} onClick={() => showAnalysisView('setup')}>新建分析</button>
              <button type="button" aria-pressed={analysisView === 'history'} onClick={() => showAnalysisView('history')}>分析记录</button>
              {hasAnalysisResults && <button type="button" aria-pressed={analysisView === 'results'}
                onClick={() => showAnalysisView('results')}>分析结果</button>}
            </nav>}
          </div>
          {healthOk === false && (
            <div className="workspace-offline" role="status">
              <span>本地服务离线，暂时无法提交请求。</span>
              <button type="button" className="text-action" onClick={() => setHealthRevision(value => value + 1)}>重试连接</button>
            </div>
          )}
          {workspaceMode === 'qa' ? (
            <PaperChatPanel state={paperChat} selectedIds={selectedPaperIds} papers={papers} onNew={startPaperChatWithSelection}
              model={activeChatModel} requestedModel={chatModel} effort={chatEffort} modelRevision={modelRevision}
              onModelChange={name => {
                if (name !== activeChatModel) setChatReasoning(undefined)
                setChatModel(name)
              }}
              onEffortChange={effort => setChatReasoning({ model: activeChatModel, effort })}
              onTogglePaper={handleToggleSelect} onUpload={handleUpload} uploading={uploading}
              available={!papersLoading && !papersError && !uploading && !modelSaving}
              onAnswered={() => {
                if (!paperChat.chat) draftSelections.current.delete(paperChat.draftId)
                void refreshPapers()
              }} />
          ) : <>
          {analysisView === 'setup' && <div className="analysis-page-scroll">
            <AnalysisSetup source={inputMode} onSourceChange={setInputMode}
              papers={papers.filter(paper => selectedPaperIds.has(paper.paper_id))}
              folderPath={folderPath} onFolderPathChange={setFolderPath}
              direction={researchDirection} onDirectionChange={setResearchDirection}
              modelControl={<ModelPicker model={analysisBusy ? currentRun?.model || model : model}
                effort={analysisEffort} revision={modelRevision} disabled={analysisBusy}
                onChange={name => {
                  setAnalysisReasoning(undefined)
                  setModel(name)
                }}
                onSavingChange={setModelSaving} onEffortChange={effort => setAnalysisReasoning({ model, effort })} />}
              busy={analysisBusy} canStart={canStartAnalysis && healthOk !== false} onStart={() => void handleStart()} />
          </div>}
          {analysisView === 'history' && <div className="analysis-page-scroll">
            <HistoryPanel entries={history} error={historyError} active={taskId} busy={analysisBusy} starting={starting}
              selected={activeTab === 'report' ? reportId : taskId}
              onOpenProgress={openRunningAnalysis}
              onOpen={id => void openHistory(id)} onDelete={removeHistory} />
          </div>}
          {analysisView === 'results' && <>
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
                  result={report?.report}
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
          </>}
          </>}
        </main>
      </div>
    </div>
  )
}
