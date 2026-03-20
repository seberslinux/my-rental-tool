import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/AppLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import CalendarPage from '@/pages/CalendarPage';
import CleanersPage from '@/pages/CleanersPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import PropertiesPage from '@/pages/PropertiesPage';
import MorePage from '@/pages/MorePage';
import FinancesPage from '@/pages/FinancesPage';
import MaintenancePage from '@/pages/MaintenancePage';
import UsersPage from '@/pages/UsersPage';
import SettingsPage from '@/pages/SettingsPage';
import ReviewsPage from '@/pages/ReviewsPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/cleaners" element={<CleanersPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/more" element={<MorePage />} />
                <Route path="/finances" element={<FinancesPage />} />
                <Route path="/maintenance" element={<MaintenancePage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/reviews" element={<ReviewsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppLayout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
