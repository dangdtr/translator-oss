# Translator • Real-time Cabin Interpretation & Bilingual Translation

> An open-source Chrome extension that transforms your browser into a **real-time simultaneous interpreter ("cabin translation")** for English audio and video into natural Vietnamese. Powered by the **free Gemini Live API** for instant streaming, or **100% offline local AI** with **VietAI envit5** translation and **VieNeu-TTS** neural voice synthesis.

---

## 🎙️ Key Highlight: Free Real-Time Cabin Interpretation

Leveraging the **free Gemini Live API** (`gemini-3.5-live-translate-preview`) via Google AI Studio, this extension streams tab audio directly through WebSockets without needing any server:

- **Free Tier Ready**: Connect with a free API key from [Google AI Studio](https://aistudio.google.com/) — no credit card required.
- **Zero-Setup (Client-Only)**: Real-time AudioWorklet captures 16kHz PCM audio directly in Chrome and speaks Vietnamese translation with near-zero latency.
- **Natural Dubbing**: Balanced background audio with natural AI voices (`Aoede`, `Kore`, `Charon`, `Puck`, `Fenrir`).
- **Ideal for**: Livestreams, university lectures (Coursera, edX), tech keynotes, podcasts, and global news.

---

## ✨ Features & Modes

| Mode | Architecture | Highlights |
| :--- | :--- | :--- |
| **✨ Gemini Cloud API** *(Default)* | Client-only (Chrome MV3) | Real-time Live interpretation, bilingual web translation (Gemini Flash Lite), and subtitle TTS. Zero server installation. |
| **💻 Local Server** *(Self-Hosted)* | Python FastAPI + CTranslate2 | **100% offline & private**: High-accuracy translation with **VietAI envit5** and natural 48kHz speech synthesis with **VieNeu-TTS v3 Turbo** (or Piper TTS). Supports segmented dubbing. |

### Feature Flags
Toggle any feature instantly from the popup menu:
- 🎙️ **Gemini Live Audio**: Real-time simultaneous cabin interpretation.
- 🎬 **Video Subtitles**: Floating bilingual subtitle overlay on YouTube and HTML5 videos.
- 🔊 **Voice Dubbing (TTS)**: Automatic spoken translation for subtitles.
- 🌐 **Web Page Translation**: Bilingual translation for text and articles on scroll.
- ⚡ **Gemini Flash Lite**: Toggle text translation to optimize quota usage.
- ✂️ **Segmented Dubbing**: Segment-by-segment dubbing in local server mode.

---

## 🚀 Quick Start

### Option 1: Load Pre-Built Extension (Fastest)

1. Download **`translator-0.4.0-chrome.zip`** from [Releases](https://github.com/dangdtr/translator-oss/releases).
2. Unzip the archive.
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** (top right) → Click **Load unpacked** → Select the unzipped folder (or the `extension/` directory).
5. Open the extension popup, paste your **Gemini API Key**, and click **Save & Apply**.
6. On YouTube, click the **Microphone (Live)** button on the player controls to start instant cabin interpretation!

### Option 2: Build From Source

```bash
git clone https://github.com/dangdtr/translator-oss.git
cd translator-oss
npm install
npm run build
```
Load the generated `.output/chrome-mv3` folder into `chrome://extensions`.

### Option 3: Local Offline Server (VietAI & VieNeu-TTS)

Run 100% privately on your CPU using **VietAI envit5** for translation and **VieNeu-TTS** for natural Vietnamese speech.

Requires **Python 3.10+** and [uv](https://docs.astral.sh/uv/):
```bash
./setup.sh    # Installs VietAI envit5 and VieNeu-TTS models
./start.sh    # Starts FastAPI local server on port 8765
```
In the popup menu, switch to the **💻 Local Server** tab and click **Save & Apply**.

---

## 🛠️ Development

```bash
npm run dev        # Dev server with HMR
npm run build      # Production build
npm run zip        # Package release zip
npm run typecheck  # TypeScript type verification
npm test           # Run 52 automated unit tests
```

---

## 📄 License

This repository is licensed under a **Dual-License** model:
- **Chrome Extension** (`src/`, `extension/`): **[MIT License](LICENSE#mit-license-chrome-extension)**
- **Backend Local Server** (`server/`): **[GNU GPL v3.0](server/LICENSE)** (due to Piper TTS engine integration)
- **AI Models & Third-Party Assets**: See [THIRD_PARTY.md](THIRD_PARTY.md) for individual model licenses (OpenRAIL, Apache-2.0, CC BY 4.0).
