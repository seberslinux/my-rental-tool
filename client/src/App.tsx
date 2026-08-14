import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { CalendarHeader } from './components/CalendarHeader';
import { MonthCalendar } from './components/MonthCalendar';
import { TimelineView } from './components/TimelineView';
import { TabBar } from './components/TabBar';
import { TopNav } from './components/TopNav';
import { BookingDetailSheet } from './components/BookingDetailSheet';
import { AppHeader } from './components/AppHeader';
import { DashboardPage } from './components/DashboardPage';
import { MorePage } from './components/MorePage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { LoginPage } from './components/LoginPage';
import { InvitePage } from './components/InvitePage';
import { CleanerDashboard } from './components/CleanerDashboard';
import { NotificationsPanel } from './components/NotificationsPanel';
import { CleanersPage } from './components/CleanersPage';
import { PropertiesPage } from './components/PropertiesPage';
import { UsersPage } from './components/UsersPage';
import { ReportedPage } from './components/ReportedPage';
import { SmoobuConnectionPage } from './components/SmoobuConnectionPage';
import { CleaningDaySheet } from './components/CleaningDaySheet';
import { UserX, UserCheck, TriangleAlert, Check } from 'lucide-react';
import { properties, bookings, Booking, loadCalendarData, cleaningDays, loadCleaningDays, dateKey } from './data/properties';
import { loadDashboardData, setPropertyFilter, setOnDataChanged, lastSyncedAt } from './data/dashboard';
import { setUnauthorizedHandler } from './data/session';
import { AddToHomeScreen } from './components/AddToHomeScreen';
import { relativeTime } from './data/time';
import { loadAnalyticsData } from './data/analytics';

