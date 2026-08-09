# Third-party component inventory

Status: Phase 1/2 direct-dependency record. Exact Node versions are locked in `package-lock.json`; Python direct pins are in `tts/requirements.runtime.txt`. A generated notice bundle for all shipped transitive packages is still required before an installer.

## Application runtime

| Component | Version | License | Purpose |
|---|---:|---|---|
| Electron | 43.3.0 | MIT | Windows desktop shell |
| React / React DOM | 18.3.1 | MIT | Minimal bookshelf/settings/reader UI |
| DOMPurify | 3.4.13 | MPL-2.0 OR Apache-2.0 | Hostile chapter markup sanitization |
| `fast-xml-parser` | 5.10.1 | MIT | EPUB container, OPF, NAV, and NCX parsing |
| `mime-types` | 3.0.2 | MIT | Media-type utility |
| `yauzl` | 3.4.0 | MIT | Bounded exact EPUB ZIP reads |

`yazl@3.3.1` is used only to generate test fixtures. The former `r2-shared-js`, `r2-lcp-js`, `request`, and `image-size` chain was removed after the replacement adapter passed the real-book suite. `r2-navigator-js` was evaluated in Phase 0 but never shipped because its desktop webview disabled Chromium sandboxing.

## Native AZW3 converter

| Component | Version | License | Record |
|---|---:|---|---|
| libmobi | 0.12, commit `85dcfe803fc2a21020ddcf15c3eb66b93d388add` | LGPL-3.0-or-later | Dynamically linked DLL; full license and replacement/build instructions under `native/azw3` |
| zlib | 1.3.1 | zlib License | Statically linked into `libmobi.dll`; notice under `native/azw3` |

The libmobi build uses `USE_ENCRYPTION=OFF`; no DRM decryption component is included.

## Local TTS runtime

| Component | Version | License |
|---|---:|---|
| PyTorch / torchaudio | 2.8.0+cu128 | BSD-3-Clause / BSD-2-Clause |
| Kokoro / Misaki | 0.9.4 / 0.9.4 | Apache-2.0 |
| SoundFile | 0.14.0 | BSD-3-Clause |
| spaCy / `en_core_web_sm` | 3.8.15 / 3.8.0 | MIT |
| setuptools | 80.9.0 | MIT |
| IndexTTS2 | 2.0.0, commit `90ca4d608209584bad3a5bd5becc0b80c146e60f` | LicenseRef-Bilibili-IndexTTS |

Model hashes, narrator provenance, and IndexTTS2's non-permissive conditions are recorded in `model-licenses.md`. Kokoro is the default; IndexTTS2 is not selected or bundled by default.

## Release gate

Before packaging, generate the complete Node/Python/native notice artifact, retain all required notices, re-run dependency and Electron security review, make an explicit include/omit decision for IndexTTS2, and verify dynamic libmobi replacement instructions in the packaged layout.
