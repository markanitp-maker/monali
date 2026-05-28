# AI 코스 생성 프롬프트 템플릿

## 시스템 프롬프트
```
당신은 한국의 무장애 가족 나들이 코스를 설계하는 전문가입니다.

제약 조건:
- 이동 제약: {mobilityConstraints} (해당 제약이 있는 경우 모든 장소가 접근 가능해야 함)
- 식이 제한: {dietaryConstraints} (식당 추천 시 반드시 반영)

규칙:
1. 실제 존재하는 장소만 제안하라. 장소명, 주소, 위도/경도를 정확히 제공하라.
2. 각 장소의 접근성은 별도로 검증될 것이므로, 알고 있는 정보를 솔직히 전달하라.
3. 코스는 2개 제안하라 — 하나는 실내 중심, 하나는 야외 중심.
4. 총 소요 시간은 4-8시간 범위로 설계하라.
5. 반드시 JSON 형식으로만 출력하라.
```

## 사용자 프롬프트
```
나들이 정보:
- 날짜: {date}
- 출발/도착 지역: {region}
- 희망 카테고리: {preferences}
- 구성원 수: {memberCount}명

코스 2개를 다음 JSON 형식으로 출력하라:
{
  "courses": [
    {
      "title": "코스명",
      "description": "코스 특징 2줄",
      "recommendationReason": "이 가족에게 추천하는 이유",
      "places": [
        {
          "name": "장소명",
          "address": "전체 주소",
          "lat": 37.123,
          "lng": 127.456,
          "category": "공원|박물관|식당|카페|기타",
          "estimatedDuration": 60,
          "accessibilityNote": "알고 있는 접근성 정보 (없으면 null)"
        }
      ]
    }
  ]
}
```

## 토큰 최적화 전략

### 압축 규칙
- 시스템 프롬프트 변수 치환 후 예상 토큰: ~300
- 사용자 프롬프트: ~200
- 응답 예상: ~1000 (JSON 2코스 × 5장소)
- 총합: ~1500 토큰 (6000 한도 내)

### 구성원이 많을 때 (5명+)
제약 조건이 많아 프롬프트가 길어질 경우:
```typescript
// 제약 조건 압축
const constraints = [
  ...new Set(memberProfiles.flatMap(m => m.mobilityConstraints)),
  ...new Set(memberProfiles.flatMap(m => m.dietaryConstraints)),
].filter(c => c !== 'none');
```

## 검증 로직 (외부 API)

### 공공데이터포털 무장애 여행 정보 API
```typescript
const validateAccessibility = async (place: PlaceCandidate) => {
  const encoded = encodeURIComponent(place.name);
  const url = `https://apis.data.go.kr/B551011/KorService1/searchKeyword1?keyword=${encoded}&ServiceKey=${API_KEY}&MobileOS=ETC&MobileApp=FamilyOuting&_type=json`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
};
```

### 장소 검증 실패 처리
```typescript
// Promise.allSettled로 개별 실패 격리
const validationResults = await Promise.allSettled(
  candidatePlaces.map(validateAccessibility)
);

const places = validationResults.map((result, i) => ({
  ...candidatePlaces[i],
  verified: result.status === "fulfilled",
  accessibilityData: result.status === "fulfilled" ? result.value : null,
}));
```
