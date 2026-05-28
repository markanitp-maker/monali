---
name: gemma4-integration
description: Google AI Studio Gemini API를 통해 Gemma 4 모델(gemma-4-31b-it, gemma-4-26b-a4b-it)을 안전하고 효율적으로 호출한다. AI 코스 생성, Gemma 모델 호출, @google/genai SDK 사용, 429/503 에러 처리, JSON 응답 파싱, Promise.allSettled 병렬 처리, Edge Function 타임아웃 관리가 필요한 모든 작업에 반드시 이 스킬을 사용할 것. responseMimeType 사용은 절대 금지.
---

## 1. 사용 모델 (Gemini API 한정)

| 모델 ID | 아키텍처 | 활성 파라미터 | 역할 |
|---|---|---|---|
| `gemma-4-31b-it` | Dense | 30.7B | Premium (복잡한 추론, 코스 설계) |
| `gemma-4-26b-a4b-it` | MoE | 3.8B 활성 | Standard (빠른 처리, 장소 검증) |

두 모델 모두 **Thinking OFF**로 운영. E2B/E4B는 온디바이스 전용으로 Gemini API 호출 불가.

## 2. SDK — @google/genai 필수

```typescript
// ✅ 올바른 import
import { GoogleGenAI } from "npm:@google/genai";  // Deno Edge Function
// import { GoogleGenAI } from "@google/genai";    // Node.js

// ❌ 절대 금지
// import { GoogleGenerativeAI } from "@google/generative-ai";  // 구버전 deprecated
// fetch("https://generativelanguage.googleapis.com/...")        // REST 직접 호출
```

REST 직접 호출은 `systemInstruction` 무시, 빈 응답, 예측 불가 동작이 보고됨.

## 3. API 키 보안 — Edge Function 프록시 필수

```typescript
// ✅ supabase/functions/gemma-proxy/index.ts
import { GoogleGenAI } from "npm:@google/genai";

Deno.serve(async (req) => {
  const apiKey = Deno.env.get("GEMINI_API_KEY"); // 서버에만 존재
  const ai = new GoogleGenAI({ apiKey });
  const { model, contents, config } = await req.json();
  const result = await ai.models.generateContent({ model, contents, config });
  return Response.json(result);
});
```

```bash
# 환경변수 설정 — VITE_/NEXT_PUBLIC_ 접두사 절대 금지
npx supabase secrets set GEMINI_API_KEY="your_key" --project-ref YOUR_REF
```

## 4. 무료 티어 Rate Limit

| 모델 | RPM | RPD |
|---|---|---|
| `gemma-4-31b-it` | 15 | 1,500 |
| `gemma-4-26b-a4b-it` | 15 | 1,500 |

두 모델 quota 독립 → 합산 최대 30 RPM / 3,000 RPD. RPD는 Pacific Time 자정 리셋.

> ⚠️ 무료 티어 입력 데이터는 Google 모델 학습에 사용됨. 사용자 PII(가족 제약 정보 등)는 Tier 1 유료 플랜 전환 후 사용 권장.

## 5. 클라이언트 Throttle (RPM 14 안전 마진)

```typescript
class RateLimiter {
  private queue: number[] = [];
  private readonly maxPerMinute = 14; // 15에서 안전 마진 1

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

// 모델별 독립 인스턴스
const limiters: Record<string, RateLimiter> = {
  "gemma-4-31b-it": new RateLimiter(),
  "gemma-4-26b-a4b-it": new RateLimiter(),
};
```

## 6. 429/503 에러 처리

- **429**: 동일 모델 지수 백오프 + jitter (모델 전환 금지)
- **503**: 다른 모델로 전환

```typescript
class ModelUnavailableError extends Error {}

async function callWithBackoff<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.status === 429) {
        const retryDelay = parseRetryDelay(err) ?? Math.pow(2, attempt) * 1000;
        const wait = retryDelay + 5000 + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (err.status === 503) throw new ModelUnavailableError();
      throw err;
    }
  }
  throw new Error("Max retry attempts exceeded");
}

function parseRetryDelay(err: any): number | null {
  const detail = err?.error?.details?.find((d: any) => d["@type"]?.includes("RetryInfo"));
  if (!detail?.retryDelay) return null;
  return parseInt(detail.retryDelay.replace("s", "")) * 1000;
}
```

