import { useCallback, useEffect, useState } from 'react'
import { discoverModels, getModelSettings, saveModelSettings } from '../api'
import type { ModelSettings } from '../types'

export default function ModelPicker({ model, revision, disabled, onChange, onSavingChange }: {
  model: string
  revision: number
  disabled: boolean
  onChange: (model: string) => void
  onSavingChange: (saving: boolean) => void
}) {
  const [config, setConfig] = useState<ModelSettings | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      setSaveError('')
      setModels([])
      try {
        const settings = await getModelSettings()
        if (cancelled) return
        setConfig(settings)
        if (!settings.configured) return
        const result = await discoverModels({ base_url: settings.base_url })
        if (!cancelled) setModels(result.models)
      } catch {
        if (!cancelled) setLoadError('模型列表加载失败。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [revision, retry])

  const select = useCallback(async (name: string) => {
    if (!config || name === config.model) return
    setSaving(true)
    onSavingChange(true)
    setSaveError('')
    try {
      const updated = await saveModelSettings({
        base_url: config.base_url,
        model: name,
        input_price: null,
        output_price: null,
        currency: config.currency,
      })
      setConfig(updated)
      onChange(updated.model)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存模型失败，请重试。')
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }, [config, onChange, onSavingChange])

  const current = model || config?.model || ''
  const choices = [...new Set([current, ...models].filter(Boolean))]

  return (
    <div className="model-picker">
      <div className="model-picker-heading">
        <label htmlFor="analysis-model">分析模型</label>
        {config?.configured && (
          <span className={config.compatibility ? `compatibility-${config.compatibility.status}` : undefined}
            title={config.compatibility?.message ?? '可在模型设置中测试抽取兼容性'}>
            {config.compatibility?.status === 'passed' ? '抽取测试已通过'
              : config.compatibility?.status === 'incompatible' ? '抽取测试未通过' : '抽取尚未测试'}
          </span>
        )}
      </div>
      <select
        id="analysis-model"
        value={current}
        disabled={disabled || loading || saving || !models.length}
        onChange={event => void select(event.target.value)}
        aria-describedby="analysis-model-status"
      >
        {choices.length === 0 && <option value="">选择模型</option>}
        {choices.map(choice => <option key={choice} value={choice} title={choice}>{choice}</option>)}
      </select>
      <div id="analysis-model-status" className="model-picker-status">
        {loading && <span role="status">正在获取模型…</span>}
        {saving && <span role="status">正在保存…</span>}
        {!loading && !loadError && !config?.configured && <span>请在右上角「模型设置」配置 API Key。</span>}
        {loadError && (
          <>
            <span role="status">{loadError}</span>
            <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
          </>
        )}
        {saveError && <span role="alert">{saveError}</span>}
      </div>
    </div>
  )
}
