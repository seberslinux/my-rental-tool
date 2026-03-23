import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { CalendarHeader } from './components/CalendarHeader';
import { MonthCalendar } from './components/MonthCalendar';
import { TimelineView } from './components/TimelineView';
import { TabBar } from './components/TabBar';
import { BookingDetailSheet } from './components/BookingDetailSheet';
import { AppHeader } from './components/AppHeader';
import { DashboardPage } from './components/DashboardPage';
import { MorePage } from './components/MorePage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { LoginPage } from './components/LoginPage';
import { CleanersPage } from './components/CleanersPage';
import { PropertiesPage } from './components/PropertiesPage';
import { UsersPage } from './components/UsersPage';
import { properties, bookings, Booking, loadCalendarData } from './data/properties';
import { loadDashboardData, setPropertyFilter, setOnDataChanged } from './data/dashboard';
import { loadAnalyticsData } from './data/analytics';
export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  // Calendar state (existing)
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [propertyId, setPropertyId] = useState<number>(0);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [dashboardPropertyFilter, setDashboardPropertyFilter] = useState<number>(0);
  const [dashboardVersion, setDashboardVersion] = useState(0);

  // Subscribe to dashboard data changes for re-renders
  useEffect(() => {
    setOnDataChanged(() => setDashboardVersion((v) => v + 1));
  }, []);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          setIsLoggedIn(true);
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  // Load API data once authenticated
  const loadData = useCallback(async () => {
    await Promise.all([loadCalendarData(), loadDashboardData(), loadAnalyticsData()]);
    // Default to first property
    if (properties.length > 0 && propertyId === 0) {
      setPropertyId(properties[0].id);
    }
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
    }
  }, [isLoggedIn, loadData]);

  // Filter bookings based on channel — use dataLoaded as dep to re-compute after fetch
  const filteredBookings = useMemo(() => {
    if (!dataLoaded) return [];
    let filtered = bookings;
    if (channelFilter !== 'all') {
      filtered = filtered.filter((b) => b.type === channelFilter);
    }
    return filtered;
  }, [channelFilter, dataLoaded]);
  // For single mode, filter by property as well
  const singleModeBookings = useMemo(() => {
    return filteredBookings.filter((b) => b.propId === propertyId);
  }, [filteredBookings, propertyId]);
  const getPageTitle = () => {
    switch (activeTab) {
      case 'home':
        return 'My Rentals';
      case 'cleaners':
        return 'Cleaners';
      case 'analytics':
        return 'Analytics';
      case 'properties':
        return 'Properties';
      case 'users':
        return 'Users';
      case 'more':
        return 'More';
      default:
        return '';
    }
  };

  // Show loading spinner while checking auth or loading data
  if (!authChecked || (isLoggedIn && !dataLoaded)) {
    return (
      <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#FF385C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F7F7F7] font-sans text-[#222222] antialiased">
      {activeTab === 'calendar' ?
      <CalendarHeader
        mode={mode}
        setMode={setMode}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
        channelFilter={channelFilter}
        setChannelFilter={setChannelFilter} /> :


      <AppHeader
        title={getPageTitle()}
        propertyFilter={activeTab === 'home' ? {
          properties: properties.map((p) => ({ id: p.id, name: p.name })),
          selected: dashboardPropertyFilter,
          onChange: (id) => { setDashboardPropertyFilter(id); setPropertyFilter(id); },
        } : undefined}
        onRefresh={async () => {
          await fetch('/api/sync/bookings', { method: 'POST', credentials: 'same-origin' });
          await loadData();
        }} />
      }

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[64px]">
        {activeTab === 'home' && <DashboardPage key={dashboardVersion} />}

        {activeTab === 'calendar' && (
        mode === 'single' ?
        <MonthCalendar
          propertyId={propertyId}
          bookings={singleModeBookings}
          onBookingClick={setSelectedBooking} /> :


        <TimelineView
          properties={properties}
          bookings={filteredBookings}
          onBookingClick={setSelectedBooking} />)

        }

        {activeTab === 'cleaners' && <CleanersPage />}
        {activeTab === 'analytics' && <AnalyticsPage />}
        {activeTab === 'properties' && <PropertiesPage />}
        {activeTab === 'users' && <UsersPage />}
        {activeTab === 'more' && <MorePage onNavigate={setActiveTab} onLogout={() => { setIsLoggedIn(false); setDataLoaded(false); }} />}
      </main>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'calendar' &&
      <BookingDetailSheet
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)} />

      }
    </div>);

}
