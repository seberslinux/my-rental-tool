import React, { useMemo, useState } from 'react';
import { CalendarHeader } from './components/CalendarHeader';
import { MonthCalendar } from './components/MonthCalendar';
import { TimelineView } from './components/TimelineView';
import { TabBar } from './components/TabBar';
import { BookingDetailSheet } from './components/BookingDetailSheet';
import { AppHeader } from './components/AppHeader';
import { DashboardPage } from './components/DashboardPage';
import { MorePage } from './components/MorePage';
import { PlaceholderPage } from './components/PlaceholderPage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { LoginPage } from './components/LoginPage';
import { CleanersPage } from './components/CleanersPage';
import { PropertiesPage } from './components/PropertiesPage';
import { properties, bookings, Booking } from './data/properties';
export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  // Calendar state (existing)
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [propertyId, setPropertyId] = useState<number>(1);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  // Filter bookings based on channel
  const filteredBookings = useMemo(() => {
    let filtered = bookings;
    if (channelFilter !== 'all') {
      filtered = filtered.filter((b) => b.type === channelFilter);
    }
    return filtered;
  }, [channelFilter]);
  // For single mode, filter by property as well
  const singleModeBookings = useMemo(() => {
    return filteredBookings.filter((b) => b.propId === propertyId);
  }, [filteredBookings, propertyId]);
  const getPageTitle = () => {
    switch (activeTab) {
      case 'home':
        return 'Dashboard';
      case 'cleaners':
        return 'Cleaners';
      case 'analytics':
        return 'Analytics';
      case 'properties':
        return 'Properties';
      case 'more':
        return 'More';
      default:
        return '';
    }
  };
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


      <AppHeader title={getPageTitle()} />
      }

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[64px]">
        {activeTab === 'home' && <DashboardPage />}

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
        {activeTab === 'more' && <MorePage onNavigate={setActiveTab} />}
      </main>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'calendar' &&
      <BookingDetailSheet
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)} />

      }
    </div>);

}