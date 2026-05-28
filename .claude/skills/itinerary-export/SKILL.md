---
name: itinerary-export
description: 나들이 일정표 렌더링, 단순화 뷰(Simple View), PDF 내보내기를 구현한다. 일정표 화면, 어르신용 큰 글씨 뷰, PDF 출력 버튼, GET /api/itinerary/{planId}/export 작업 시 반드시 이 스킬을 사용할 것.
---

## Simple View 설계 원칙

디지털 약자(어르신, digital_literacy === 'low') 전용. 일반 뷰와 완전히 분리된 컴포넌트로 작성한다.

```typescript
// SimpleView.tsx — 독립 컴포넌트
const SimpleView: React.FC<{ plan: OutingPlan }> = ({ plan }) => (
  <div className="simple-view p-6 bg-white">
    {/* 장소명: 28px, 볼드 */}
    <h1 className="text-4xl font-bold text-gray-900 mb-4">{plan.title}</h1>
    {plan.selectedCourse?.items.map((item, i) => (
      <SimpleItineraryCard key={i} item={item} />
    ))}
  </div>
);

const SimpleItineraryCard = ({ item }: { item: ItineraryItem }) => (
  <div className="border-2 border-gray-300 rounded-xl p-5 mb-4">
    {/* 시간: 큰 글씨 */}
    <p className="text-3xl font-bold text-blue-700">{item.startTime}</p>
    {/* 장소명: 28px 이상 */}
    <p className="text-2xl font-semibold text-gray-900 mt-2">{item.place.name}</p>
    {/* 접근성 아이콘 + 텍스트 병기 */}
    <div className="flex gap-2 mt-2">
      {item.place.wheelchairAccessible && <Badge icon="♿" label="휠체어 이용 가능" />}
      {item.place.strollerFriendly && <Badge icon="🍼" label="유모차 이용 가능" />}
    </div>
    {/* 소요 시간 */}
    <p className="text-xl text-gray-600 mt-2">{item.duration}분 머물기</p>
  </div>
);
```

## 뷰 전환 로직
```typescript
// 자동 Simple View 선택 (digital_literacy === 'low')
const hasLowLiteracyMember = memberProfiles.some(m => m.digitalLiteracy === "low");
const [viewMode, setViewMode] = useState<"normal" | "simple">(
  hasLowLiteracyMember ? "simple" : "normal"
);
```

## PDF 내보내기
```typescript
// 1순위: @react-pdf/renderer
import { PDFDownloadLink } from "@react-pdf/renderer";

const ItineraryPDF = ({ plan }) => (
  <PDFDownloadLink
    document={<ItineraryDocument plan={plan} />}
    fileName={`나들이일정_${plan.id}_${plan.date}.pdf`}
  >
    PDF 저장
  </PDFDownloadLink>
);

// 폴백: window.print() (라이브러리 실패 시)
const handlePrint = () => {
  try {
    // @react-pdf/renderer 시도
    setPdfMode(true);
  } catch {
    // 폴백
    window.print();
  }
};
```

## CSS 인쇄 최적화
```css
/* src/features/itinerary/print.css */
@media print {
  .no-print { display: none !important; }          /* 네비게이션, 버튼 숨김 */
  .itinerary-card { page-break-inside: avoid; }    /* 카드 중간 페이지 분리 방지 */
  body { background: white !important; }
  * { color: black !important; }                    /* 배경색 제거 */
  .simple-view { font-size: 18pt !important; }      /* 인쇄 시 Simple View 크기 유지 */
}
```

## WCAG AA 색상 기준
```typescript
// Tailwind 클래스로 WCAG AA 준수 (4.5:1+ 명도 대비)
// ✅ text-gray-900 on white = 21:1
// ✅ text-blue-700 on white = 8.6:1
// ❌ text-gray-400 on white = 1.9:1 (금지)

const A11Y_COLORS = {
  primary: "text-gray-900",      // 제목, 장소명
  secondary: "text-gray-700",   // 부제목, 시간
  accent: "text-blue-700",      // 강조 (시간, 접근성)
  // Simple View에서는 secondary 대신 primary 사용
};
```

## 컴포넌트 구조
```
src/features/itinerary/
├── ItineraryView.tsx      # 일반 뷰 (기본)
├── SimpleView.tsx         # 단순화 뷰 (완전 별도)
├── ViewToggle.tsx         # 일반↔단순화 전환 토글
├── PrintButton.tsx        # PDF/인쇄 버튼 (폴백 포함)
├── ItineraryCard.tsx      # 장소 카드 (일반)
└── print.css              # 인쇄 최적화 CSS
```
