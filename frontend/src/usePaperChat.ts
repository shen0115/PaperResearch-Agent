import { useCallback, useEffect, useRef, useState } from 'react'
import { askPaperChat, getPaperChat, listPaperChats } from './api'
import type { PaperChat, PaperChatSummary, ReasoningEffort } from './types'

interface Submission {
  chatId: string
  turnId: string
  question: string
  scope: string
  model?: string
  effort?: ReasoningEffort
}

export function usePaperChat() {
  const [entries, setEntries] = useState<PaperChatSummary[]>([])
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [chat, setChat] = useState<PaperChat | null>(null)
  const [draftId, setDraftId] = useState('draft:initial')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState('')
  const submission = useRef<Submission | null>(null)
  const busy = useRef(false)
  const historyRequest = useRef(0)
  const composerId = chat?.id ?? draftId
  const draft = drafts[composerId] ?? ''
  const unsentDrafts = Object.entries(drafts).filter(([id, question]) => id.startsWith('draft:') && question.trim())

  function writeDraft(id: string, question: string) {
    setDrafts(previous => {
      if (question) return { ...previous, [id]: question }
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  function setDraft(question: string) {
    writeDraft(composerId, question)
  }

  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current
    setHistoryState('loading')
    try {
      const result = await listPaperChats()
      if (request !== historyRequest.current) return
      setEntries(result.conversations)
      setHistoryState('ready')
    } catch {
      if (request === historyRequest.current) setHistoryState('error')
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    return () => { historyRequest.current += 1 }
  }, [loadHistory])

  function showDraft(id: string, initialQuestion?: string) {
    if (busy.current) return false
    setChat(null)
    setDraftId(id)
    if (initialQuestion) writeDraft(id, initialQuestion)
    setError('')
    submission.current = null
    return true
  }

  async function openChat(id: string) {
    if (busy.current) return
    busy.current = true
    setOpening(true)
    setError('')
    try {
      const result = await getPaperChat(id)
      setChat(result)
      submission.current = null
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开对话。')
    } finally {
      busy.current = false
      setOpening(false)
    }
  }

  async function send(paperIds: string[], model?: string, effort?: ReasoningEffort) {
    const question = draft.trim()
    if (busy.current || !question || !paperIds.length) return false
    const scope = JSON.stringify([...paperIds].sort())
    let attempt = submission.current
    if (!attempt || attempt.question !== question || attempt.scope !== scope || attempt.model !== model || attempt.effort !== effort) {
      attempt = { chatId: chat?.id ?? crypto.randomUUID(), turnId: crypto.randomUUID(), question, scope, model, effort }
      submission.current = attempt
    }
    busy.current = true
    setError('')
    setPendingQuestion(question)
    try {
      const result = await askPaperChat(attempt.chatId, {
        turn_id: attempt.turnId, question, paper_ids: paperIds, expected_turns: chat?.turns.length ?? 0,
        model: attempt.model, reasoning_effort: attempt.effort,
      })
      setChat(result)
      setDraft('')
      submission.current = null
      const { id, title, papers, updated_at } = result
      setEntries(previous => [{ id, title, papers, updated_at }, ...previous.filter(entry => entry.id !== id)])
      void loadHistory()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试。')
      return false
    } finally {
      busy.current = false
      setPendingQuestion('')
    }
  }

  return { entries, historyState, loadHistory, chat, draft, draftId, unsentDrafts, setDraft, error, opening, pendingQuestion, showDraft, openChat, send }
}
