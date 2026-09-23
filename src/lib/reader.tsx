import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AudioContext, type AudioBufferQueueSourceNode } from "react-native-audio-api";
import { models, useTextToSpeech } from "react-native-executorch";

import { useConfirm } from "../components/dialog";
import { useAI } from "./ai";
import { forSpeech } from "./formats";

/**
 * Kokoro's output rate. The audio context has to match it: a context at the
 * phone's own 48 kHz plays the same samples twice as fast and an octave up.
 */
const KOKORO_SAMPLE_RATE = 24_000;

export type Reader = {
  /** The reply being read aloud right now, by the caller's key. */
  speaking: string | null;
  /** The reply waiting for the voice to finish downloading or loading. */
  preparing: string | null;
  /** 0 to 1 while the voice downloads, the first time only. */
  downloadProgress: number;
  /** Something the person needs to read — a failed load, a failed read. */
  notice: string | null;
  dismiss: () => void;
  /** Read this reply, or stop if it is the one already being read. */
  toggle: (key: string, text: string) => void;
  /** Render this somewhere: it is the one-time "this costs 335 MB" question. */
  dialog: JSX.Element;
  /** Kokoro is loaded and can speak now. */
  ready: boolean;
  /** Load Kokoro without speaking — so talk mode is warm before its first reply. */
  prepare: () => void;
  /**
   * Hands-free: read this aloud and resolve when it has finished, or been
   * stopped. Never asks about the download — talk mode asks once for both
   * voices up front.
   */
  say: (key: string, text: string) => Promise<void>;
  stop: () => void;
};

/**
 * Reading answers aloud, on the device.
 *
 * One of these per screen, not per reply: each instance holds its own copy of
 * a 320 MB model, so a hook in every message bubble would load it once per
 * message. The caller passes a key with each request and gets back which key
 * is speaking, which is all a bubble needs to draw its button.
 *
 * Streamed, not rendered whole. Kokoro hands back audio a phrase at a time, and
 * each piece is queued the moment it exists, so a long answer starts speaking
 * in about the time the first sentence takes rather than after all of it.
 *
 * Loads on first use, like dictation, so opening the Tutor never costs a
 * download.
 */
