---
name: share-voting
description: 비회원 동반자 공유 링크 생성, 장소별(item_id) 찬반 투표, Silent Consent 자동 동의, 실시간 집계를 구현한다. share_token 생성, 비회원 identify/vote, consensus_deadline, ip_hash rate limit 작업 시 반드시 이 스킬을 사용할 것. share-coordinator 에이전트와 함께 사용.
---

## 핵심 구조 (Plan.md FR-003 기준)

- **투표 단위**: course_option 전체가 아닌 `item_id`(장소) 단위 찬반
- **비회원 식별**: `guest_token` (UUID) — identify 엔드포인트에서 발급
- **마감**: `consensus_deadline` — 호스트 지정 1~48시간, 도래 시 무응답자 자동 동의 (Silent Consent)
- **재투표**: `UNIQUE(member_id, item_id)` + upsert (의견 변경 가능)
- **반대율 50%+**: AI 자동 재추천 트리거

## share_token 생성 패턴
```typescript
// POST /api/trips/:planId/share
const { consensusDeadlineHours } = await req.json(); // 1~48
const shareToken = crypto.randomUUID();
const consensusDeadline = new Date(Date.now() + consensusDeadlineHours * 60 * 60 * 1000);

await supabase
  .from("trips")
  .update({
    share_token: shareToken,
    consensus_deadline: consensusDeadline.toISOString(),
  })
  .eq("trip_id", planId)
  .eq("host_user_id", userId); // 호스트 본인만 발급 가능

const shareUrl = `${Deno.env.get("PUBLIC_URL")}/share/${shareToken}`;
return Response.json({ shareToken, shareUrl, consensusDeadline });
```

## 공개 조회 엔드포인트
```typescript
// GET /api/share/:token — 인증 없이 접근 가능
const supabase = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!);

const { data: trip } = await supabase
  .from("trips")
  .select(`
    trip_id, title, scheduled_date, status, consensus_deadline,
    course_options (
      course_id, course_name, is_selected,
      itinerary_items (
        item_id, sequence_order, stay_duration_minutes,
        places ( place_id, name, address, accessibility_score, wheelchair_accessible )
      )
    )
  `)
  .eq("share_token", token)
  .single();

if (!trip) return new Response(null, { status: 410 }); // 만료/미존재
```

## 비회원 identify 패턴
```typescript
// POST /api/share/:token/identify
const { guest_name } = await req.json();

// IP 해시 (rate limit용)
const ip = req.headers.get("x-forwarded-for") ?? "unknown";
const salt = Deno.env.get("IP_HASH_SALT")!;
const ipHash = await hashSHA256(ip + salt);

// 기존 방문자 확인 또는 신규 등록
const { data: member } = await supabase
  .from("plan_members")
  .upsert(
    { trip_id: tripId, guest_name, ip_hash: ipHash, guest_token: crypto.randomUUID() },
    { onConflict: "trip_id,guest_name", ignoreDuplicates: false }
  )
  .select()
  .single();

return Response.json({ member_id: member.member_id, guest_token: member.guest_token });
```

## 투표 엔드포인트
```typescript
// POST /api/share/:token/vote
const VoteSchema = z.object({
  guest_token: z.string().uuid(),
  votes: z.array(z.object({
    item_id: z.string().uuid(),
    is_positive: z.boolean(),
    comment: z.string().max(200).optional(),
  })),
});

// guest_token으로 member 확인
const { data: member } = await supabase
  .from("plan_members")
  .select("member_id, trip_id")
  .eq("guest_token", guestToken)
  .single();

// deadline 확인
if (new Date() > new Date(trip.consensus_deadline)) {
  return Response.json({ error: "투표 기간이 종료되었습니다" }, { status: 410 });
}

// item_id 단위 upsert (재투표 = 의견 변경)
const { data: saved } = await supabase
  .from("votes")
  .upsert(
    votes.map(v => ({
      member_id: member.member_id,
      item_id: v.item_id,
      is_positive: v.is_positive,
      comment: v.comment,
    })),
    { onConflict: "member_id,item_id" }
  )
  .select();

return Response.json({ saved_votes: saved, consensus_status: await getConsensusStatus(tripId) });
```

## Silent Consent 처리
```typescript
// consensus_deadline 도래 시 무응답자 자동 동의
// Supabase cron job 또는 Edge Function 트리거로 호출
const processSilentConsent = async (tripId: string) => {
  // is_agreed가 NULL인 구성원을 자동 true로 갱신
  await supabase
    .from("plan_members")
    .update({ is_agreed: true })
    .eq("trip_id", tripId)
    .is("is_agreed", null);
};

// trips.consensus_deadline < NOW() 조건으로 스케줄 실행
```

## IP Rate Limit 패턴
```typescript
const checkRateLimit = async (ipHash: string) => {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000); // 1시간 창
  const { count } = await supabase
    .from("plan_members")
    .select("*", { count: "exact" })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart.toISOString());

  if (count && count >= 10) {
    return Response.json({ error: "Too Many Requests" }, { status: 429 });
  }
};
```

## SHA-256 해시 유틸
```typescript
const hashSHA256 = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
};
```

## 타입 정의 (src/types/share.ts)
```typescript
export interface Vote {
  vote_id: string;
  member_id: string;
  item_id: string;        // 장소 단위 투표 (course_option 아님)
  is_positive: boolean;
  comment?: string;
  created_at: string;
}

export interface PlanMember {
  member_id: string;
  trip_id: string;
  guest_name: string;
  guest_token: string;
  ip_hash: string;
  is_agreed: boolean | null;  // null = 미응답 (Silent Consent 대상)
}

export interface ConsensusSummary {
  total_members: number;
  responded: number;
  agreed: number;
  deadline: string;
  is_expired: boolean;
}

export interface ItemVoteSummary {
  item_id: string;
  positive: number;
  negative: number;
  comments: { guest_name: string; text: string }[];
}
```

## React 컴포넌트
```
src/features/share/
├── SharePage.tsx         # 공유 링크 진입 페이지 (비회원)
├── IdentifyForm.tsx      # 이름 입력 (첫 방문 시)
├── VoteCard.tsx          # 장소별 찬반 카드
├── VoteResult.tsx        # 실시간 투표 현황
└── CountdownTimer.tsx    # consensus_deadline 카운트다운
```

## 에러 케이스
- 410 Gone: 만료/미존재 토큰 → "링크가 만료되었습니다" 안내
- 410 Gone: 투표 기간 종료 후 vote 시도
- 재투표: 200 OK + upsert ("의견을 변경하셨습니다" 안내)
- 429: IP rate limit 초과
