import type { ReactNode } from 'react'
import type { Paper } from '../types'

export default function AnalysisSetup({
  source, onSourceChange, papers, folderPath, onFolderPathChange, direction, onDirectionChange,
  modelControl, busy, canStart, onStart,
}: {
  source: 'upload' | 'folder'
  onSourceChange: (source: 'upload' | 'folder') => void
  papers: Paper[]
  folderPath: string
  onFolderPathChange: (path: string) => void
  direction: string
  onDirectionChange: (direction: string) => void
  modelControl: ReactNode
  busy: boolean
  canStart: boolean
  onStart: () => void
}) {
  return (
    <form className="analysis-setup" onSubmit={event => {
      event.preventDefault()
      if (canStart) onStart()
    }}>
      <h1>新建分析</h1>
      <fieldset className="analysis-setup-scope" disabled={busy}>
        <legend>分析范围</legend>
        <div className="mode-toggle" role="group" aria-label="论文来源">
          <button type="button" className={`mode-btn${source === 'upload' ? ' active' : ''}`}
            aria-pressed={source === 'upload'} onClick={() => onSourceChange('upload')}>已选论文</button>
          <button type="button" className={`mode-btn${source === 'folder' ? ' active' : ''}`}
            aria-pressed={source === 'folder'} onClick={() => onSourceChange('folder')}>本地文件夹</button>
        </div>
        {source === 'folder' ? (
          <div className="analysis-field">
            <label htmlFor="analysis-folder-path">PDF 文件夹路径</label>
            <input id="analysis-folder-path" className="path-input" value={folderPath}
              placeholder="例如 D:/papers" onChange={event => onFolderPathChange(event.target.value)} />
          </div>
        ) : papers.length ? (
          <details className="analysis-selection" open={papers.length <= 3}>
            <summary>已选 {papers.length} 篇论文</summary>
            <ul>{papers.map(paper => <li key={paper.paper_id}>{paper.title || paper.filename}</li>)}</ul>
          </details>
        ) : <p className="analysis-setup-hint">从论文库选择要分析的论文。</p>}
      </fieldset>

      <div className="analysis-field">
        <label htmlFor="research-direction">研究方向 <span>可选</span></label>
        <input id="research-direction" className="path-input" value={direction}
          placeholder="例如：比较论文的实验设计" disabled={busy}
          onChange={event => onDirectionChange(event.target.value)} />
      </div>

      {modelControl}

      <footer className="analysis-setup-actions">
        <button type="submit" className="btn btn-primary" disabled={!canStart}>
          {busy ? '分析进行中' : '开始分析'}
        </button>
      </footer>
    </form>
  )
}
