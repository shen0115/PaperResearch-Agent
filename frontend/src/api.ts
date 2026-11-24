// API 调用封装：统一处理后端 /api/* 接口
import type { ProgressEvent, Report, TaskStatus, HealthInfo, Paper, UploadResponse, AnalyzeParams } from './types'
import type { HistoryEntry, ModelCompatibility, ModelSettings, PaperChat, PaperChatSummary, ReasoningEffort } from './types'

/** 后端基础地址（vite 代理已将 /api 转发到 localhost:8000） */
const API_BASE = '/api'

interface TaskCompletion {
  status: 'completed' | 'failed'
  progress: number
  error?: string | null
}

/** 通用 JSON 请求封装，统一抛错 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const data = await resp.json()
      detail = data?.detail || data?.message || JSON.stringify(data)
    } catch {
      detail = await resp.text().catch(() => '')
    }
    throw new Error(`请求失败 ${resp.status} ${resp.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return (await resp.json()) as T
}

/**
 * 启动分析任务
 * POST /api/analyze body: { folder_path?, paper_ids?, research_direction? }
 */
export async function startAnalysis(params: AnalyzeParams): Promise<{ task_id: string }> {
  return requestJson<{ task_id: string }>(`${API_BASE}/analyze`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export function listPaperChats(): Promise<{ conversations: PaperChatSummary[] }> {
  return requestJson(`${API_BASE}/qa/conversations`)
}

export function getPaperChat(id: string): Promise<PaperChat> {
  return requestJson(`${API_BASE}/qa/conversations/${id}`)
}

export function askPaperChat(
  id: string,
  body: { turn_id: string; question: string; paper_ids: string[]; expected_turns: number; model?: string; reasoning_effort?: ReasoningEffort },
): Promise<PaperChat> {
  return requestJson(`${API_BASE}/qa/conversations/${id}/turns`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * 上传 PDF 论文
 * POST /api/upload (multipart/form-data)
 */
export async function uploadPaper(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const data = await resp.json()
      detail = data?.detail || data?.message || JSON.stringify(data)
    } catch {
      detail = await resp.text().catch(() => '')
    }
    throw new Error(`上传失败 ${resp.status} ${resp.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return (await resp.json()) as UploadResponse
}

/**
 * 列出论文库全部论文
 * GET /api/papers
 */
export async function listPapers(): Promise<{ papers: Paper[] }> {
  return requestJson<{ papers: Paper[] }>(`${API_BASE}/papers`)
}

/**
 * 删除论文
 * DELETE /api/papers/{paper_id}
 */
export async function deletePaper(paperId: string): Promise<{ deleted: boolean; paper_id: string }> {
  return requestJson<{ deleted: boolean; paper_id: string }>(`${API_BASE}/papers/${paperId}`, {
    method: 'DELETE',
  })
}

/**
 * 订阅任务进度（SSE）
 * 使用 EventSource 连接 /api/progress/{task_id}
 * 返回 EventSource 实例，调用方可主动 close() 取消订阅
 */
export function subscribeProgress(
  taskId: string,
  onEvent: (e: ProgressEvent) => void,
  onDone: (completion: TaskCompletion) => void,
  onError: (err: Event) => void,
  onOpen: () => void,
): EventSource {
  const source = new EventSource(`${API_BASE}/progress/${taskId}`)

  // 后端推送的是命名事件（event: progress / event: done），
  // 必须用 addEventListener 监听对应事件名，onmessage 只能收到无名事件。
  source.addEventListener('progress', (ev: MessageEvent) => {
    const raw = ev.data
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as ProgressEvent
      onEvent(parsed)
    } catch (err) {
      console.warn('解析 SSE progress 事件失败:', raw, err)
    }
  })

  // 任务结束（completed/failed）后端推送 event: done
  source.addEventListener('done', (ev: MessageEvent) => {
    source.close()
    try {
      onDone(JSON.parse(ev.data) as TaskCompletion)
    } catch {
      onError(ev)
    }
  })

  source.onerror = onError
  source.onopen = onOpen

  return source
}

/**
 * 获取最终报告
 * GET /api/report/{task_id}
 */
export async function getReport(taskId: string): Promise<Report> {
  return requestJson<Report>(`${API_BASE}/report/${taskId}`)
}

/**
 * 查询任务状态
 * GET /api/tasks/{task_id}
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
  return requestJson<TaskStatus>(`${API_BASE}/tasks/${taskId}`)
}

/**
 * 健康检查
 * GET /api/health
 */
export async function getHealth(): Promise<HealthInfo> {
  return requestJson<HealthInfo>(`${API_BASE}/health`)
}

type ProviderConnection = Pick<ModelSettings, 'base_url'> & { api_key?: string }
type ModelSettingsInput = Omit<ModelSettings, 'configured' | 'compatibility' | 'official_pricing' | 'provider_reported_cost'> & ProviderConnection

export function getModelSettings() {
  return requestJson<ModelSettings>(`${API_BASE}/model-settings`)
}

export function discoverModels(connection: ProviderConnection) {
  return requestJson<{ models: string[]; reasoning_efforts?: Record<string, ReasoningEffort[]> }>(`${API_BASE}/model-settings/models`, {
    method: 'POST',
    body: JSON.stringify(connection),
  })
}

export function saveModelSettings(settings: ModelSettingsInput) {
  return requestJson<ModelSettings>(`${API_BASE}/model-settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export function testModelCompatibility(config: Pick<ModelSettings, 'base_url' | 'model'>) {
  return requestJson<ModelCompatibility>(`${API_BASE}/model-settings/compatibility`, {
    method: 'POST',
    body: JSON.stringify({ base_url: config.base_url, model: config.model }),
  })
}

export function getHistory() {
  return requestJson<{ tasks: HistoryEntry[] }>(`${API_BASE}/history`)
}

export function deleteHistory(id: string) {
  return requestJson<{ deleted: boolean }>(`${API_BASE}/history/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
