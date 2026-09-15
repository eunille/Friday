# Offline AI Mobile App — Tech Stack & Development Plan

## Overview

A fully offline-capable mobile app that lets users ask questions and get answers grounded in their own saved content (notes, documents), with no runtime dependency on any cloud/server API. Everything — inference, retrieval, transcription — runs on-device once the app and its models are downloaded.

**Non-goals for this build:**

- No cloud/server inference fallback (no RunPod, no hosted API calls at runtime)
- No LoRA fine-tuning / adapter loading (out of scope for now — RAG covers the "domain knowledge" need)

---

## Tech stack

### Framework & UI

- **React Native (Expo)** — chosen because it's the common thread across every library below (UI kit, LLM runtime, RAG layer, STT all target RN/Expo).
- **HeroUI Native** — UI component library. Scaffold new projects with `create-heroui-native-app` (Expo-preconfigured).

### On-device LLM inference

- **`react-native-executorch`** (pinned `0.9.3`) — the only runtime. `@react-native-rag/executorch@0.9.0` peer-requires `^0.9.0`, so don't jump to 0.10.x until the RAG plugins catch up.
- ~~`llama.rn` fallback~~ — **dropped.** It's a second inference engine for models ExecuTorch already ships. Add it only if a model you need has no `.pte` export.

### On-device model

> **Correction:** ExecuTorch runs `.pte` files, not GGUF — GGUF/Q4_K_M is llama.cpp's format. No conversion step is needed: both Qwen tiers are already published as ExecuTorch `8da4w` builds in the library's own model registry.

- **Qwen2.5-1.5B** — `models.llm.qwen2_5_1_5b()`, "lite" tier, ~1.1 GB.
- **Qwen2.5-3B** — `models.llm.qwen2_5_3b()`, "standard" tier, ~1.9 GB.
- Tier auto-detects from `Device.totalMemory` (Android-only; iOS falls back to lite) and is overridable in the Library tab, persisted in a `settings` table.

### Offline RAG (ask-questions-about-your-notes pipeline)

- **`react-native-rag`** — core RAG orchestration library for React Native.
- **`@react-native-rag/executorch`** — connects the RAG pipeline to the on-device LLM.
- **`@react-native-rag/op-sqlite`** — on-device vector store backend (SQLite-based).
- **Embedding model**: `models.text_embedding.all_minilm_l6_v2()` — 384-dim, already ExecuTorch-exported. No export step to build.

### Offline speech-to-text

> **Correction:** `whisper.rn` is redundant. `react-native-executorch` already ships Whisper (`models.speech_to_text.whisper_tiny_en()` + the `useSpeechToText` hook), so using it avoids a second native module and a second inference engine for the same job.

- **`react-native-executorch` → `useSpeechToText`** with `whisper_tiny_en` (~80 MB), loaded lazily behind an "Enable voice" button so it isn't downloaded unless used.
- **`react-native-audio-api`** supplies the mic: `AudioRecorder.onAudioReady` hands back raw 16 kHz Float32 PCM, which is exactly what `transcribe()` wants — no file decode step.

### Downloadable knowledge packs

- Plain JSON: `{ "id": "first-aid", "title": "First Aid Basics", "entries": [{ "title": "Burns", "text": "…" }] }`. Validated by `parsePack()` before anything is written.
- No live server required — any static file host works (Hostinger, GitHub releases, object storage, etc.).
- App downloads a pack once, embeds it into the local vector index, and it's usable fully offline from then on. Re-importing the same `id` replaces rather than duplicates.

> **Simplification:** packs ship raw text and are embedded on-device rather than shipping precomputed embeddings. That removes the whole build pipeline and the version-coupling to one embedding model, at the cost of a few seconds on import. Precompute (and zip) once packs get big enough that the import wait is felt.

---

## Feature set (all reuse the same core pipeline)

