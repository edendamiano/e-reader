# TTS model and narrator licensing record

## Kokoro fallback

- Model: `hexgrad/Kokoro-82M-v1.1-zh`.
- Model identifier recorded by the publisher: SHA-256 prefix `b1d8410f` (full weight hash `b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b`).
- License: Apache-2.0 for code and weights.
- Publisher record: `https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh` and `https://github.com/hexgrad/kokoro`.
- Phase 0 voices: `zf_001` for Chinese/mixed text and `bf_vale` for English evaluation. They are internal defaults and are never exposed as user-selectable voice IDs.

The downloaded weight file was verified locally as SHA-256 `B1D8410FA44DFB5C15471FD6C4225EA6B4E9AC7FA03C98E8BEA47A9928476E2B`. The model card states that the Chinese training data was permissively granted by LongMaoData and that the added English voices were synthetic. No celebrity or public-figure imitation is selected.

## IndexTTS2 candidate

- Model: `IndexTeam/IndexTTS-2` with the official `index-tts/index-tts` implementation.
- Source checkout: commit `90ca4d608209584bad3a5bd5becc0b80c146e60f` (2026-08-05).
- License: bilibili Model Use License Agreement, not Apache/MIT.
- Official records: `https://github.com/index-tts/index-tts/blob/main/LICENSE` and `https://huggingface.co/IndexTeam/IndexTTS-2`.

Verified core files:

| File | SHA-256 |
|---|---|
| `gpt.pth` | `BAAAEB8B56328DA81731DC540A85A7DEE32ECA9DA28F174B05757CB651C602A4` |
| `s2mel.pth` | `AAE1BB12017CBB47E7A5CE537FC82F40B6B1DEB71ACDB9B8F25686F32714B636` |
| `qwen0.6bemo4-merge/model.safetensors` | `11293257A8DF593C154A8ECD5FC039F3076DE35411E35F06D41B471E136F6641` |

The custom license and copyright notice must accompany every used or distributed copy and downstream recipients must be bound to it. Separate written authorization is required when the user or an affiliate exceeded either 100 million monthly active users in the preceding month or RMB 1 billion annual revenue in the preceding year. The license also restricts using the model or derivatives to improve other commercial AI models and assigns third-party data, voice, output, and legal-compliance responsibility to the user/distributor. No production decision may describe IndexTTS2 as an ordinary permissive dependency. The final installer must either include the complete notice and satisfy these terms or omit IndexTTS2 entirely.

## Narrator reference rule

The Phase 0 IndexTTS2 reference is `models/narrator/reference-zf001-v1.wav`, generated locally from the Apache-2.0 Kokoro model with voice `zf_001` and project-authored text:

> 这是一次本地中文朗读测试。声音应该自然、平稳，并且适合长时间收听。

Its SHA-256 is `D929BA80F6150CFA6CAB697FDDA1E6E66B856E091B5E607BA180BD460EA0ECE2`. This removes any dependency on an unexplained demo recording or identifiable person's voice. It is a benchmark/development narrator, not a final subjective narrator choice. Kokoro currently uses `zf_001` for Chinese/mixed sentences and `bf_vale` for English, so cross-language narrator identity is not yet demonstrated and must remain a listening-test item.
