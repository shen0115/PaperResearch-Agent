// 论文库组件：上传、列表、选择、删除
import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Paper, PreprocessStatus } from '../types'
import DeleteDialog from './DeleteDialog'

interface PaperLibraryProps {
  fileInputRef: RefObject<HTMLInputElement>
  papers: Paper[]
  selectedIds: Set<string>
  onToggleSelect: (paperId: string) => void
  onDelete: (paperId: string) => Promise<void>
  onUpload: (files: File[]) => void
  uploading: boolean
  uploadQueue: Array<{ name: string; status: 'waiting' | 'uploading' | 'done' | 'failed'; message?: string }>
  loading: boolean
  error: string
  onRetry: () => void
  onSelectMany: (ids: string[]) => void
  onClearSelection: () => void
  disabled?: boolean
}

/** 预处理状态徽章 */
function StatusBadge({ status, label }: { status: PreprocessStatus; label: string }) {
  const cls = status === 'done' ? 'status-done' : status === 'failed' ? 'status-failed' : 'status-pending'
  const text = status === 'done' ? '✓' : status === 'failed' ? '✕' : '○'
  return (
    <span className={`status-badge ${cls}`} title={`${label}: ${status}`}>
      {label} {text}
    </span>
  )
}

export default function PaperLibrary({
  fileInputRef,
  papers,
  selectedIds,
  onToggleSelect,
  onDelete,
  onUpload,
  uploading,
  uploadQueue, loading, error, onRetry, onSelectMany, onClearSelection,
  disabled = false,
}: PaperLibraryProps) {
  const [deleteTarget, setDeleteTarget] = useState<Paper | null>(null)
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const blocked = disabled || uploading || loading || Boolean(error)
  const visiblePapers = papers.filter(paper => `${paper.title} ${paper.filename}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      setQuery('')
      onUpload(files)
      // 重置 input 以便重复上传同一文件
      e.target.value = ''
    }
  }

  return (
    <div className={`paper-library${dragging ? ' upload-dragging' : ''}`}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        if (disabled || uploading) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled || uploading ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={event => {
        const files = Array.from(event.dataTransfer.files)
        if (!files.length) return
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        if (disabled || uploading) return
        setQuery('')
        onUpload(files)
      }}>
      <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleFileChange}
        hidden disabled={uploading || disabled} />
      {papers.length === 0 && <div className="upload-area">
        <button
          type="button"
          className="btn btn-upload"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || disabled}
        >
          {uploading ? <><span className="spinner" /> 上传中...</> : <span><strong>＋ 添加论文</strong><small>{dragging ? '松开以上传文件' : '点击或拖入 PDF · 支持批量上传'}</small></span>}
        </button>
      </div>}
      {uploadQueue.length > 0 && <details className="upload-results" open>
        <summary>上传记录 · 成功 {uploadQueue.filter(item => item.status === 'done').length} / {uploadQueue.length}</summary>
        <ul aria-live="polite">{uploadQueue.map((item, index) => <li key={index} className={`upload-result-${item.status}`}>
          <span title={item.name}>{item.name}</span>
          <small>{item.message || (item.status === 'uploading' ? '上传中…' : '等待上传')}</small>
        </li>)}</ul>
      </details>}
      {papers.length > 0 && <>
        <input type="search" className="path-input" placeholder="搜索标题或文件名" aria-label="搜索论文" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="library-actions"><span>{visiblePapers.length} 篇 · 已选 {selectedIds.size}</span>
          <button className="text-action" disabled={blocked || !visiblePapers.length} onClick={() => onSelectMany(visiblePapers.map(paper => paper.paper_id))}>全选结果</button>
          <button className="text-action" disabled={blocked || !selectedIds.size} onClick={onClearSelection}>清空选择</button>
        </div>
      </>}
      {loading && <p className="library-feedback" role="status">正在加载论文库…</p>}
      {error && <div className="library-feedback library-feedback-error" role="alert"><p>{error}</p><button className="text-action" disabled={loading || uploading || disabled} onClick={onRetry}>重新加载</button></div>}

      {/* 论文列表 */}
      <div className="paper-list">
        {!loading && !error && papers.length === 0 ? (
          <p className="empty-hint">暂无论文，请上传 PDF 文件</p>
        ) : (
          visiblePapers.map((paper) => {
            const selected = selectedIds.has(paper.paper_id)
            const checkboxId = `paper-selection-${paper.paper_id}`
            const allDone =
              paper.parse_status === 'done' &&
              paper.extract_status === 'done' &&
              paper.index_status === 'done'
            return (
              <div
                key={paper.paper_id}
                className={`paper-item ${selected ? 'selected' : ''} ${blocked ? 'disabled' : ''}`}
              >
                <label className="paper-checkbox">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={selected}
                    aria-label={`选择论文：${paper.title || paper.filename}`}
                    onChange={() => onToggleSelect(paper.paper_id)}
                    disabled={blocked}
                  />
                </label>
                <div className="paper-info">
                  <label className="paper-title" htmlFor={checkboxId} title={paper.title || paper.filename}>
                    {paper.title || paper.filename}
                  </label>
                  <span className="paper-filetype" title={paper.filename}>PDF</span>
                  <details className="paper-status-details"><summary>
                    <span className={`status-badge ${[paper.parse_status, paper.extract_status, paper.index_status].includes('failed') ? 'status-failed' : allDone ? 'status-cached' : 'status-pending'}`}>
                      {[paper.parse_status, paper.extract_status, paper.index_status].includes('failed') ? '处理失败' : allDone ? '已预处理' : '待分析'}
                    </span>
                  </summary><div className="paper-status">
                    <StatusBadge status={paper.parse_status} label="解析" />
                    <StatusBadge status={paper.extract_status} label="抽取" />
                    <StatusBadge status={paper.index_status} label="索引" />
                  </div></details>
                </div>
                <button
                  className="btn-icon btn-delete"
                  onClick={() => setDeleteTarget(paper)}
                  disabled={blocked}
                  title="删除论文"
                  aria-label={`删除论文：${paper.title || paper.filename}`}
                >
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>
      {!loading && !error && papers.length > 0 && !visiblePapers.length && <p className="empty-hint">没有匹配的论文，试试其他关键词。</p>}

      {selectedIds.size > 0 && (
        <div className="selected-count">已选择 {selectedIds.size} 篇论文</div>
      )}
      {deleteTarget && (
        <DeleteDialog title="删除论文？" onClose={() => setDeleteTarget(null)}
          onConfirm={() => onDelete(deleteTarget.paper_id)}>
          「{deleteTarget.title || deleteTarget.filename}」会从论文库移除。
          {deleteTarget.source === 'upload'
            ? '项目内的 PDF 副本和预处理缓存将一并删除。'
            : '项目会移除预处理缓存，文件夹中的原始 PDF 会保留。'}
        </DeleteDialog>
      )}
    </div>
  )
}
