---
name: archive
description: 나들이 완료 후 접근성 피드백 기록, OutingArchive 저장, 아카이브 리스트 UI, Place 접근성 점수 피드백 루프를 구현한다. POST /api/archive, 아카이브 화면, 만족도 평점, 사진 첨부 작업 시 반드시 이 스킬을 사용할 것.
---

## 타입 정의 (src/types/archive.ts)
```typescript
export interface AccessibilityFeedback {
  placeId: string;
  placeName: string;
  actualAccessible: boolean;    // 실제 접근 가능 여부 (AI 예측과 다를 수 있음)
  notes?: string;               // "엘리베이터 고장", "임시 경사로 있음" 등
}

export interface OutingArchive {
  id: string;
  planId: string;
  overallRating: 1 | 2 | 3 | 4 | 5;
  accessibilityFeedback: AccessibilityFeedback[];
  memo?: string;
  photoUrls?: string[];
  createdAt: string;
}
```

## Edge Function 패턴
```typescript
// POST /api/archive — upsert (1 Plan → 1 Archive)
const ArchiveSchema = z.object({
  planId: z.string().uuid(),
  overallRating: z.number().int().min(1).max(5),
  accessibilityFeedback: z.array(z.object({
    placeId: z.string().uuid(),
    actualAccessible: z.boolean(),
    notes: z.string().max(500).optional(),
  })),
  memo: z.string().max(2000).optional(),
});

const body = ArchiveSchema.parse(await req.json());

// 아카이브 저장
const { data: archive, error } = await supabase
  .from("outing_archives")
  .upsert(
    { plan_id: body.planId, overall_rating: body.overallRating,
      accessibility_feedback: body.accessibilityFeedback, memo: body.memo },
    { onConflict: "plan_id" }
  )
  .select()
  .single();

if (error) throw error;

// 피드백 루프: Place 접근성 점수 업데이트 (비동기, 실패해도 아카이브는 저장)
updatePlaceScores(body.accessibilityFeedback).catch(console.error);
```

## 피드백 루프 (Place.accessibility_score 업데이트)
```typescript
const updatePlaceScores = async (feedbacks: AccessibilityFeedback[]) => {
  await Promise.allSettled(
    feedbacks.map(async (fb) => {
      // 해당 Place의 모든 피드백 집계
      const { data: allFeedbacks } = await supabase
        .from("outing_archives")
        .select("accessibility_feedback")
        .contains("accessibility_feedback", [{ placeId: fb.placeId }]);

      const scores = allFeedbacks
        ?.flatMap(a => a.accessibility_feedback)
        .filter(f => f.placeId === fb.placeId)
        .map(f => f.actualAccessible ? 1 : 0) ?? [];

      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0.5;

      await supabase
        .from("places")
        .update({ accessibility_score: avgScore })
        .eq("id", fb.placeId);
    })
  );
};
```

## 사진 업로드 (Supabase Storage)
```typescript
const uploadPhotos = async (archiveId: string, files: File[]) => {
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const path = `archive/${archiveId}/${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage
        .from("outing-photos")
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      return supabase.storage.from("outing-photos").getPublicUrl(data.path).data.publicUrl;
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<string>).value);
};
```

## React 컴포넌트 구조
```
src/features/archive/
├── ArchiveList.tsx     # 완료된 나들이 목록 (날짜 내림차순, 썸네일)
├── ArchiveForm.tsx     # 피드백 입력 폼 (장소별 체크 + 전체 만족도)
├── ArchiveDetail.tsx   # 아카이브 상세 보기
├── StarRating.tsx      # 별점 컴포넌트
└── PhotoUpload.tsx     # 사진 첨부 (선택)
```

## UX 흐름
1. 나들이 완료 후 홈에서 "나들이 기록 남기기" 버튼
2. 전체 만족도 별점 선택
3. 방문 장소별 "실제 접근 가능했나요?" 체크
4. 간단한 메모 + 사진 첨부 (선택)
5. 저장 완료 → 아카이브 리스트로 이동
