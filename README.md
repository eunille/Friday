# Friday

A note-taking app with a language model living inside it. You write notes, it answers
questions about them, summarises them, quizzes you on them, and reads the nutrition panel
off a photographed label — and it does all of that on the phone. No account, no API key,
no server. After the first run it works in airplane mode.

<p align="center">
  <img src="assets/download-qr.png" width="220" alt="QR code linking to the Android download" />
</p>

<p align="center">
  <b><a href="https://github.com/eunille/Friday/releases/download/1.3.0/Friday-1.3.0.apk">Download for Android</a></b><br />
  <sub>Scan the code with an Android phone, or use the link. 101 MB, v1.3.0.</sub>
</p>

> Android will warn that this is from an unknown developer. That is expected — the app is
> signed for direct install rather than distributed through the Play Store. iOS is not
> supported: Apple does not allow sideloading this way.
>
> Already have an older build? Uninstall it first. Every release so far carries the same
> internal version number, and Android refuses to install over a copy it cannot tell is
> newer.

## The first run

Opening the app downloads a 0.4 GB model over Wi-Fi. That is the only time it touches the
network, and there is a progress bar and a cancel button while it happens. Everything after
that — every question, every summary, every quiz — is computed on the device.

Turning on airplane mode and asking it a question is the fastest way to see what the app
actually is.

## What it does

**Ask** — a chat that can read your notes. Retrieval is on by default, so an answer about
something you wrote is grounded in what you wrote rather than in the model's training data.
Answers stream in as they are generated, and can be interrupted.

**Notes** — a full-page editor. Text saves as you pause typing; the expensive re-indexing
happens once, when you leave the note. Dictation is built in and also runs on the device.

**Quiz** — multiple choice, true/false, or recall, at three difficulties, five or ten
questions. Answered one at a time with immediate marking, a score, and a review of what you
missed.

**Summarise** — key points, a paragraph, or an outline.

**Scan a label** — photograph a nutrition panel and get it read back in plain words. Text
recognition runs on the phone like everything else. The reading is editable before it is
scored, because a recogniser on a crinkled sachet will get a digit wrong, and a wrong number
is worse than a slow one.

The division of labour here is deliberate: **the model transcribes, the code grades.** Its
only instruction is to copy numbers off the panel into JSON — it is never asked whether a
food is healthy. The score is arithmetic against the WHO reference in `src/lib/nutrition.ts`,
so the same label always produces the same score, and `npm run check` can assert on it. Swap
that one object and one label to score against a different reference; nothing else changes.

**Search** — semantic, not keyword. "How do I stop a burn hurting" finds a note that only
says "cool under running water", because the match is on meaning. This runs without the
language model at all, so it is fast.

**Settings** — answer length, tone, and your own instructions. The exact prompt being sent
to the model is shown on the screen, so when an answer is wrong there is something concrete
to read.

## How it works

| Piece | What it does |
|---|---|
| [ExecuTorch](https://github.com/software-mansion/react-native-executorch) | Runs Qwen2.5 (0.5B / 1.5B / 3B) on the device |
| all-MiniLM-L6-v2 | Turns notes into vectors, on the device |
| [op-sqlite](https://github.com/OP-Engineering/op-sqlite) + libSQL | SQLite with vector search, for retrieval |
| Whisper tiny.en | Dictation, on the device |
| CRAFT + CRNN | Finds and reads text in a photographed label, on the device |
| [react-native-rag](https://github.com/software-mansion/react-native-rag) | Ties retrieval to generation |

A note is stored twice: once as the text you wrote, in a `notes` table, and again as
overlapping chunks with their embeddings, in `vectors`. The first is what you edit; the
second is what search and Ask read. Editing a note rewrites both. Two smaller tables sit
beside them — `chats`, which keeps each conversation as one JSON blob because it is only ever
read and written whole, and `quiz_results`, which is what lets the home screen tell you a
topic is worth another look without inventing the number.

The model choice matters more than it looks. The default is the smallest one — not because
of memory, but because the downloader cannot resume, so a stalled connection discards the
whole transfer. 0.4 GB gets a working app in a few minutes; upgrading later is one tap, and
the app already works by then.

## Running it yourself

```bash
npm install
npx expo start
```

You will need a development build rather than Expo Go — the app depends on native modules
that Expo Go does not ship.

```bash
npx eas-cli build --platform android --profile development   # for iterating
npx eas-cli build --platform android --profile preview       # the standalone APK
```

Checks:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run check       # assertions for the parsers that read model output
```

`npm run check` is the interesting one. A small model asked for `Q:` / `A:` will number
things, bullet them, bold the markers and wrap answers onto a second line, so the parsers
are written to tolerate all of that and to discard anything still incomplete — a quiz
question whose answer cannot be resolved marks you wrong whatever you tap, so it is dropped
rather than shown. The checks run that mess through the parsers and assert on the result.

## Built with

React Native 0.86 · Expo SDK 57 · expo-router · HeroUI Native · Uniwind (Tailwind for RN) ·
TypeScript
