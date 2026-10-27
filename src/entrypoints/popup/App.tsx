import React, { useState, useEffect } from 'react';
import type { AppSettings, FeatureFlags, TranslationProvider, OfflineVoice } from '../../types/settings';
import type { LiveVoice } from '../../types/live';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { GEMINI_MODEL_OPTIONS } from '../../gemini/settings';
import './popup.css';

async function sendRuntime(type: string, fields: Record<string, unknown> = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (response && response.ok === false) {
    throw new Error(response.error || 'Extension không phản hồi.');
  }
  return response?.data ?? response;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    // 1. Load full settings
    sendRuntime('settings-secret')
      .then((data: AppSettings) => {
        if (data && typeof data === 'object') {
          setSettings((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});

    // 2. Health check
    chrome.runtime.sendMessage({ type: 'health' }, (response: any) => {
      if (response?.ok && (response.data?.ok || response.data?.configured !== false)) {
        setConnected(true);
      } else {
        setConnected(false);
      }
    });
  }, []);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setToast(null);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFlag = (flag: keyof FeatureFlags) => {
    setToast(null);
    setSettings((prev) => ({ ...prev, [flag]: !prev[flag] }));
  };

  const handleValidateGemini = async () => {
    if (!settings.apiKey.trim()) {
      setToast({ message: 'Vui lòng nhập Gemini API key trước.', type: 'error' });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      await sendRuntime('gemini-validate', { settings });
      setConnected(true);
      setToast({
        message: '✓ Kết nối Gemini thành công! Đang lưu cấu hình...',
        type: 'success',
      });
      await sendRuntime('settings-save', { settings });
    } catch (err: any) {
      setConnected(false);
      setToast({
        message: 'Lỗi kết nối Gemini: ' + (err?.message || 'Không hợp lệ'),
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndApply = async () => {
    setSaving(true);
    setToast(null);
    try {
      await sendRuntime('settings-save', { settings });
      setToast({ message: '✓ Đã lưu và áp dụng cài đặt mới!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: 'Lỗi khi lưu: ' + (err?.message || 'Không rõ'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestVoice = () => {
    const voiceToTest = settings.provider === 'gemini' ? settings.ttsVoice : settings.voice;
    chrome.runtime.sendMessage({
      type: 'speech-test',
      id: Date.now(),
      voice: voiceToTest,
    });
  };

  const executeCommand = async (commandType: string) => {
    setBusy(true);
    setToast(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Chưa chọn trang web.');

      if (commandType === 'live') {
        await chrome.tabs.sendMessage(tab.id, { type: 'toggle-mode', mode: 'live' }, { frameId: 0 });
        setToast({ message: 'Đã gửi lệnh bật/tắt Gemini Live.', type: 'success' });
        return;
      }

      if (commandType === 'video') {
        const frames = await sendRuntime('scan', { tabId: tab.id });
        const frame = Array.isArray(frames) ? frames.find((f: any) => f?.videos?.length) : null;
        if (!frame) throw new Error('Chưa tìm thấy video trên trang.');
        await sendRuntime('command', {
          tabId: tab.id,
          frameId: frame.frameId,
          command: { type: 'start-video', videoId: frame.videos[0].id },
        });
        setToast({ message: 'Đã bắt đầu dịch video.', type: 'success' });
        return;
      }

      await sendRuntime('command', { tabId: tab.id, command: { type: commandType } });
      if (commandType === 'start-page') setToast({ message: 'Đang dịch trang web...', type: 'success' });
      else if (commandType === 'stop-page') setToast({ message: 'Đã khôi phục trang gốc.', type: 'success' });
      else if (commandType === 'stop') setToast({ message: 'Đã dừng tất cả tác vụ dịch.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err?.message || 'Thao tác thất bại.', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const isGemini = settings.provider === 'gemini';

  return (
    <div className="popup-container">
      {/* 1. Header */}
      <div className="header">
        <div className="brand">
          <img src="/logo.svg" alt="Logo" />
          <h1>Translator • Song ngữ</h1>
        </div>
        <div className={`badge ${connected === true ? 'online' : connected === false ? 'offline' : ''}`}>
          <span className="dot" />
          <span>
            {connected === true
              ? isGemini ? 'Gemini Ready' : 'Server Online'
              : connected === false
                ? 'Mất kết nối'
                : 'Đang kiểm tra...'}
          </span>
        </div>
      </div>

      {/* 2. Provider Selection Tabs */}
      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${isGemini ? 'active' : ''}`}
          onClick={() => updateSetting('provider', 'gemini')}
        >
          <span>✨ Gemini API</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${!isGemini ? 'active' : ''}`}
          onClick={() => updateSetting('provider', 'local')}
        >
          <span>💻 Local Server</span>
        </button>
      </div>

      {/* 3. Provider Specific Settings Card */}
      {isGemini ? (
        <div className="card">
          <div className="card-title">Cấu hình Gemini Cloud</div>

          <div className="field">
            <label className="field-label" htmlFor="gemini-api-key">
              Gemini API Key
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="gemini-api-key"
                className="input-text"
                type={showApiKey ? 'text' : 'password'}
                autoComplete="off"
                placeholder="Dán AI Studio API key vào đây..."
                value={settings.apiKey}
                onChange={(e) => updateSetting('apiKey', e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0 8px', whiteSpace: 'nowrap' }}
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
            <p className="hint">Key lưu trong chrome.storage an toàn của máy. Không gửi ra ngoài.</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1 }}
              disabled={busy || !settings.apiKey.trim()}
              onClick={handleValidateGemini}
            >
              {busy ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
            </button>
            {settings.apiKey && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => updateSetting('apiKey', '')}
              >
                Xóa Key
              </button>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="gemini-voice">
              Giọng đọc (TTS & Live)
            </label>
            <select
              id="gemini-voice"
              className="select"
              value={settings.ttsVoice}
              onChange={(e) => updateSetting('ttsVoice', e.target.value as LiveVoice)}
            >
              <option value="Aoede">Aoede (Nữ êm dịu, tự nhiên)</option>
              <option value="Kore">Kore (Nữ rõ nét, chuẩn truyền cảm)</option>
              <option value="Charon">Charon (Nam trầm ấm, truyền cảm)</option>
              <option value="Puck">Puck (Nam trẻ trung, năng động)</option>
              <option value="Fenrir">Fenrir (Nam mạnh mẽ, dứt khoát)</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="gemini-text-model">
              Model dịch Text
            </label>
            <select
              id="gemini-text-model"
              className="select"
              value={settings.textModel}
              onChange={(e) => updateSetting('textModel', e.target.value)}
            >
              {GEMINI_MODEL_OPTIONS.textModel.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="gemini-live-model">
              Model Live Audio
            </label>
            <select
              id="gemini-live-model"
              className="select"
              value={settings.liveModel}
              onChange={(e) => updateSetting('liveModel', e.target.value)}
            >
              {GEMINI_MODEL_OPTIONS.liveModel.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">Cấu hình Local Backend</div>

          <div className="field">
            <label className="field-label" htmlFor="local-voice">
              Giọng đọc TTS Offline
            </label>
            <select
              id="local-voice"
              className="select"
              value={settings.voice}
              onChange={(e) => updateSetting('voice', e.target.value as OfflineVoice)}
            >
              <option value="auto">Tự động (Ưu tiên VieNeu AI 48kHz)</option>
              <option value="piper">Piper TTS (Nhẹ, phản hồi tức thì)</option>
              <option value="vieneu">VieNeu TTS (Chất lượng cao)</option>
            </select>
            <p className="hint">
              Chạy hoàn toàn trên máy tính cá nhân qua backend `./start.sh` (cổng 8765).
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-live-voice">
              Giọng Gemini Live (Backend proxy)
            </label>
            <select
              id="local-live-voice"
              className="select"
              value={settings.geminiVoice}
              onChange={(e) => updateSetting('geminiVoice', e.target.value as LiveVoice)}
            >
              <option value="Aoede">Aoede (Nữ êm dịu)</option>
              <option value="Kore">Kore (Nữ rõ nét)</option>
              <option value="Charon">Charon (Nam trầm ấm)</option>
              <option value="Puck">Puck (Nam trẻ trung)</option>
              <option value="Fenrir">Fenrir (Nam mạnh mẽ)</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-live-prompt">
              Chỉ dẫn phong cách giọng Live (System Instruction)
            </label>
            <textarea
              id="local-live-prompt"
              className="textarea"
              rows={2}
              value={settings.geminiPrompt}
              onChange={(e) => updateSetting('geminiPrompt', e.target.value)}
              placeholder="Chỉ dẫn ngữ điệu, phát âm tiếng Việt..."
            />
          </div>
        </div>
      )}

      {/* 4. Feature Flags Section (Bật / Tắt tính năng) */}
      <div className="card">
        <div className="card-title">
          <span>Tính năng (Feature Flags)</span>
          <span style={{ fontSize: 10, color: 'var(--accent-color)' }}>Bật / Tắt</span>
        </div>

        <div className="switch-list">
          <div className="switch-item">
            <div className="switch-info">
              <span className="switch-title">🌐 Dịch trang web song ngữ</span>
              <span className="switch-desc">Dịch văn bản bài viết, tài liệu khi cuộn trang</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.enablePageTranslation}
                onChange={() => toggleFlag('enablePageTranslation')}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <div className="switch-item">
            <div className="switch-info">
              <span className="switch-title">🎬 Phụ đề video song ngữ</span>
              <span className="switch-desc">Hiện phụ đề tiếng Việt trên YouTube và video HTML5</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.enableSubtitles}
                onChange={() => toggleFlag('enableSubtitles')}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <div className="switch-item">
            <div className="switch-info">
              <span className="switch-title">🔊 Đọc thuyết minh (TTS)</span>
              <span className="switch-desc">Phát giọng đọc tiếng Việt theo câu phụ đề</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.enableSpeech}
                onChange={() => toggleFlag('enableSpeech')}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <div className="switch-item">
            <div className="switch-info">
              <span className="switch-title">🎙️ Gemini Live Audio</span>
              <span className="switch-desc">Bắt âm thanh tab & dịch real-time qua microphone video</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.enableLive}
                onChange={() => toggleFlag('enableLive')}
              />
              <span className="switch-slider" />
            </label>
          </div>

          {!isGemini && (
            <div className="switch-item">
              <div className="switch-info">
                <span className="switch-title">✂️ Dịch voice theo đoạn</span>
                <span className="switch-desc">Thử nghiệm lồng tiếng từng phân đoạn video qua server</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.enableSegmentedDubbing}
                  onChange={() => toggleFlag('enableSegmentedDubbing')}
                />
                <span className="switch-slider" />
              </label>
            </div>
          )}

          {isGemini && (
            <div className="switch-item">
              <div className="switch-info">
                <span className="switch-title">⚡ Model dịch text Flash Lite</span>
                <span className="switch-desc">Gửi text/phụ đề tới Gemini (tắt để chỉ dùng Live tiết kiệm)</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.enableTextModel}
                  onChange={() => toggleFlag('enableTextModel')}
                />
                <span className="switch-slider" />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 5. Quick Actions Card */}
      <div className="card">
        <div className="card-title">Thao tác nhanh trên trang</div>
        <div className="action-grid">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !settings.enablePageTranslation || (isGemini && !settings.enableTextModel)}
            onClick={() => executeCommand('start-page')}
          >
            Dịch trang này
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => executeCommand('stop-page')}
          >
            Khôi phục trang
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || (!settings.enableSubtitles && !settings.enableLive)}
            onClick={() => executeCommand(settings.mode === 'live' ? 'live' : 'video')}
          >
            {settings.mode === 'live' ? 'Bật/Tắt Live' : 'Dịch video'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => executeCommand('stop')}
          >
            Dừng tất cả
          </button>
        </div>
      </div>

      {/* 6. Toast */}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      )}

      {/* 7. Save and Apply Button */}
      <button
        type="button"
        className="save-btn"
        disabled={saving}
        onClick={handleSaveAndApply}
      >
        {saving ? 'Đang lưu & áp dụng...' : 'Lưu & Áp dụng cài đặt'}
      </button>

      {/* 8. Footer */}
      <div className="footer">
        <span>v0.4.0 • Song ngữ Anh-Việt</span>
        <button type="button" className="test-btn" onClick={handleTestVoice}>
          Thử giọng đọc
        </button>
      </div>
    </div>
  );
}
