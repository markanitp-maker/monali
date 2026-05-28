// AI 클라이언트 — GEMMA_SKILL.md 기준 구현 (Edge Function 공용 사본)
// src/lib/ai-client.ts 와 1:1 동일. 변경 시 양쪽 동기화 필수.

import { GoogleGenAI } from "npm:@google/genai";

// ============================================================
// 모델 설정
// ============================================================
export type GemmaModel = "gemma-4-31b-it" | "gemma-4-26b-a4b-it";

const PRIMARY_MODELS: Record<"premium" | "standard", GemmaModel> = {
  premium: "gemma-4-31b-it",
  standard: "gemma-4-26b-a4b-it",
};

// ============================================================
// Rate Limiter (모델별 독립 인스턴스, RPM 14 안전 마진)
// ============================================================
class RateLimiter {
  private queue: number[] = [];
  private readonly maxPerMinute = 14;

  async acquire(): Promise<void> {
    const now = Date.now();
    this.queue = this.queue.filter((t) => now - t < 60_000);
    if (this.queue.length >= this.maxPerMinute) {
      const wait = 60_000 - (now - this.queue[0]) + 100;
      await new Promise((r) => setTimeout(r, wait));
      return this.acquire();
    }
    this.queue.push(now);
  }
}

export const limiters: Record<GemmaModel, RateLimiter> = {
  "gemma-4-31b-it": new RateLimiter(),
  "gemma-4-26b-a4b-it": new RateLimiter(),
};

// ============================================================
// 429/503 에러 처리
// ============================================================
export class ModelUnavailableError extends Error {
  constructor(model: GemmaModel) {
    super(`Model ${model} unavailable (503)`);
  }
}

function parseRetryDelay(err: unknown): number | null {
  const e = err as { error?: { details?: Array<{ "@type"?: string; retryDelay?: string }> } };
  const detail = e?.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
  if (!detail?.retryDelay) return null;
  return parseInt(detail.retryDelay.replace("s", "")) * 1000;
}

export async function callWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { status?: number };
      if (e?.status === 429) {
        const base = parseRetryDelay(err) ?? Math.pow(2, attempt) * 1000;
        const wait = base + 5_000 + Math.random() * 1_000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (e?.status === 503) {
        throw new ModelUnavailableError("gemma-4-31b-it");
      }
      throw err;
    }
  }
  throw new Error("Max retry attempts exceeded");
}

// ============================================================
// JSON 파싱 — responseMimeType 절대 미사용
// ============================================================
export function extractJSON(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* continue */ }
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* continue */ }
  }
  console.error("[extractJSON] 파싱 실패 (500자):", text.substring(0, 500));
  throw new Error("No valid JSON in AI response");
}

// ============================================================
// 통합 호출 함수
// ============================================================
export interface GemmaCallOptions {
  quality?: "premium" | "standard";
  systemPersona?: string;
  temperature?: number;
}

export async function callGemma(
  prompt: string,
  options: GemmaCallOptions = {},
): Promise<string> {
  const {
    quality = "standard",
    systemPersona = "당신은 정확하고 신중한 한국어 전문가입니다.",
    temperature = 1.0,
  } = options;

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수 미설정");

  const ai = new GoogleGenAI({ apiKey });
  const primary = PRIMARY_MODELS[quality];
  const fallback: GemmaModel = primary === "gemma-4-31b-it"
    ? "gemma-4-26b-a4b-it"
    : "gemma-4-31b-it";

  const callOnce = async (model: GemmaModel): Promise<string> => {
    await limiters[model].acquire();
    const result = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: systemPersona,
        temperature,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 6000,
        // responseMimeType 절대 사용하지 않음 — silent hang 발생
      },
    });
    return result.text ?? "";
  };

  try {
    return await callWithBackoff(() => callOnce(primary));
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      console.warn(`${primary} 503 → ${fallback} 폴백`);
      return await callWithBackoff(() => callOnce(fallback));
    }
    throw err;
  }
}

// ============================================================
// 타임아웃 보호 (150초 하드 리밋, 140초 안전 마진)
// ============================================================
export const EDGE_TIMEOUT_MS = 140_000;

export function withTimeout<T>(promise: Promise<T>, ms = EDGE_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("EDGE_TIMEOUT")), ms),
    ),
  ]);
}

/**
 * 모델 라벨 — places 단계 등에서 ai_model_used 컬럼에 기록
 */
export function modelLabel(quality: "premium" | "standard"): string {
  return PRIMARY_MODELS[quality];
}
