import { Routes, Route, Navigate } from "react-router-dom";

import { PlannerHome } from "@/features/planner/PlannerHome";
import { GeneratorForm } from "@/features/planner/GeneratorForm";
import { AiProgressView } from "@/features/planner/AiProgressView";
import { CourseComparison } from "@/features/planner/CourseComparison";
import { ItineraryView } from "@/features/itinerary/ItineraryView";
import { SharePage } from "@/features/share/SharePage";
import { ArchiveList } from "@/features/archive/ArchiveList";
import { ArchiveForm } from "@/features/archive/ArchiveForm";
import { ArchiveDetail } from "@/features/archive/ArchiveDetail";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<OnboardingPage />} />

      {/* 공유 페이지 (비회원 접근 가능, 네비 없음) */}
      <Route path="/share/:token" element={<SharePage />} />

      {/* 인증 필요 + BottomNav 있는 라우트 */}
      <Route
        path="/planner"
        element={<ProtectedRoute><AppLayout><PlannerHome /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/planner/new"
        element={<ProtectedRoute><AppLayout><GeneratorForm /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/planner/progress/:taskId"
        element={<ProtectedRoute><AppLayout><AiProgressView /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/planner/:planId"
        element={<ProtectedRoute><AppLayout><CourseComparison /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/itinerary/:planId"
        element={<ProtectedRoute><AppLayout><ItineraryView /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/archive"
        element={<ProtectedRoute><AppLayout><ArchiveList /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/archive/:planId/feedback"
        element={<ProtectedRoute><AppLayout><ArchiveForm /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/archive/:id"
        element={<ProtectedRoute><AppLayout><ArchiveDetail /></AppLayout></ProtectedRoute>}
      />
      <Route
        path="/profile"
        element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>}
      />
    </Routes>
  );
}

export default App;
