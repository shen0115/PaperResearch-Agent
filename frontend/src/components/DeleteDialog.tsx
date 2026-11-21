import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export default function DeleteDialog({ title, children, onConfirm, onClose }: {
  title: string
  children: ReactNode
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
    cancel.current?.focus()
  }, [])

  function dismiss() {
    dialog.current?.close()
    onClose()
  }

  async function confirm() {
    if (deleting) return
    setDeleting(true)
    setError('')
    try {
      await onConfirm()
      dismiss()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '删除失败，请重试。')
      setDeleting(false)
    }
  }

  return (
    <dialog ref={dialog} className="model-dialog delete-dialog" aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => {
        event.preventDefault()
        if (!deleting) dismiss()
      }}>
      <div className="model-dialog-header"><h2 id={titleId}>{title}</h2></div>
      <div className="delete-dialog-content">
        <p id={descriptionId}>{children}</p>
        {error && <p className="model-error" role="alert">{error}</p>}
        <div className="delete-dialog-actions">
          <button ref={cancel} type="button" className="btn btn-secondary" disabled={deleting}
            onClick={dismiss}>取消</button>
          <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void confirm()}>
            {deleting ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