// Tabs that scope their content to a single property. The Calendar has its
// own property picker in CalendarHeader; More has nothing to scope.
const SHOWS_PROPERTY_FILTER = new Set(['home', 'analytics']);
export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unread, setUnread] = useState(0);
  // School-term bands: off until asked for.
  const [showSchoolHolidays, setShowSchoolHolidays] = useState(false);

  /**
   * One answer to an expired session, registered once.
   *
   * Panels used to each shrug at a 401 and keep their empty starting
   * state, so signing out somewhere else left a home screen cheerfully
   * reporting nothing to do and no bookings.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setIsLoggedIn(false);
      setDataLoaded(false);
      setNeedsCount(0);
    });
    return () => setUnauthorizedHandler(null);
  }, []);
  const [needsCount, setNeedsCount] = useState<number | null>(0);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  // /invite/<token> — read once at mount, before anything else decides
  // what to render.
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    const m = window.location.pathname.match(/^\/invite\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  const [userRole, setUserRole] = useState<string>('');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Set when the day sheet was opened from a bar, which already says
  // which property it is about.
  const [pickedFor, setPickedFor] = useState<{propertyId: number;reason: 'checkout' | 'checkin' | 'other';} | null>(null);
  const [cleaningVersion, setCleaningVersion] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  // Calendar state (existing)
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [propertyId, setPropertyId] = useState<number>(0);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  // Property filter lives in the top nav and applies across pages, so
  // switching tabs keeps the selection.
  const [globalPropertyFilter, setGlobalPropertyFilter] = useState<number>(0);
  const [dashboardVersion, setDashboardVersion] = useState(0);

  // Tick every 60s so the "Synced X ago" label stays fresh between data loads
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

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
          return res.json();
        }
      })
      .then((data) => {
        if (data?.role) setUserRole(data.role);
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
    setSyncedAt(lastSyncedAt);
  }, []);

  // The unread count on the bell. Polled rather than pushed — a manager
  // has the app open for minutes at a time, and a minute of staleness on
  // a badge costs nothing next to a socket to maintain.
  useEffect(() => {
    if (!isLoggedIn || userRole === 'cleaner') return;
    let alive = true;
    const read = () =>
    fetch('/api/notifications', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setUnread(d.unread || 0); })
      .catch(() => {});
    read();
    const t = setInterval(read, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [isLoggedIn, userRole, showNotifications]);

  useEffect(() => {
    // Not for cleaners: every one of these calls is a manager endpoint
    // the server now refuses them, so firing it would only fill their
    // console with 403s and slow their first paint.
    if (isLoggedIn && userRole !== 'cleaner') {
      loadData();
    }
  }, [isLoggedIn, userRole, loadData]);

  // The cleaning picture — who is free and which checkouts are short.
  //
  // Loaded separately from the rest because it is the only part that
  // changes when a cleaner touches their own calendar, and because the
  // range is the grid's range rather than the booking window's.
  useEffect(() => {
    if (!isLoggedIn || userRole === 'cleaner') return;
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 120);
    loadCleaningDays(dateKey(from), dateKey(to)).then(() => setCleaningVersion((v) => v + 1));
  }, [isLoggedIn, userRole, dashboardVersion]);

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
      case 'smoobu':
        return 'Smoobu';
      case 'reported':
        return 'Reported';
      case 'more':
        return 'More';
      default:
        return '';
    }
  };

  // Count of dashboard items needing attention (re-read each render; dashboardVersion drives re-renders)
  // What the home screen actually lists, reported up by the panel that
  // renders it. This was `needsAttention.length` — a separate
  // client-side list that TodayPanel replaced but nothing unwired, so
  // the tab badge, the page and the bell each gave a different answer.
  const attentionCount = needsCount === null ? 0 : needsCount;
  /**
   * When the last full sync finished, held in state.
   *
   * It used to be read straight off the module variable at render time.
   * Nothing re-rendered after a sync — loadData() ends with
   * setDataLoaded(true), and it was already true, so React had no reason
   * to run again — and the header kept the timestamp it drew on load.
   * Pressing Sync appeared to do nothing at all.
   */
  const syncedLabel = syncFailed ?
  'Sync failed — tap to retry' :
  syncedAt ? `Synced ${relativeTime(syncedAt)}` : 'Not synced yet';

  // Show loading spinner while checking auth or loading data
  if (!authChecked || (isLoggedIn && !dataLoaded)) {
    return (
      <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#FF385C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // An invitation has to render before the login gate — its whole purpose
  // is to admit somebody who cannot sign in yet. There is no router here,
  // so the path is read directly; redeeming it clears the URL.
  if (inviteToken && !isLoggedIn) {
    return (
      <InvitePage
        token={inviteToken}
        onDone={() => { setInviteToken(null); setIsLoggedIn(true); }} />);
  }

  if (!isLoggedIn) {
    return (
      <LoginPage
        onLogin={(role) => {
          if (role) setUserRole(role);
          setIsLoggedIn(true);
        }} />);

  }

  // A cleaner gets the cleaner's app, not the manager's.
  //
  // There was no branch here at all: a cleaner who signed in was handed
  // the full manager UI, and the API answered its requests — revenue,
  // guest names, other cleaners' rates. The server now refuses those, so
  // without this the same screen would render as a wall of failures.
  if (userRole === 'cleaner') {
    return (
      <CleanerDashboard
        onSignOut={async () => {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
          window.location.href = '/';
        }} />);
  }
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F7F7F7] font-sans text-[#222222] antialiased">
      <TopNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasNotifications={unread > 0}
        onOpenNotifications={() => setShowNotifications(true)}
        syncedLabel={syncedLabel}
        propertyFilter={SHOWS_PROPERTY_FILTER.has(activeTab) ? {
          properties: properties.map((p) => ({ id: p.id, name: p.name })),
          selected: globalPropertyFilter,
          onChange: (id) => { setGlobalPropertyFilter(id); setPropertyFilter(id); },
        } : undefined}
        onRefresh={async () => {
          // The result was thrown away, so a sync that failed — no API
          // key, Smoobu down — was indistinguishable from one that
          // worked: same unchanged label either way.
          setSyncFailed(false);
          const res = await fetch('/api/sync/bookings', { method: 'POST', credentials: 'same-origin' });
          if (!res.ok) return setSyncFailed(true);
          await loadData();
        }} />
      {activeTab === 'calendar' ?
      <CalendarHeader
        mode={mode}
        setMode={setMode}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
        channelFilter={channelFilter}
        setChannelFilter={setChannelFilter}
        showSchoolHolidays={showSchoolHolidays}
        setShowSchoolHolidays={setShowSchoolHolidays} /> :


      <AppHeader
        title={getPageTitle()}
        propertyFilter={SHOWS_PROPERTY_FILTER.has(activeTab) ? {
          properties: properties.map((p) => ({ id: p.id, name: p.name })),
          selected: globalPropertyFilter,
          onChange: (id) => { setGlobalPropertyFilter(id); setPropertyFilter(id); },
        } : undefined}
        onRefresh={async () => {
          setSyncFailed(false);
          const res = await fetch('/api/sync/bookings', { method: 'POST', credentials: 'same-origin' });
          if (!res.ok) return setSyncFailed(true);
          await loadData();
        }}
        hasNotifications={unread > 0}
        onOpenNotifications={() => setShowNotifications(true)}
        syncedLabel={syncedLabel} />
      }

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[64px] lg:pb-0">
        <div className="mx-auto w-full max-w-[1280px]">
        {activeTab === 'home' &&
        <DashboardPage
          key={dashboardVersion}
          onNavigate={setActiveTab}
          onNeedsChange={setNeedsCount}
          onGoToDay={(pid, date) => {
            // Straight to the day the item is about, with the sheet open.
            // "Assign" used to drop you on a tab and leave you to find it.
            setPropertyId(pid);
            setPickedFor(null);
            setPickedDay(date);
            setActiveTab('calendar');
          }} />
        }

        {activeTab === 'calendar' && (
        mode === 'single' ?
        <>
        {/* Gaps at the properties you are not looking at.
            The grid is one property at a time, so a checkout with nobody
            on it at the other one is invisible — I only found the 10 Aug
            one by switching. The data covers every property already; this
            is the only thing that was missing. */}
        {(() => {
          const elsewhere = Object.entries(cleaningDays).
          filter(([date]) => date >= dateKey(new Date())).
          flatMap(([date, day]) =>
          (day.unmet || []).
          filter((u) => u.property_id !== propertyId).
          map((u) => ({ date, ...u }))).
          sort((a, b) => a.date.localeCompare(b.date));
          if (elsewhere.length === 0) return null;

          const first = elsewhere[0];
          return (
            <button
              onClick={() => setPropertyId(first.property_id)}
              className="w-full mb-2 flex items-center gap-2 text-left px-3 py-2 rounded-[8px] border border-[#F0C36D] bg-[#FFFBEB] text-[13px] text-[#92400E]">
              <UserX className="w-4 h-4 shrink-0" strokeWidth={2.25} />
              <span className="flex-1 min-w-0">
                {elsewhere.length === 1 ?
                `${first.property_name} checks out on ${new Date(first.date + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} with no cleaner` :
                `${elsewhere.length} checkouts at other properties have no cleaner`}
              </span>
              <span className="shrink-0 font-semibold underline underline-offset-2">
                Show {first.property_name}
              </span>
            </button>);

        })()}

        {/* A key, for the same reason the cleaner's calendar has one: a
            mark you have to decode is a mark you ignore. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2 text-[12px] text-[#717171]">
          <span className="flex items-center gap-1.5">
            <span className="flex items-center rounded-[4px] px-1 py-0.5 bg-[#FCEBEB] text-[#A32D2D]">
              <UserX className="w-3.5 h-3.5" strokeWidth={2.25} />
            </span>
            Checks out, no cleaner
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-center rounded-[4px] px-1 py-0.5 bg-[#FAEEDA] text-[#854F0B]">
              <TriangleAlert className="w-3.5 h-3.5" strokeWidth={2.25} />
            </span>
            Cleaner no longer available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-center rounded-[4px] px-1 py-0.5 bg-[#EAF4F0] text-[#0F6E56]">
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
            </span>
            Confirmed
          </span>
          <span className="flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-[#717171]" strokeWidth={2.25} />
            Asked, no answer yet
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] rounded-full bg-[#C9A227]" />
            Public holiday
          </span>
          <span>Tap a day to send someone</span>
        </div>
        <MonthCalendar
          propertyId={propertyId}
          bookings={singleModeBookings}
          onBookingClick={setSelectedBooking}
          cleaningDays={cleaningDays}
          showSchoolHolidays={showSchoolHolidays}
          onDayClick={(d) => { setPickedFor(null); setPickedDay(dateKey(d)); }} />
        </> :


        <TimelineView
          properties={properties}
          bookings={filteredBookings}
          onBookingClick={setSelectedBooking}
          cleaningDays={cleaningDays}
          onDayClick={(d, propId) => {
            setPickedFor({ propertyId: propId, reason: 'checkout' });
            setPickedDay(dateKey(d));
          }} />)

        }

        {activeTab === 'cleaners' && <CleanersPage />}
        {activeTab === 'analytics' && <AnalyticsPage propertyId={globalPropertyFilter} />}
        {activeTab === 'properties' && <PropertiesPage />}
        {activeTab === 'users' && <UsersPage />}
        {activeTab === 'reported' && <ReportedPage />}
        {activeTab === 'smoobu' && <SmoobuConnectionPage isAdmin={userRole === 'admin'} />}
        {activeTab === 'more' && <MorePage onNavigate={setActiveTab} onLogout={() => { setIsLoggedIn(false); setDataLoaded(false); }} />}
        </div>
      </main>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} homeBadge={attentionCount} />
      <AddToHomeScreen />

      {activeTab === 'calendar' && pickedDay &&
      <CleaningDaySheet
        date={pickedDay}
        day={cleaningDays[pickedDay]}
        propertyId={pickedFor ? pickedFor.propertyId : propertyId}
        propertyName={properties.find((p) => p.id === (pickedFor ? pickedFor.propertyId : propertyId))?.name || ''}
        lockProperty={!!pickedFor}
        initialReason={pickedFor ? pickedFor.reason : 'checkout'}
        onClose={() => { setPickedDay(null); setPickedFor(null); }}
        onAssigned={() => {
          setPickedDay(null);
          setPickedFor(null);
          setDashboardVersion((v) => v + 1);
        }} />
      }

      {activeTab === 'calendar' &&
      <BookingDetailSheet
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onRequestCleaner={(date, pid, reason) => {
          setSelectedBooking(null);
          setPickedFor({ propertyId: pid, reason });
          setPickedDay(date);
        }} />

      }
    {showNotifications &&
      <NotificationsPanel
        onClose={() => setShowNotifications(false)}
        onRead={() => setUnread(0)} />
      }

    </div>);

}