export function useReader(): Reader {
  const { readerReady, markReaderReady } = useAI();
  const confirm = useConfirm();
  const [armed, setArmed] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [ownNotice, setOwnNotice] = useState<string | null>(null);

  const tts = useTextToSpeech(models.text_to_speech.kokoro.en_us.heart(), {
    preventLoad: !armed,
  });

  // What was asked for before the voice was ready. A ref, not state: nothing
  // renders from it, it only has to survive until the model finishes loading.
  const pending = useRef<{ key: string; text: string } | null>(null);
  const playback = useRef<{ context: AudioContext; queue: AudioBufferQueueSourceNode } | null>(
    null
  );
  // The model object changes identity as it loads; cleanup needs the latest.
  const ttsRef = useRef(tts);
  useEffect(() => {
    ttsRef.current = tts;
  }, [tts]);

  // Resolves the say() in flight. Called whenever a reading ends for any
  // reason — finished, stopped, failed, replaced — so a caller awaiting it can
  // never be left waiting on audio that is not coming.
  const settle = useRef<(() => void) | null>(null);
  const release = useCallback(() => {
    const resolve = settle.current;
    settle.current = null;
    resolve?.();
  }, []);

  /** Silence now, and let the audio context go. Safe to call twice. */
  const halt = useCallback(() => {
    const active = playback.current;
    playback.current = null;
    if (!active) return;
    active.queue.stop();
    void active.context.close();
  }, []);

  const play = useCallback(
    async (key: string, text: string) => {
      halt();
      setPreparingKey(null);
      setOwnNotice(null);

      const context = new AudioContext({ sampleRate: KOKORO_SAMPLE_RATE });
      const queue = context.createBufferQueueSource();
      queue.connect(context.destination);
      playback.current = { context, queue };
      setSpeaking(key);

      // Done means both halves are done: the model has written the last piece
      // AND the speaker has played it. Either can finish first — synthesis
      // can outrun playback, and playback can drain while the model is still
      // on the next sentence — so each checks the other.
      let queued = 0;
      let written = false;
      let started = false;
      const finish = (): void => {
        // Only the reading that is still current may end itself. A stale one
        // finishing late must not clear the button of the one that replaced it.
        if (playback.current?.queue !== queue) return;
        halt();
        setSpeaking(null);
        release();
      };
      queue.onBufferEnded = () => {
        queued -= 1;
        if (written && queued <= 0) finish();
      };

      try {
        await ttsRef.current.stream({
          text: forSpeech(text),
          onNext: (audio) => {
            if (playback.current?.queue !== queue) return; // stopped meanwhile
            const buffer = context.createBuffer(1, audio.length, KOKORO_SAMPLE_RATE);
            buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);
            queue.enqueueBuffer(buffer);
            queued += 1;
            if (!started) {
              started = true;
              queue.start();
            }
          },
        });
        written = true;
        if (queued <= 0) finish();
      } catch (error) {
        setOwnNotice(error instanceof Error ? error.message : String(error));
        finish();
        release();
      }
    },
    [halt, release]
  );

  const stop = useCallback(() => {
    ttsRef.current.streamStop(true);
    halt();
    setSpeaking(null);
    release();
  }, [halt, release]);

  // Once the voice is loaded, read whatever was asked for while it was not.
  useEffect(() => {
    const next = pending.current;
    if (!tts.isReady || !next) return;
    pending.current = null;
    void play(next.key, next.text);
  }, [tts.isReady, play]);

  // Written the moment the files land, as dictation does, so abandoning the
  // first read does not forget the download happened and ask again.
  useEffect(() => {
    if (tts.downloadProgress >= 1 && !readerReady) markReaderReady();
  }, [tts.downloadProgress, readerReady, markReaderReady]);

  // Leaving the screen mid-sentence stops the voice rather than letting it
  // talk over whatever comes next.
  useEffect(
    () => () => {
      ttsRef.current.streamStop(true);
      halt();
    },
    [halt]
  );

  /**
   * Asked once, the first time, and never again once the voice is on the
   * phone. Same reasoning as the mic: 335 MB is not a rounding error on
   * mobile data, and a speaker icon is a button people press to find out what
   * it does.
   */
  const toggle = useCallback(
    (key: string, text: string) => {
      if (speaking === key || preparingKey === key) {
        pending.current = null;
        setPreparingKey(null);
        stop();
        return;
      }
      if (tts.isReady) {
        void play(key, text);
        return;
      }
      const begin = (): void => {
        stop();
        pending.current = { key, text };
        setPreparingKey(key);
        setArmed(true);
      };
      if (readerReady) {
        begin();
        return;
      }
      confirm.ask({
        title: "Download the reading voice?",
        message:
          "Read aloud needs Kokoro, an English voice that is 335 MB. It downloads once — after that it reads with the radio off.",
        action: "Download",
        onConfirm: begin,
      });
    },
    [speaking, preparingKey, tts.isReady, readerReady, play, stop, confirm]
  );

  const say = useCallback(
    (key: string, text: string) =>
      new Promise<void>((resolve) => {
        // A say() already waiting is ended, not orphaned.
        release();
        settle.current = resolve;
        if (ttsRef.current.isReady) {
          void play(key, text);
          return;
        }
        pending.current = { key, text };
        setPreparingKey(key);
        setArmed(true);
      }),
    [play, release]
  );

  // Derived rather than set from an effect: a failed load is a fact about the
  // model, and the waiting reply stops waiting the moment that fact exists.
  const failed = armed && tts.error ? tts.error.message : null;

  // A load that failed will never speak, so anyone awaiting it is let go.
  useEffect(() => {
    if (failed) release();
  }, [failed, release]);

  return {
    speaking,
    preparing: failed ? null : preparingKey,
    downloadProgress: tts.downloadProgress,
    notice: ownNotice ?? failed,
    dismiss: () => setOwnNotice(null),
    toggle,
    dialog: confirm.dialog,
    ready: tts.isReady,
    prepare: () => setArmed(true),
    say,
    stop,
  };
}
