import { useEffect, useState } from 'react'
import { discoverModels, getModelSettings } from '../api'
import type { ReasoningEffort } from '../types'
import ModelOptions from './ModelOptions'

export default function ChatModelPicker({ model, effort, disabled, onChange, onEffortChange }: {
  model: string
  effort?: ReasoningEffort
  disabled: boolean
  onChange: (model: string) => void
  onEffortChange: (effort: ReasoningEffort) => void
}) {
  const [requested, setRequested] = useState(false)
  const [retry, setRetry] = useState(0)
  const [models, setModels] = useState<string[]>([])
  const [efforts, setEfforts] = useState<Record<string, ReasoningEffort[]>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading')

  useEffect(() => {
    let active = true

    async function loadModels() {
      setStatus('loading')
      try {
        const settings = await getModelSettings()
        if (!active) return
        if (!settings.configured) {
          setStatus('unconfigured')
          return
        }
        setEfforts({ [settings.model]: settings.reasoning_efforts ?? [] })
        if (!requested) return
        const result = await discoverModels({ base_url: settings.base_url })
        if (!active) return
        setModels(result.models)
        setEfforts(previous => ({ ...previous, ...result.reasoning_efforts }))
        setStatus('ready')
      } catch {
        if (active) setStatus('error')
      }
    }

    void loadModels()
    return () => { active = false }
  }, [requested, retry])

  return (
    <ModelOptions label="问答模型" model={model} models={models} effort={effort} efforts={efforts[model]}
      disabled={disabled} onOpen={() => setRequested(true)} onModelChange={onChange} onEffortChange={onEffortChange}
      status={<>
        {status === 'loading' && <p role="status">正在获取模型…</p>}
        {status === 'unconfigured' && <p>请先在「模型设置」配置 API Key。</p>}
        {status === 'error' && (
          <p role="status">模型列表加载失败。 <button type="button" className="text-action"
            onClick={() => setRetry(value => value + 1)}>重试</button></p>
        )}
      </>} />
  )
}