## 7. 모델 선택 및 통합 호출

```typescript
type GemmaModel = "gemma-4-31b-it" | "gemma-4-26b-a4b-it";

function selectModel(quality: "premium" | "standard"): GemmaModel {
  return quality === "premium" ? "gemma-4-31b-it" : "gemma-4-26b-a4b-it";
}

async function callGemma(
  prompt: string,
  quality: "premium" | "standard" = "standard",
  systemPersona = "당신은 정확하고 신중한 한국어 전문가입니다."
) {
  const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY")! });
  const primary = selectModel(quality);
  const fallback: GemmaModel = primary === "gemma-4-31b-it" ? "gemma-4-26b-a4b-it" : "gemma-4-31b-it";

  const callOnce = async (model: GemmaModel) => {
    await limiters[model].acquire();
    return await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: systemPersona,
        temperature: 1.0,  // 공식 표준값
        topP: 0.95,
        topK: 64,
      },
    });
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
```

## 8. JSON 응답 처리

### ❌ 절대 금지
```typescript
config: { responseMimeType: "application/json" }  // silent hang, 타임아웃 발생
```

### ✅ 프롬프트 스키마 강제 + extractJSON

```typescript
// 프롬프트 끝에 추가
const jsonPrompt = `${basePrompt}

[중요] 반드시 아래 JSON 형식으로만 응답하세요.
마크다운, 설명 없이 순수 JSON만 출력하세요. 첫 글자는 반드시 { 이어야 합니다.

출력 형식:
${JSON.stringify(schemaExample, null, 2)}`;

function extractJSON(text: string): any {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) { try { return JSON.parse(codeBlock[1].trim()); } catch {} }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch {} }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[0]); } catch {} }

  console.error("[extractJSON] 파싱 실패:", text.substring(0, 500));
  throw new Error("No valid JSON in response");
}
```

스키마의 키 이름을 정확히 지정하라 — 미지정 시 Gemma가 매번 다른 키를 생성함.

## 9. Promise.allSettled 병렬 처리

```typescript
// ✅ 안전 — 하나 실패해도 나머지 정상
const results = await Promise.allSettled(
  items.map(item => callGemma(buildPrompt(item)))
);

const parsed = results.map((r, i) =>
  r.status === "fulfilled"
    ? { success: true, data: extractJSON(r.value.text ?? "") }
    : { success: false, error: r.reason?.message, itemId: items[i].id }
);

// ❌ 금지
// await Promise.all(...)
```

## 10. Edge Function 타임아웃 계산

```
총 최악 시간 = TIMEOUT_MS × RETRY_DELAYS × MODELS ≤ 150초

예: 30초 × 3회 × 2모델 = 180초 ❌
   30초 × 3회 × 1모델 + 30초 × 1회 = 120초 ✅
```

긴 응답은 스트리밍으로 idle timeout 리셋:

```typescript
const stream = await ai.models.generateContentStream({ model, contents, config });
const body = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    for await (const chunk of stream) {
      controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
    }
    controller.close();
  },
});
return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
```

## 11. 샘플링 파라미터 표준값

```typescript
config: { temperature: 1.0, topP: 0.95, topK: 64 }
```

특수 결정성 필요 시(코드 생성 등)만 별도 조정. 나머지는 표준값 유지.

## 체크리스트

- [ ] `@google/genai` 사용, 구버전/REST 금지
- [ ] `GEMINI_API_KEY` Edge Function secrets에만 저장, `VITE_` 접두사 금지
- [ ] 31B(premium) / 26B-A4B(standard) 품질별 분배
- [ ] 429 → 동일 모델 백오프, 503 → 모델 전환
- [ ] 모델별 RateLimiter 인스턴스 (RPM 14 이하)
- [ ] `responseMimeType` 절대 미사용, `extractJSON` 파싱 사용
- [ ] `Promise.allSettled` 사용 (`Promise.all` 금지)
- [ ] temperature 1.0 / topP 0.95 / topK 64 표준값
- [ ] Edge Function 총 최악 시간 ≤ 150초 계산 검증
- [ ] 민감 PII는 Tier 1 유료 플랜 사용
