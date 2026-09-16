import { useCallback, useEffect, useRef, useState } from "react";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { models, useSpeechToText } from "react-native-executorch";

import { concatFloat32 } from "./formats";

/**
 * Whisper is trained on 16 kHz mono audio. The recorder treats this as a
 * preference, not a guarantee — if a device insists on another rate the
 * transcript degrades, so this is the first knob to check when accuracy is poor
 * on specific hardware.
 */
const WHISPER_SAMPLE_RATE = 16_000;

export type Dictation = {
  /** True between tapping the mic and tapping it again. */
  recording: boolean;
  /** True while Whisper is turning the recording into words. */
  working: boolean;
  /** 0 to 1 while the model downloads, the first time only. */
  downloadProgress: number;
  /** Something the person needs to read — a denied permission, a failure. */
  notice: string | null;
  dismiss: () => void;
  toggle: () => void;
};

/**
 * Dictation, on the device.
 *
 * Shared by the note editor and the chat composer, which both want exactly
 * this and nothing more: hold a recording, transcribe it, hand back the text.
 * What happens to that text is the caller's business — a note appends it, the
 * composer drops it into the draft.
 *
 * The model loads on first use rather than on mount, so opening a screen never
 * costs a download.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const recorder = useRef<AudioRecorder | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  // Held in a ref so a caller can pass an inline closure without the recorder
  // being torn down and rebuilt on every keystroke.
  const sink = useRef(onText);
  useEffect(() => {
    sink.current = onText;
  }, [onText]);

  const stt = useSpeechToText({
    model: models.speech_to_text.whisper_tiny_en(),
    preventLoad: !armed,
  });

  // Stop the mic if the screen goes away mid-recording.
  useEffect(
    () => () => {
      const active = recorder.current;
      if (!active) return;
      void active.stop();
      active.clearOnAudioReady();
    },
    []
  );

  const start = useCallback(async () => {
    setNotice(null);
    setArmed(true);

    if ((await AudioManager.requestRecordingPermissions()) !== "Granted") {
      setNotice("Microphone access is off. Turn it on in Settings to dictate.");
      return;
    }

    const active = new AudioRecorder();
    chunks.current = [];
    active.onAudioReady(
      { sampleRate: WHISPER_SAMPLE_RATE, bufferLength: 4096, channelCount: 1 },
      (event) => {
        chunks.current.push(Float32Array.from(event.buffer.getChannelData(0)));
      }
    );

    const started = await active.start();
    if (started.status === "error") {
      setNotice(started.message);
      return;
    }
    recorder.current = active;
    setRecording(true);
  }, []);

  const stop = useCallback(async () => {
    const active = recorder.current;
    if (!active) return;

    await active.stop();
    active.clearOnAudioReady();
    recorder.current = null;
    setRecording(false);

    const waveform = concatFloat32(chunks.current);
    chunks.current = [];
    if (waveform.length === 0) return;

    try {
      const { text } = await stt.transcribe(waveform);
      if (text.trim()) sink.current(text.trim());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [stt]);

  const toggle = useCallback(() => {
    void (recording ? stop() : start());
  }, [recording, start, stop]);

  return {
    recording,
    working: stt.isGenerating,
    downloadProgress: stt.downloadProgress,
    notice,
    dismiss: () => setNotice(null),
    toggle,
  };
}
