import React from 'react';
import { TodayPanel } from './TodayPanel';

/**
 * Home.
 *
 * This was nine sections deep. Three of them answered a slice each of
 * "what state are my properties in" — a board of arrivals and
 * departures, a properties card, and a list of who was currently
 * staying — so the answer was assembled by the reader, scrolling. Two
 * more were different-length windows onto the same events. The last
 * four were analysis: revenue, forward occupancy, cancellations and
 * holidays.
 *
 * Revenue and occupancy were already on the Analytics tab, drawn better
 * and filterable, so they were duplicates rather than losses. Holidays
 * belong beside the dates they affect, not in a list on a page about
 * today. What is left is one component asking three questions of one
 * endpoint.
 *
 * The removed sections all read `data/dashboard.ts`, a second set of
 * client-side calculations that disagreed with the server's more than
 * once — the tab badge showing 1 beside a list of 4 was the last of it.
 * Home no longer reads any of it.
 */
export function DashboardPage({ onNavigate, onGoToDay, onNeedsChange }: {
  onNavigate?: (tab: string) => void;
  /** Open the calendar on a specific day, with its sheet up. */
  onGoToDay?: (propertyId: number, date: string) => void;
  /** How many things need somebody — passed up for the tab badge. */
  onNeedsChange?: (count: number | null) => void;
}) {
  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">
        <TodayPanel onGoToDay={onGoToDay} onNeedsChange={onNeedsChange} onNavigate={onNavigate} />
      </div>
    </div>);

}
