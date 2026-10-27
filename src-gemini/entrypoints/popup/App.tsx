import { useEffect, useState } from 'react';
import {
  DEFAULT_GEMINI_SETTINGS,
  GEMINI_MODEL_OPTIONS,
  type GeminiSettings,
} from '../../core/settings';

async function send(type: string, fields: Record<string, unknown> = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response?.ok) throw new Error(response?.error || 'Extension không phản hồi.');
  return response.data;
}

export default function App() {
  const [settings, setSettings] = useState<GeminiSettings>(DEFAULT_GEMINI_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<GeminiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  useEffect(() => {
    send('settings-secret')
      .then((value) => {
        setSettings(value);
        setSavedSettings(value);
        setLoaded(true);
      })
      .catch((error) => setToast({ message: error.message, type: 'error' }));
  }, []);
  const update = <K extends keyof GeminiSettings>(key: K, value: GeminiSettings[K]) => {
    setToast(null);
    setSettings((previous) => ({ ...previous, [key]: value }));
  };
  async function saveCurrentSettings() {
    await send('settings-save', { settings });
    setSavedSettings(settings);
  }
  async function saveIfChanged() {
    if (JSON.stringify(settings) !== JSON.stringify(savedSettings)) await saveCurrentSettings();
  }
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setToast(null);
    try {
      await action();
      setToast({ message, type: 'success' });
    } catch (error: any) {
      setToast({ message: error.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function command(type: string) {
    if (['live', 'video', 'start-page'].includes(type)) await saveIfChanged();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error('Chưa chọn trang để dịch.');
    if (type === 'video') {
      const frames = await send('scan', { tabId: tab.id });
      const frame = frames.find((item: any) => item.videos?.length);
      if (!frame) throw new Error('Chưa tìm thấy video.');
      return send('command', {
        tabId: tab.id,
        frameId: frame.frameId,
        command: { type: 'start-video', videoId: frame.videos[0].id },
      });
    }
    if (type === 'live')
      return chrome.tabs.sendMessage(tab.id, { type: 'toggle-mode', mode: 'live' }, { frameId: 0 });
    return send('command', { tabId: tab.id, command: { type } });
  }
  return (
    <div className="popup-container">
      <div className="header">
        <div className="brand">
          <img src="/logo.svg" alt="" />
          <h1>Gemini Translator</h1>
        </div>
      </div>
      <div className="card">
        <div className="field">
          <label className="field-label" htmlFor="api-key">
            Gemini API key
          </label>
          <input
            id="api-key"
            className="select"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder="Nhập API key của bạn"
          />
          <p className="hint">
            Key lưu trên máy này. Nội dung và audio được gửi tới Gemini; API có thể phát sinh phí.
            {' '}Kiểm tra thành công sẽ lưu key và cấu hình đang chọn.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="test-btn"
            disabled={busy || !loaded || !settings.apiKey.trim()}
            onClick={() =>
              void run(
                async () => {
                  await send('gemini-validate', { settings });
                  await saveIfChanged();
                },
                settings.mode === 'live' || !settings.textEnabled
                  ? 'Kết nối Gemini Live thành công. Đã lưu cấu hình; audio được kiểm tra khi bật Live.'
                  : 'Kết nối model dịch thành công. Đã lưu cấu hình. TTS và Live được kiểm tra khi sử dụng.',
              )
            }
          >
            Kiểm tra kết nối
          </button>
          <button
            className="test-btn"
            disabled={busy || !loaded}
            onClick={() =>
              void run(async () => {
                const cleared = { ...settings, apiKey: '' };
                await send('settings-save', { settings: cleared });
                setSettings(cleared);
                setSavedSettings(cleared);
              }, 'Đã xóa API key và dừng phiên đang chạy.')
            }
          >
            Xóa key
          </button>
        </div>
      </div>
      <div className="tabs">
        <button
          className={`tab-btn ${settings.mode === 'subtitles' ? 'active' : ''}`}
          onClick={() => update('mode', 'subtitles')}
        >
          Phụ đề Gemini
        </button>
        <button
          className={`tab-btn ${settings.mode === 'live' ? 'active' : ''}`}
          onClick={() => update('mode', 'live')}
        >
          Gemini Live
        </button>
      </div>
      <div className="card">
        <label>
          <input
            id="text-enabled"
            type="checkbox"
            checked={settings.textEnabled}
            onChange={(event) => update('textEnabled', event.target.checked)}
          />{' '}
          Bật model dịch text
        </label>
        <p className="hint">
          Tắt để không dùng quota model text cho dịch trang và dịch/sửa phụ đề. Gemini Live vẫn hoạt
          động; phụ đề transcript Live không cần Flash Lite. Bấm Lưu & Áp dụng sau khi đổi.
        </p>
        {(['textModel', 'ttsModel', 'liveModel'] as const).map((field) => (
          <div className="field" key={field}>
            <label
              className="field-label"
              htmlFor={field === 'liveModel' ? `${field}-preset` : field}
            >
              Model {field === 'textModel' ? 'dịch' : field === 'ttsModel' ? 'TTS' : 'Live'}
            </label>
            <select
              className="select"
              id={`${field}-preset`}
              disabled={field === 'textModel' && !settings.textEnabled}
              aria-label={`Chọn model ${field}`}
              value={
                GEMINI_MODEL_OPTIONS[field].some((option) => option.value === settings[field])
                  ? settings[field]
                  : ''
              }
              onChange={(event) => {
                if (event.target.value) update(field, event.target.value);
                else document.getElementById(field)?.focus();
              }}
            >
              {GEMINI_MODEL_OPTIONS[field].map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={'disabled' in option && option.disabled}
                >
                  {option.label}
                </option>
              ))}
              {field !== 'liveModel' && (
                <option value="">Tên model tùy chỉnh (nhập bên dưới)</option>
              )}
            </select>
            {field !== 'liveModel' && (
              <input
                className="select"
                id={field}
                disabled={field === 'textModel' && !settings.textEnabled}
                value={settings[field]}
                onChange={(event) => update(field, event.target.value)}
              />
            )}
            {field === 'liveModel' && (
              <p className="hint">
                Live Translate chuyên dịch liên tục. Model Live hội thoại dùng chỉ dẫn dịch Việt, có
                thể khác về độ trễ và cách ngắt câu. Quyền truy cập/quota phụ thuộc key. Hai mục
                Transcribe bị khóa: chưa tích hợp luồng chép lời → dịch → TTS. Gemini 3 Flash Live
                dùng ID gemini-3.1-flash-live-preview.
              </p>
            )}
          </div>
        ))}
        {(settings.mode === 'subtitles' || !settings.liveModel.includes('live-translate')) && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="tts-voice">
                {settings.mode === 'live'
                  ? 'Giọng Gemini Live (giữ cùng lựa chọn khi kết nối lại)'
                  : 'Giọng Gemini TTS'}
              </label>
              <select
                id="tts-voice"
                className="select"
                value={settings.ttsVoice}
                onChange={(event) =>
                  update('ttsVoice', event.target.value as GeminiSettings['ttsVoice'])
                }
              >
                {['Aoede', 'Kore', 'Charon', 'Puck', 'Fenrir'].map((voice) => (
                  <option key={voice}>{voice}</option>
                ))}
              </select>
            </div>
            {settings.mode === 'subtitles' && (
              <label>
                <input
                  type="checkbox"
                  checked={settings.speechEnabled}
                  onChange={(event) => update('speechEnabled', event.target.checked)}
                />{' '}
                Đọc phụ đề tiếng Việt
              </label>
            )}
          </>
        )}
        {settings.mode === 'live' && (
          <p className="hint">
            Live nghe âm thanh tab và phát bản dịch Việt. Tạm dừng hoặc tua sẽ tạo phiên dịch mới.
            {settings.liveModel.includes('live-translate') &&
              ' Live Translate tự tái tạo giọng nguồn; giọng có thể đổi sau khoảng lặng. Muốn chọn một giọng cố định, dùng Gemini 3.8 Live hoặc Flash Live.'}
          </p>
        )}
      </div>
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      )}
      <button
        className="save-btn"
        disabled={busy || !loaded}
        onClick={() =>
          void run(
            saveCurrentSettings,
            'Đã lưu cài đặt và dừng phiên cũ. Bấm bật dịch để dùng cấu hình mới.',
          )
        }
      >
        {busy ? 'Đang xử lý…' : 'Lưu & Áp dụng'}
      </button>
      <div className="card" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          className="test-btn"
          disabled={busy || !loaded || !settings.textEnabled}
          onClick={() => void run(() => command('start-page'), 'Đang dịch trang.')}
        >
          Dịch trang
        </button>
        <button
          className="test-btn"
          disabled={busy || !loaded}
          onClick={() => void run(() => command('stop-page'), 'Đã khôi phục trang.')}
        >
          Khôi phục trang
        </button>
        <button
          className="test-btn"
          disabled={busy || !loaded}
          onClick={() =>
            void run(() => {
              if (settings.mode !== 'live' && !settings.textEnabled)
                throw new Error('Model dịch text đang tắt. Gemini Live vẫn dùng được.');
              return command(settings.mode === 'live' ? 'live' : 'video');
            }, 'Đã gửi lệnh dịch video.')
          }
        >
          {settings.mode === 'live' ? 'Bật/Tắt Live' : 'Dịch & đọc video'}
        </button>
        <button
          className="test-btn"
          disabled={busy || !loaded}
          onClick={() => void run(() => command('stop'), 'Đã dừng dịch.')}
        >
          Dừng
        </button>
      </div>
      <div className="footer">v0.1.0 • Gemini API</div>
    </div>
  );
}
