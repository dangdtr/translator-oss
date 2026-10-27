# Third-Party Models and Libraries

This repository is organized as a monorepo under a **Dual-License** structure:
- **Chrome Extension** (`src/`, `extension/`): **MIT License**.
- **Backend Server** (`server/`): **GNU General Public License v3.0 (GPL-3.0)** due to its integration with the Piper TTS engine (`piper-tts` GPL-3.0).

---

### Third-Party Models & Dependencies

- **Argos English → Vietnamese 1.9** (Fallback translation model): [Argos package index](https://github.com/argosopentech/argospm-index), downloaded from `https://argos-net.com/v1/translate-en_vi-1_9.argosmodel`. Licensed under **CC BY 4.0**. Citation: Jörg Tiedemann and Santhosh Thottingal, “OPUS-MT — Building open translation services for the World”, EAMT 2020.
- **VietAI envit5-translation** (Default translation model): [Model Card](https://huggingface.co/VietAI/envit5-translation), revision `840bc88104d5a4277af740eaedb024df8c3093e7`, licensed under **OpenRAIL**. Automatically converted to CTranslate2 int8 via `scripts/setup_envit5.sh`. Citation: Ngo et al., “MTet: Multi-domain Translation for English and Vietnamese”, arXiv:2210.05610, 2022.
- **Piper vi_VN-vais1000-medium**: [Model Card](https://huggingface.co/rhasspy/piper-voices/blob/main/vi/vi_VN/vais1000/medium/MODEL_CARD). Dataset VAIS-1000 licensed under **CC BY 4.0**, fine-tuned from lessac voice.
- **VieNeu-TTS v3 Turbo** (Default local neural TTS): [pnnbao-ump/VieNeu-TTS-v3-Turbo](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo), revision `61b85e3d937fbbacb387714180e8182823512523`, ONNX int8, **Apache-2.0**. Audio codec [OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX), **Apache-2.0**. Default preset voice: "Hải Đăng".
- **Piper engine**: [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), **GPL-3.0**; executed in local Python backend.
- **CTranslate2**: [OpenNMT/CTranslate2](https://github.com/OpenNMT/CTranslate2), **MIT**.
- **SentencePiece**: [google/sentencepiece](https://github.com/google/sentencepiece), **Apache-2.0**.

Pretrained models are downloaded on-demand via scripts and are not distributed inside the extension package.
