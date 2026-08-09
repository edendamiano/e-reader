# Third-party component inventory

Status: Phase 0 direct-dependency record. Exact Node transitive versions are locked in `package-lock.json`; exact Python direct pins are in `tts/requirements.runtime.txt`. A generated notice bundle for every transitive package is required before an installer can be shipped.

## Application runtime

| Component | Version | License | Purpose |
|---|---:|---|---|
| Electron | 43.3.0 | MIT | Windows desktop shell |
| React / React DOM | 18.3.1 | MIT | Minimal renderer UI |
| `r2-shared-js` | 1.0.85 | BSD-3-Clause | Readium publication parsing and models |
| DOMPurify | 3.4.13 | MPL-2.0 OR Apache-2.0 | Hostile publication markup sanitization |
| `fast-xml-parser` | 5.10.1 | MIT | Container/header parsing |
| `image-size` | 2.0.2 | MIT | Readium image metadata dependency; vulnerable non-core detectors are disabled |
| `mime-types` | 3.0.2 | MIT | Media-type lookup |
| `yauzl` / `yazl` | 3.4.0 / 3.3.1 | MIT | Bounded EPUB ZIP reads and synthetic fixtures |

`r2-navigator-js@1.25.7` was evaluated but is not a shipped dependency because its publication webview disables Chromium sandboxing. See ADR 0001.

## Native AZW3 converter

| Component | Version | License | Record |
|---|---:|---|---|
| libmobi | 0.12, commit `85dcfe803fc2a21020ddcf15c3eb66b93d388add` | LGPL-3.0-or-later | Dynamically linked DLL; full text and replacement/build instructions under `native/azw3` |
| zlib | 1.3.1 | zlib License | Statically linked into `libmobi.dll`; notice under `native/azw3` |

The libmobi build uses `USE_ENCRYPTION=OFF`; no DRM decryption component is included.

## Local TTS runtime

| Component | Version | License |
|---|---:|---|
| PyTorch | 2.8.0+cu128 | BSD-3-Clause |
| torchaudio | 2.8.0+cu128 | BSD-2-Clause |
| Kokoro / Misaki | 0.9.4 / 0.9.4 | Apache-2.0 |
| SoundFile | 0.14.0 | BSD-3-Clause |
| spaCy / `en_core_web_sm` | 3.8.15 / 3.8.0 | MIT |
| setuptools | 80.9.0 | MIT |
| IndexTTS2 | 2.0.0, commit `90ca4d608209584bad3a5bd5becc0b80c146e60f` | LicenseRef-Bilibili-IndexTTS |

Model weights, narrator provenance, hashes, and the non-permissive IndexTTS2 conditions are recorded separately in `model-licenses.md`. IndexTTS2 is not selected for the production route by default.

## Development and test tooling

Playwright is Apache-2.0; TypeScript is Apache-2.0; Electron, Vite, Vitest, esbuild, tsx, jsdom, the React/Vite plugins and TypeScript type packages are MIT; rimraf is BlueOak-1.0.0. These tools are not publication content and do not change the hostile-input boundary.

## Release gate

Before Phase 6 packaging, generate a complete notice artifact from the locked Node and Python environments, retain required copyright/NOTICE files, re-check the then-current dependency advisories, and make an explicit include/omit decision for IndexTTS2. This Phase 0 record does not claim that an installer license bundle already exists.
