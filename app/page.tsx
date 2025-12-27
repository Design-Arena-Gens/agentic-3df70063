"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type TranslateResponse = {
  originalText: string;
  translatedText: string;
  translatedAudio: string; // base64
  translatedMimeType: string;
};

const languages = [
  { code: "Spanish", label: "Spanish" },
  { code: "French", label: "French" },
  { code: "German", label: "German" },
  { code: "Italian", label: "Italian" },
  { code: "Hindi", label: "Hindi" },
  { code: "Japanese", label: "Japanese" },
  { code: "Korean", label: "Korean" },
  { code: "Portuguese", label: "Portuguese" },
  { code: "Arabic", label: "Arabic" },
  { code: "Mandarin Chinese", label: "Mandarin Chinese" }
];

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState(languages[0].code);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const ffmpegRef = useRef<any | null>(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);

  const hasResult = useMemo(() => Boolean(resultUrl || voiceUrl), [resultUrl, voiceUrl]);

  useEffect(() => {
    return () => {
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setVoiceUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const ensureFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setFfmpegLoading(true);
    const ffmpegModule = (await import("@ffmpeg/ffmpeg")) as any;
    const createFFmpeg =
      ffmpegModule.createFFmpeg ?? ffmpegModule.default?.createFFmpeg ?? ffmpegModule.default;
    const ffmpeg = createFFmpeg({
      log: false,
      corePath: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js"
    });
    await ffmpeg.load();
    ffmpegRef.current = ffmpeg;
    setFfmpegLoading(false);
    return ffmpeg;
  };

  const resetState = () => {
    setStatus(null);
    setError(null);
    setOriginalText(null);
    setTranslatedText(null);
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setVoiceUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Upload an audio file to continue.");
      return;
    }

    resetState();
    setIsProcessing(true);
    setStatus("Sending audio for transcription and translation...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetLanguage", targetLanguage);

      const response = await fetch("/api/translate", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Processing failed: ${response.statusText}`);
      }

      const data = (await response.json()) as TranslateResponse;
      setStatus("Generating voice mix...");
      setOriginalText(data.originalText);
      setTranslatedText(data.translatedText);

      const voiceArray = base64ToUint8Array(data.translatedAudio);
      const voiceBlob = new Blob([voiceArray], { type: data.translatedMimeType });
      const voiceUrlLocal = URL.createObjectURL(voiceBlob);
      setVoiceUrl(voiceUrlLocal);

      const ffmpeg = await ensureFFmpeg();
      const fileName = `input${extractExtension(file.name)}`;
      const voiceFileName = `voice${mimeTypeToExtension(data.translatedMimeType)}`;
      ffmpeg.FS("writeFile", fileName, new Uint8Array(await file.arrayBuffer()));
      ffmpeg.FS("writeFile", voiceFileName, new Uint8Array(await voiceBlob.arrayBuffer()));
      await ffmpeg.run("-i", voiceFileName, "voice.wav");

      await ffmpeg.run("-i", fileName, "source.wav");
      await ffmpeg.run(
        "-i",
        "source.wav",
        "-af",
        "pan=stereo|c0=c0-c1|c1=c1-c0,volume=1.2",
        "background.wav"
      );
      await ffmpeg.run(
        "-i",
        "background.wav",
        "-i",
        "voice.wav",
        "-filter_complex",
        "[0:a]volume=0.9[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0",
        "-c:a",
        "mp3",
        "final.mp3"
      );

      const resultData = ffmpeg.FS("readFile", "final.mp3");
      cleanupFiles(ffmpeg, ["voice.wav", voiceFileName, "source.wav", "background.wav", "final.mp3", fileName]);

      const resultBlob = new Blob([resultData.buffer], { type: "audio/mpeg" });
      const finalUrl = URL.createObjectURL(resultBlob);
      setResultUrl(finalUrl);
      setStatus("Ready to play and download.");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unexpected error occurred.");
      setStatus(null);
    } finally {
      setIsProcessing(false);
      setFfmpegLoading(false);
    }
  };

  return (
    <main className={styles.container}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <h1>Polyglot Audio Converter</h1>
          <p>Translate spoken audio into a new language while respecting the original ambience.</p>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Audio Source</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                resetState();
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Target Language</span>
            <select
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={isProcessing || ffmpegLoading || !file} className={styles.submit}>
            {isProcessing ? "Processing…" : ffmpegLoading ? "Loading audio engine…" : "Convert"}
          </button>
        </form>

        {status && <div className={styles.status}>{status}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {(originalText || translatedText) && (
          <section className={styles.transcripts}>
            {originalText && (
              <article>
                <h2>Original Transcript</h2>
                <p>{originalText}</p>
              </article>
            )}
            {translatedText && (
              <article>
                <h2>Translated Transcript</h2>
                <p>{translatedText}</p>
              </article>
            )}
          </section>
        )}

        {hasResult && (
          <section className={styles.preview}>
            {voiceUrl && (
              <div>
                <h2>Translated Voice</h2>
                <audio controls src={voiceUrl} />
              </div>
            )}
            {resultUrl && (
              <div>
                <h2>Remixed Track</h2>
                <audio controls src={resultUrl} />
                <a download="translated-mix.mp3" href={resultUrl} className={styles.download}>
                  Download Mix
                </a>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

const extractExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? ".bin" : name.slice(dot);
};

const base64ToUint8Array = (base64: string) => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const cleanupFiles = (ffmpeg: any, names: string[]) => {
  for (const name of names) {
    try {
      ffmpeg.FS("unlink", name);
    } catch {
      // ignore
    }
  }
};

const mimeTypeToExtension = (mime: string) => {
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("flac")) return ".flac";
  if (mime.includes("webm")) return ".webm";
  return ".mp3";
};