| Feature                         | What it uses                                                               |
| ------------------------------- | -------------------------------------------------------------------------- |
| Ask questions about your notes  | RAG pipeline (embeddings + vector store + on-device LLM synthesis)         |
| Semantic search over notes      | Vector store only (retrieval without LLM synthesis step)                   |
| Document summarization          | On-device LLM, different prompt, same content                              |
| Flashcard / quiz generation     | On-device LLM, different prompt, same content                              |
| Voice notes → text              | `useSpeechToText` (Whisper, via ExecuTorch) + `react-native-audio-api` mic |
| Domain-specific knowledge packs | Downloadable pre-built vector index bundles                                |

---

## Development phases

**Status (2026-09-15):** Phases 0–5 are implemented and typecheck/lint clean. Nothing has been run
on a device yet — that is Phase 6. Screens live in `src/app/(tabs)/`: `index` (Ask), `notes`,
`search`, `library`. All model/DB wiring is in `src/lib/ai.tsx`; pure helpers and their self-check
(`npm run check`) are in `src/lib/formats.ts`.

Because the native modules need a dev build, `npx expo prebuild` then `npm run android` / `npm run ios` — Expo Go won't work.

### Phase 0 — Project setup

- Scaffold with `create-heroui-native-app` (Expo + HeroUI Native preconfigured)
- Set up project structure, navigation, basic app shell
- **Acceptance:** app builds and runs on iOS + Android simulators/devices with a blank HeroUI Native screen

### Phase 1 — Core on-device chat (no RAG yet)

- Integrate `react-native-executorch` (or `llama.rn`) with the quantized Qwen2.5 model (lite tier first)
- Basic chat UI: text input, message list, loading state
- Device-tier detection to select lite vs standard model
- **Acceptance:** user can type a question and get an on-device-generated answer, fully offline, on a real device

### Phase 2 — Offline RAG over user content

- Integrate `react-native-rag` + `@react-native-rag/executorch` + `@react-native-rag/op-sqlite`
- Add the embedding model, build the ingestion pipeline (notes/docs → chunks → embeddings → local index)
- Wire retrieval into the chat flow: retrieve relevant chunks, feed to LLM for synthesis
- **Acceptance:** user can add a note/document, then ask a question about it and get a grounded answer, offline

### Phase 3 — Additional content features

- Semantic search UI (reuse Phase 2's vector store, skip LLM synthesis)
- Document summarization (new prompt template against existing pipeline)
- Flashcard/quiz generation (new prompt template)
- **Acceptance:** each feature works against previously ingested content without any new infrastructure

### Phase 4 — Offline voice notes

- Integrate `whisper.rn` with tiny/base model
- Add voice recording UI, transcription flow, and feed transcribed text into the same ingestion pipeline from Phase 2
- **Acceptance:** user can record a voice note, see it transcribed, and later ask questions about its content — all offline

### Phase 5 — Downloadable knowledge packs

- Define pack format (chunked text + precomputed embeddings, zipped)
- Build download manager (fetch, unzip, merge into local `op-sqlite` index)
- Simple in-app "browse/download packs" screen
- **Acceptance:** user can download a pack over Wi-Fi, then go fully offline and ask questions grounded in that pack's content

### Phase 6 — Polish & device coverage

- Test across a spread of real devices (low/mid/high RAM tiers)
- Tune model tier selection thresholds
- Handle edge cases: low storage, interrupted downloads, corrupted packs, model load failures
- **Acceptance:** app degrades gracefully on low-end devices and recovers cleanly from interrupted downloads/model loads

---

## Open questions to resolve during build

- Exact device RAM thresholds for lite vs standard model tier — currently a single 6 GB guess in `STANDARD_TIER_MIN_BYTES` (`src/lib/ai.tsx`); calibrate in Phase 6
- Prompt size cap for summarise/flashcards — currently 6000 chars in `PROMPT_CHAR_BUDGET`; raise once real on-device timings exist
- Storage budget for bundled model + optional knowledge packs (affects app size / download size). Nothing is bundled today: models download on first launch, so the binary stays small but first run needs Wi-Fi
- Pack discovery — the Library tab takes a pasted URL. Add a catalogue constant once there is a host to point at
- Whether real-time sync of user notes is needed, or save-on-demand is sufficient (carried over from the broader app scope, if this ties into an existing notes/editor product)
