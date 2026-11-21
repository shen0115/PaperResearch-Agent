import type { Evaluation, Innovation, InnovationAssessment, ReportScore, ThreeDScore } from '../types'

const DIMENSIONS: Array<[keyof ThreeDScore, string]> = [
  ['novelty', '新颖性'],
  ['feasibility', '可行性'],
  ['significance', '显著性'],
]

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '暂无'
}

function isAssessment(value: InnovationAssessment | ReportScore): value is InnovationAssessment {
  return 'score' in value || 'innovation_title' in value || 'reasoning' in value
}

function scoreRows(evaluation: Evaluation | null, innovations: Innovation[]) {
  const scores = evaluation?.innovations_scores ?? []
  if (!scores.length) {
    return innovations.map((item, index) => ({
      title: item.title || `创新点 ${index + 1}`,
      score: item.score,
      evidence: item.supporting_evidence,
      reasoning: null,
      source: '报告中的评分',
    }))
  }
  return scores.map((item, index) => {
    if (!isAssessment(item)) {
      return { title: `创新点 ${index + 1}`, score: item, source: '历史评分', reasoning: null, evidence: null }
    }
    const innovation = item.innovation_title
      ? innovations.find(entry => entry.title?.trim() === item.innovation_title?.trim()) : undefined
    return {
      title: item.innovation_title || `创新点 ${index + 1}`,
      score: item.score,
      reasoning: item.reasoning,
      evidence: innovation?.supporting_evidence,
      source: Object.keys(item.score ?? {}).length === 0 ? '未评分'
        : item.score_source === 'fallback' ? '沿用已有评分' : '评估评分',
    }
  })
}

export default function EvaluationPanel({
  evaluation, innovations = [],
}: { evaluation: Evaluation | null; innovations?: Innovation[] }) {
  if (!evaluation && !innovations.length) {
    return (
      <div className="report-empty">
        <div className="empty-icon empty-icon-chart" aria-hidden />
        <div className="empty-title">暂无评估数据</div>
        <div className="empty-desc">分析完成后可以在这里查看每条创新点的评分。</div>
      </div>
    )
  }

  const rows = scoreRows(evaluation, innovations)
  const toolCalls = evaluation?.tool_calls ?? []
  return (
    <div className="innovation-evaluation">
      <section aria-labelledby="innovation-scores-title">
        <header className="innovation-evaluation-header">
          <h2 id="innovation-scores-title">逐项评估</h2>
          {rows.length > 0 && <span>每项满分 10</span>}
        </header>
        {rows.length === 0 && <p className="tool-placeholder">本次报告暂无创新点评分。</p>}
        <ul className="innovation-scores">
          {rows.map((row, index) => (
            <li className="innovation-score-card" key={`${row.title}-${index}`}>
              <div className="innovation-score-header">
                <h3>{row.title}</h3>
                <span>{row.source}</span>
              </div>
              <dl className="innovation-dimensions">
                {DIMENSIONS.map(([dimension, label]) => {
                  const value = row.score?.[dimension]
                  const measured = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10
                  return (
                    <div key={dimension} className="innovation-dimension">
                      <dt>{label}</dt>
                      <dd className="score-num">{measured ? value.toFixed(1) : '暂无评分'}</dd>
                      {measured && (
                        <div className="score-track" aria-hidden>
                          <div className={`score-fill ${dimension}`} style={{ width: `${value * 10}%` }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </dl>
              <div className="innovation-explanation">
                <p><strong>评分依据</strong> {row.reasoning?.trim() || '暂无评分依据'}</p>
                {row.evidence?.trim() && <p><strong>报告论据</strong> {row.evidence}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {evaluation && (
        <details className="tool-list">
          <summary>工具调用明细（{toolCalls.length} 条）</summary>
          <p className="tool-placeholder">
            成功率 {percent(evaluation.tool_call_success_rate)} · 调用 {evaluation.total_tool_calls ?? '暂无'} 次
            · 失败 {evaluation.failed_tool_calls ?? '暂无'} 次 · 平均置信度 {percent(evaluation.avg_confidence)}
          </p>
          {toolCalls.length > 0 && (
            <div className="tool-table-scroll" role="region" aria-label="工具调用表格，可横向滚动" tabIndex={0}>
              <table className="tool-table">
                <thead><tr><th scope="col">工具</th><th scope="col">入参摘要</th><th scope="col">结果</th><th scope="col">耗时</th></tr></thead>
                <tbody>
                  {toolCalls.map((call, index) => (
                    <tr key={`${call.tool_name}-${index}`}>
                      <td>{call.tool_name}</td>
                      <td>{call.args_summary || '—'}</td>
                      <td>{call.success ? '成功' : '失败'}</td>
                      <td>{Number.isFinite(call.duration_sec) ? `${call.duration_sec.toFixed(2)} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </div>
  )
}
