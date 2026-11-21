import { useState } from 'react'
import type { HistoryEntry, ModelUsage } from '../types'
import DeleteDialog from './DeleteDialog'

const STATUS_LABEL: Record<HistoryEntry['status'], string> = {
  pending: '等待',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

export function CostLabel({ usage }: { usage?: ModelUsage | null }) {
  if (!usage || (!usage.measured_calls && usage.estimated_cost == null)) return <span>暂无用量数据</span>
  const tokens = usage.measured_calls
    ? `输入 ${usage.input_tokens.toLocaleString()} / 输出 ${usage.output_tokens.toLocaleString()} tokens`
    : '暂无 token 明细'
  if (usage.estimated_cost == null) {
    return <span title="缺少当时的计费明细或适用单价。">费用未估算 · {tokens}</span>
  }
  const format = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: usage.currency ?? 'CNY', maximumFractionDigits: 6 })
  const price = (value: number) => value > 0 && value < 0.000001 ? `低于 ${format.format(0.000001)}` : format.format(value)
  const lower = usage.estimated_cost_lower
  const range = lower != null
  const upper = price(usage.estimated_cost)
  const cost = range && price(lower) !== upper ? `${price(lower)}–${upper}` : upper
  const providerCost = usage.cost_source === 'openrouter_reported'
  const basis = providerCost ? 'OpenRouter 返回的账户扣费，币种为美元'
    : usage.cost_source === 'deepseek_official' ? '按 DeepSeek 官网人民币单价'
      : usage.cost_source === 'custom' ? '按手动设置的单价' : ''
  const hits = usage.cached_input_tokens !== undefined ? `已记录缓存命中 ${usage.cached_input_tokens.toLocaleString()} tokens` : ''
  const missing = range ? '缓存或计费时段信息不完整，因此显示区间' : ''
  const label = providerCost ? (usage.partially_priced ? 'OpenRouter 部分扣费' : 'OpenRouter 扣费')
    : usage.unmeasured_calls ? '部分用量估算' : range ? '费用估算区间' : '估算费用'
  return <span title={[basis, hits, missing].filter(Boolean).join('。')}>
    {label} {cost} · {tokens}
  </span>
}

export default function HistoryPanel({
  entries, onOpen, onShowActive, onDelete, selected, active, busy, error,
}: {
  entries: HistoryEntry[]
  onOpen: (id: string) => void
  onShowActive: () => void
  onDelete: (id: string) => Promise<void>
  selected: string | null
  active: string | null
  busy: boolean
  error: boolean
}) {
  const [target, setTarget] = useState<HistoryEntry | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const visibleEntries = entries.filter(entry => (filter === 'all' || entry.status === filter)
    && `${entry.title} ${entry.model}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  return (
    <section className="history-panel" aria-labelledby="history-title">
      <details className="history-disclosure">
      <summary id="history-title"><span>分析历史</span><span>{entries.length} 份记录</span></summary>
      <div className="history-disclosure-content">
      {entries.length > 0 && <div className="history-filters">
        <input type="search" placeholder="搜索分析记录" aria-label="搜索分析记录" value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label="筛选分析状态" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>}
      {error && <p className="history-empty" role="status">暂时无法读取本机历史。</p>}
      {!error && !entries.length && <p className="history-empty">完成一次分析后，可在这里打开报告。</p>}
      <ul className="history-list">
        {visibleEntries.map(entry => {
          const actionable = entry.status === 'completed' || entry.task_id === active
          const canDelete = entry.status !== 'pending' && entry.status !== 'running' && !(busy && entry.task_id === active)
          const content = (
            <>
              <span className="history-name" title={entry.title}>{entry.title || '论文分析'}</span>
              <span className={`history-status history-status-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
              <span className="history-meta">
                <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}</time>
                {entry.model && <span title={entry.model}>{entry.model}</span>}
              </span>
            </>
          )
          return (
            <li key={entry.task_id} className="history-entry"><div className="history-item">
              {actionable ? (
                <button type="button" className="history-row" aria-pressed={selected === entry.task_id}
                  onClick={() => entry.task_id === active && entry.status !== 'completed' ? onShowActive() : onOpen(entry.task_id)}>
                  {content}
                </button>
              ) : (
                <div className="history-row" title={entry.error ?? undefined}>{content}</div>
              )}
              {canDelete && (
                <button type="button" className="history-delete" aria-label={`删除分析记录：${entry.title || '论文分析'}`}
                  onClick={() => setTarget(entry)}>
                  删除
                </button>
              )}
            </div>{(entry.usage || entry.error) && <details className="history-details"><summary>用量与详情</summary>
              {entry.usage && <div><CostLabel usage={entry.usage} /></div>}
              {entry.error && <p>{entry.error}</p>}
            </details>}</li>
          )
        })}
      </ul>
      {entries.length > 0 && !visibleEntries.length && <p className="history-empty">没有匹配的分析记录。</p>}
      </div></details>
      {target && (
        <DeleteDialog title="删除分析记录？" onClose={() => setTarget(null)}
          onConfirm={() => onDelete(target.task_id)}>
          「{target.title || '论文分析'}」及对应报告将从本机历史中删除。已上传的论文会保留。
        </DeleteDialog>
      )}
    </section>
  )
}
