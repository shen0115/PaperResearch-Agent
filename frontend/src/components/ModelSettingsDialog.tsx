import { useRef, useState } from 'react'
import { discoverModels, getModelSettings, saveModelSettings, testModelCompatibility } from '../api'
import type { ModelSettings } from '../types'

interface Props {
  onSave: (settings: ModelSettings) => void
}

export default function ModelSettingsDialog({ onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saved, setSaved] = useState<ModelSettings | null>(null)
  const [url, setUrl] = useState('https://api.deepseek.com')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [compatibilityError, setCompatibilityError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const usingSavedConnection = saved?.base_url === url.trim().replace(/\/+$/, '') && !key

  function apply(settings: ModelSettings) {
    setSaved(settings)
    setUrl(settings.base_url)
    setKey('')
    setCompatibilityError('')
  }

  async function open() {
    setBusy(true)
    setModels([])
    setNotice('')
    setError('')
    dialog.current?.showModal()
    try {
      apply(await getModelSettings())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function changeConnection(setter: (value: string) => void, value: string) {
    setter(value)
    setModels([])
    setNotice('')
    setError('')
  }

  async function fetchModels() {
    if (busy || testing) return
    setBusy(true)
    setModels([])
    setError('')
    setNotice('')
    try {
      const result = await discoverModels({ base_url: url, api_key: key || undefined })
      setModels(result.models)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function persist(model: string) {
    if (busy || testing) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const config = await saveModelSettings({
        base_url: url,
        api_key: key || undefined,
        model,
        input_price: null,
        output_price: null,
        currency: 'CNY',
      })
      apply(config)
      onSave(config)
      setNotice('已保存到本机。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function testCompatibility() {
    if (!saved || busy || testing) return
    setTesting(true)
    setCompatibilityError('')
    try {
      const result = await testModelCompatibility(saved)
      const updated = { ...saved, compatibility: result }
      setSaved(updated)
      onSave(updated)
    } catch (err) {
      setCompatibilityError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const controlsDisabled = busy || testing

  return (
    <>
      <button type="button" className="theme-toggle model-settings-trigger" disabled={testing} onClick={() => void open()}>
        模型设置
      </button>
      <dialog ref={dialog} className="model-dialog" aria-labelledby="model-dialog-title" onClose={() => setKey('')}>
        <div className="model-dialog-header">
          <h2 id="model-dialog-title">模型设置</h2>
          <button type="button" className="btn-icon" aria-label="关闭模型设置" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <form className="model-dialog-form" onSubmit={(event) => { event.preventDefault(); void fetchModels() }}>
          <label>Base URL
            <input type="url" required value={url} disabled={controlsDisabled} onChange={e => changeConnection(setUrl, e.target.value)} />
          </label>
          <label>API Key
            <input type="password" value={key} autoComplete="off" spellCheck={false} disabled={controlsDisabled}
              placeholder={usingSavedConnection && saved?.configured ? '••••••••  已配置，留空继续使用' : '输入此服务的 API Key'}
              onChange={e => changeConnection(setKey, e.target.value)} />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={controlsDisabled}>获取模型</button>
          {models.length > 0 && (
            <label>选择模型
              <select value={usingSavedConnection && models.includes(saved?.model ?? '') ? saved?.model : ''} disabled={controlsDisabled}
                onChange={e => { if (e.target.value) void persist(e.target.value) }}>
                <option value="" disabled>选择后自动保存</option>
                {models.map(model => <option key={model}>{model}</option>)}
              </select>
            </label>
          )}
        </form>
        {saved?.configured && usingSavedConnection && (
          <section className="model-compatibility" aria-labelledby="model-compatibility-title">
            <h3 id="model-compatibility-title">抽取兼容性 <span>{saved.model}</span></h3>
            <p>使用合成样例发起一次短请求，可能产生少量用量。</p>
            <div className="model-compatibility-result" role="status">
              {saved.compatibility ? (
                <>
                  <strong className={`compatibility-${saved.compatibility.status}`}>
                    {saved.compatibility.status === 'passed' ? '已通过' : '未通过'}
                  </strong>
                  <span>{saved.compatibility.message}</span>
                  <time dateTime={saved.compatibility.tested_at}>{new Date(saved.compatibility.tested_at).toLocaleString('zh-CN')}</time>
                </>
              ) : <span>当前配置尚未测试。</span>}
            </div>
            {compatibilityError && <p className="compatibility-incompatible" role="alert">{compatibilityError}</p>}
            <button type="button" className="btn btn-secondary" disabled={controlsDisabled} onClick={() => void testCompatibility()}>
              {testing ? '正在测试…' : saved.compatibility ? '重新测试' : '测试兼容性'}
            </button>
          </section>
        )}
        {busy && <p className="model-notice" role="status">正在连接…</p>}
        {error && <p className="model-notice model-error" role="alert">{error}</p>}
        {notice && <p className="model-notice" role="status">{notice}</p>}
      </dialog>
    </>
  )
}
