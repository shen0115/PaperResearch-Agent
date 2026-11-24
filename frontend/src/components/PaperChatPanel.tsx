import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import ChatModelPicker from './ChatModelPicker'
import type { Paper, PaperChatSource, PaperChatTurn, ReasoningEffort } from '../types'
import type { usePaperChat } from '../usePaperChat'

type ChatState = ReturnType<typeof usePaperChat>

const singlePaperExamples = ['这篇论文用了哪些评估指标？', '这篇论文的方法是什么？']
const multiplePaperExamples = ['这些论文用了哪些评估指标？', '它们的方法有什么区别？']

export function PaperChatHistory({ state, onOpen, onNew, onResume, libraryLoading }: {
  state: ChatState
  onOpen: (id: string) => void
  onNew: () => void
  onResume: (id: string) => void
  libraryLoading: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const busy = state.opening || Boolean(state.pendingQuestion)
  const resume = state.chat
    ? state.unsentDrafts.find(([id]) => id === state.draftId) ?? state.unsentDrafts[state.unsentDrafts.length - 1]
    : undefined
  const closeOnNarrowScreen = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setExpanded(false)
  }
  return (
    <section className="qa-history" aria-labelledby="qa-history-title">
      <header>
        <h2 id="qa-history-title">
          <button type="button" className="qa-history-toggle" aria-expanded={expanded}
            aria-controls="qa-history-content" onClick={() => setExpanded(open => !open)}>问答记录</button>
        </h2>
        <div className="qa-history-actions">
          {resume && <button type="button" className="text-action" disabled={busy || libraryLoading}
            onClick={() => { onResume(resume[0]); closeOnNarrowScreen() }}>继续草稿</button>}
          <button type="button" className="text-action" disabled={busy} onClick={() => {
            onNew()
            closeOnNarrowScreen()
          }}>＋ 新对话</button>
        </div>
      </header>
      <div id="qa-history-content" className="qa-history-content" hidden={!expanded}>
      {state.unsentDrafts.length > 0 && (
        <ul aria-label="未发送草稿">
          {state.unsentDrafts.map(([id, question]) => (
            <li key={id}>
              <button type="button" className="qa-history-row" disabled={busy || libraryLoading}
                aria-current={!state.chat && state.draftId === id ? 'true' : undefined}
                onClick={() => { onResume(id); closeOnNarrowScreen() }} title={question}>
                <span>{question}</span>
                <small>未发送草稿</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.historyState === 'loading' && !state.entries.length && <p>正在读取记录…</p>}
      {state.historyState === 'error' && (
        <p>记录加载失败 <button type="button" className="text-action" onClick={() => void state.loadHistory()}>重试</button></p>
      )}
      {state.historyState === 'ready' && !state.entries.length && <p>发出第一条问题后，对话会保存到这里。</p>}
      {state.entries.length > 0 && (
        <ul aria-label="已保存的问答对话">
          {state.entries.map(entry => (
            <li key={entry.id}>
              <button type="button" className="qa-history-row" disabled={busy || libraryLoading}
                aria-current={state.chat?.id === entry.id ? 'true' : undefined}
                onClick={() => { onOpen(entry.id); closeOnNarrowScreen() }} title={entry.title}>
                <span>{entry.title}</span>
                <small>{entry.papers.length} 篇 · {new Date(entry.updated_at).toLocaleDateString('zh-CN')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  )
}

function Turn({ turn }: { turn: PaperChatTurn }) {
  const [openSource, setOpenSource] = useState<number | null>(null)
  const sourceButtons = useRef(new Map<number, HTMLButtonElement>())
  const sources = new Map(turn.sources.map(source => [source.number, source]))
  const answer = turn.answer.replace(/\[(\d+)\]/g, (label, number) =>
    sources.has(Number(number)) ? `${label}(#source-${number})` : label
  )

  function revealSource(source: PaperChatSource) {
    setOpenSource(source.number)
    requestAnimationFrame(() => {
      const button = sourceButtons.current.get(source.number)
      button?.focus({ preventScroll: true })
      button?.scrollIntoView({ block: 'nearest' })
    })
  }

  return (
    <article className="qa-turn">
      <p className="qa-question">{turn.question}</p>
      <div className="markdown-body qa-answer">
        <ReactMarkdown disallowedElements={['img']} components={{
          a({ href, children }) {
            const match = href?.match(/^#source-(\d+)$/)
            const source = match ? sources.get(Number(match[1])) : undefined
            if (!source) return <>{children}</>
            return <button type="button" className="qa-citation" aria-label={`查看原文依据 ${source.number}`}
              onClick={() => revealSource(source)}>[{source.number}]</button>
          },
        }}>{answer}</ReactMarkdown>
      </div>
      {turn.model && <p className="qa-turn-model">模型 {turn.model}</p>}
      {turn.sources.length > 0 && (
        <section className="qa-sources" aria-label="原文依据">
          <h3>原文依据</h3>
          {turn.sources.map(source => (
            <div key={source.number}>
              <button type="button" className="qa-source-toggle" aria-expanded={openSource === source.number}
                ref={element => {
                  if (element) sourceButtons.current.set(source.number, element)
                  else sourceButtons.current.delete(source.number)
                }}
                onClick={() => setOpenSource(openSource === source.number ? null : source.number)}>
                <span>[{source.number}]</span> {source.title}
              </button>
              {openSource === source.number && (
                <blockquote>
                  {source.section && source.section.trim() !== source.title.trim() && <strong>{source.section}</strong>}
                  <p>{source.excerpt}</p>
                </blockquote>
              )}
            </div>
          ))}
        </section>
      )}
    </article>
  )
}

export default function PaperChatPanel({
  state, selectedIds, papers, available, model, requestedModel, effort, modelRevision, onModelChange, onEffortChange,
  onTogglePaper, onUpload, uploading, onNew, onAnswered,
}: {
  state: ChatState
  selectedIds: Set<string>
  papers: Paper[]
  available: boolean
  model: string
  requestedModel?: string
  effort?: ReasoningEffort
  modelRevision: number
  onModelChange: (model: string) => void
  onEffortChange: (effort: ReasoningEffort) => void
  onTogglePaper: (id: string) => void
  onUpload: (files: File[]) => void
  uploading: boolean
  onNew: () => void
  onAnswered: () => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const paperPicker = useRef<HTMLDetailsElement>(null)
  const paperOptions = useRef<HTMLDivElement>(null)
  const paperScopeButton = useRef<HTMLButtonElement>(null)
  const [paperPickerOpen, setPaperPickerOpen] = useState(false)
  const count = selectedIds.size
  const examples = count === 1 ? singlePaperExamples : multiplePaperExamples
  const hasContent = Boolean(state.chat || state.pendingQuestion)
  const changed = Boolean(state.chat && (
    state.chat.papers.length !== count || state.chat.papers.some(paper => !selectedIds.has(paper.paper_id))
  ))
  const canWrite = !changed && !state.opening && !state.pendingQuestion
  const canSend = canWrite && count > 0 && available && Boolean(state.draft.trim())
  const needsPaper = canWrite && count === 0 && Boolean(state.draft.trim())

  useEffect(() => {
    const element = scroll.current
    if (element) element.scrollTop = element.scrollHeight
  }, [state.chat, state.pendingQuestion])

  useEffect(() => {
    function closePaperPicker(event: PointerEvent) {
      const picker = paperPicker.current
      if (picker?.open && event.target instanceof Node &&
        !picker.contains(event.target) && !paperScopeButton.current?.contains(event.target)) picker.open = false
    }
    document.addEventListener('pointerdown', closePaperPicker)
    return () => document.removeEventListener('pointerdown', closePaperPicker)
  }, [])

  useLayoutEffect(() => {
    const picker = paperPicker.current
    const menu = paperOptions.current
    const trigger = picker?.querySelector('summary')
    if (!paperPickerOpen || !picker || !menu || !trigger) return

    const frame = picker.closest('.app-body')
    function fitMenu() {
      if (!menu || !trigger) return
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
      const clip = frame && getComputedStyle(frame).overflowY !== 'visible' ? frame.getBoundingClientRect() : null
      const top = Math.max(viewportTop, clip?.top ?? viewportTop)
      const bottom = Math.min(viewportBottom, clip?.bottom ?? viewportBottom)
      const anchor = trigger.getBoundingClientRect()
      const above = Math.max(0, anchor.top - top - 15)
      const below = Math.max(0, bottom - anchor.bottom - 15)
      const list = menu.querySelector('ul')
      const fullHeight = Math.min(340, menu.offsetHeight + (list ? list.scrollHeight - list.offsetHeight : 0))
      const opensBelow = below >= fullHeight || below >= above
      menu.dataset.placement = opensBelow ? 'below' : 'above'
      menu.style.maxHeight = `${Math.min(340, opensBelow ? below : above)}px`
    }

    fitMenu()
    const observer = new ResizeObserver(fitMenu)
    observer.observe(trigger)
    if (frame) observer.observe(frame)
    const composer = picker.closest('.qa-compose')
    if (composer) observer.observe(composer)
    window.addEventListener('resize', fitMenu)
    window.addEventListener('scroll', fitMenu, true)
    window.visualViewport?.addEventListener('resize', fitMenu)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fitMenu)
      window.removeEventListener('scroll', fitMenu, true)
      window.visualViewport?.removeEventListener('resize', fitMenu)
    }
  }, [paperPickerOpen, papers.length])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return
    if (await state.send([...selectedIds], effort ? model : requestedModel, effort)) onAnswered()
  }

  return (
    <section className={`qa-panel${hasContent ? '' : ' qa-panel-empty'}`} aria-label="论文问答">
      {hasContent && (
        <div className="qa-scroll" ref={scroll}>
          <div className="qa-thread" aria-live="polite">
            {state.chat?.turns.map(turn => <Turn key={turn.id} turn={turn} />)}
            {state.pendingQuestion && (
              <div className="qa-turn">
                <p className="qa-question">{state.pendingQuestion}</p>
                <p className="qa-status" role="status">正在准备论文资料并生成回答…</p>
              </div>
            )}
          </div>
        </div>
      )}
      {!hasContent && !state.opening && (
        <header className="qa-welcome">
          <h1>今天从哪里开始？</h1>
        </header>
      )}
      {state.opening && <p className="qa-status qa-feedback" role="status">正在打开对话…</p>}
      <div className="qa-compose">
        {changed && (
          <div className="qa-scope-note">
            <p>此对话的论文范围已固定。原范围：{state.chat?.papers.map(paper => paper.title).join('、')}</p>
            <button type="button" className="text-action" onClick={onNew} disabled={Boolean(state.pendingQuestion)}>用当前选择开启新对话</button>
          </div>
        )}
        {state.error && <p className="qa-error" role="alert">{state.error}</p>}
        {count > 0 && (
          <button type="button" className="qa-selected" ref={paperScopeButton}
            aria-controls="qa-paper-options" aria-expanded={paperPickerOpen}
            onClick={() => {
              const picker = paperPicker.current
              if (picker) picker.open = !picker.open
              if (picker?.open) picker.querySelector('summary')?.focus()
            }}>已选 {count} 篇</button>
        )}
        <form className="qa-input" onSubmit={submit}>
            <details className="qa-selection" ref={paperPicker}
              onToggle={event => setPaperPickerOpen(event.currentTarget.open)}
              onBlur={event => {
                if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) &&
                  !paperScopeButton.current?.contains(event.relatedTarget)) event.currentTarget.open = false
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return
                event.preventDefault()
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }}>
              <summary className="qa-selection-trigger" aria-label="选择或上传论文" title="选择或上传论文">
                <span aria-hidden="true">+</span>
              </summary>
              <div className="qa-selection-list" id="qa-paper-options" ref={paperOptions} role="group" aria-label="选择问答论文">
                <label className="qa-selection-upload">
                  <span>{uploading ? '正在上传…' : '＋ 上传 PDF'}</span>
                  <input type="file" accept=".pdf,application/pdf" multiple aria-label="上传 PDF"
                    disabled={uploading} onChange={event => {
                      const files = Array.from(event.currentTarget.files ?? [])
                      event.currentTarget.value = ''
                      if (files.length) onUpload(files)
                    }} />
                </label>
                {papers.length ? (
                  <>
                  <p className="qa-selection-heading">从论文库选择 · {papers.length} 篇</p>
                  <ul aria-label="已上传论文">
                    {papers.map(paper => (
                      <li key={paper.paper_id}>
                        <label>
                          <input type="checkbox" checked={selectedIds.has(paper.paper_id)}
                            disabled={!available || state.opening} onChange={() => onTogglePaper(paper.paper_id)} />
                          <span>{paper.title || paper.filename}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  </>
                ) : <p>论文库还是空的。</p>}
              </div>
            </details>
            <textarea ref={input} value={state.draft} rows={1} maxLength={4000}
              aria-label="关于论文的问题" placeholder="问问论文…"
              aria-describedby={needsPaper ? 'qa-paper-required' : undefined}
              onCompositionStart={() => { composing.current = true }}
              onCompositionEnd={() => { composing.current = false }}
              onBlur={() => { composing.current = false }}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
                if (composing.current || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit()
              }}
              onChange={event => state.setDraft(event.target.value)} disabled={!canWrite} />
            <div className="qa-input-actions">
              <ChatModelPicker key={modelRevision} model={model} effort={effort}
                disabled={state.opening || Boolean(state.pendingQuestion)}
                onChange={onModelChange} onEffortChange={onEffortChange} />
              <button type="submit" className="btn btn-primary qa-send" aria-label="发送" title="发送（Enter）"
                aria-keyshortcuts="Enter" disabled={!canSend}>
                <span className="qa-send-arrow" aria-hidden="true" />
              </button>
            </div>
        </form>
        {needsPaper && (
          <p id="qa-paper-required" className="qa-status qa-draft-hint" role="status">勾选至少一篇论文后即可发送。</p>
        )}
        {!hasContent && count > 0 && (
          <div className="qa-examples">
            {examples.map(example => (
              <button type="button" key={example} disabled={!canWrite} onClick={() => {
                state.setDraft(example)
                input.current?.focus()
              }}>{example}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
