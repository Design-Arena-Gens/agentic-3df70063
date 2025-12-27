import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    const formData = await request.formData();
    const uploadedFile = formData.get("file");
    const targetLanguage = formData.get("targetLanguage");

    if (!(uploadedFile instanceof File) || !targetLanguage || typeof targetLanguage !== "string") {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const arrayBuffer = await uploadedFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileForOpenAI = new File([buffer], uploadedFile.name || "audio.wav", {
      type: uploadedFile.type || "audio/wav"
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fileForOpenAI,
      model: "gpt-4o-mini-transcribe",
      temperature: 0.2
    });

    const originalText = transcription.text?.trim();
    if (!originalText) {
      return NextResponse.json({ error: "Failed to transcribe audio." }, { status: 422 });
    }

    const translation = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `Translate the following transcript into ${targetLanguage}. Maintain the speaker's intent and produce natural speech that fits spoken delivery.\n\n${originalText}`
    });

    const translatedText = translation.output_text?.trim();
    if (!translatedText) {
      return NextResponse.json({ error: "Translation failed." }, { status: 422 });
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: translatedText
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    return NextResponse.json({
      originalText,
      translatedText,
      translatedAudio: audioBuffer.toString("base64"),
      translatedMimeType: "audio/mpeg"
    });
  } catch (error) {
    console.error("Translation pipeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
