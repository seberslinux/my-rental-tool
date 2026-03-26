import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from
'recharts';
import {
  overviewKPIs,
  revenueData,
  propertyPerformance,
  revenueByProperty,
  channelMixData,
  occupancyTrendData,
  rateTrendData,
  guestCountries,
  guestLanguages,
  dowStats,
  checkoutDowStats,
  hourDistribution,
  occupancyHeatmap,
  topRevenuePeriods,
  recentReviews,
  netRevenue,
  commissionPercentage,
  loadAnalyticsData } from
'../data/analytics';
import { properties } from '../data/properties';
const TABS = [
{
  id: 'overview',
  label: 'Overview'
},
{
  id: 'revenue',
  label: 'Revenue'
},
{
  id: 'occupancy',
  label: 'Occupancy & Rates'
},
{
  id: 'guests',
  label: 'Guests'
},
{
  id: 'channels',
  label: 'Channels'
},
{
  id: 'patterns',
  label: 'Patterns'
},
{
  id: 'seasonality',
  label: 'Seasonality'
},
{
  id: 'market',
  label: 'Market'
},
{
  id: 'reviews',
  label: 'Reviews'
},
{
  id: 'insights',
  label: 'Insights'
}];

const PERIODS = ['30D', '90D', '6M', '1Y', 'YTD', 'Custom'];
const PROPERTIES = () => ['All Properties', ...properties.map(p => p.name)];

export function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [activePeriod, setActivePeriod] = useState('1Y');
  const [activeProperty, setActiveProperty] = useState('All Properties');
  const [revenueMode, setRevenueMode] = useState<'gross' | 'net'>('gross');
  const [version, setVersion] = useState(0);

  const refreshData = useCallback(async () => {
    const prop = properties.find((p) => p.name === activeProperty);
    const propertyId = prop ? String(prop.id) : 'all';
    await loadAnalyticsData(propertyId, activePeriod);
    setVersion((v) => v + 1);
  }, [activeProperty, activePeriod]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full pb-8">
      {/* Global Filters: Property + Period */}
      <div className="flex items-center gap-3 mb-3 -mx-4 px-4 overflow-x-auto no-scrollbar">
        {/* Property Filter */}
        <div className="relative flex-shrink-0">
          <select
            value={activeProperty}
            onChange={(e) => setActiveProperty(e.target.value)}
            className="appearance-none bg-white border border-[#EBEBEB] rounded-[8px] pl-3 pr-8 py-2 text-[13px] font-medium text-[#222222] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]">
            
            {PROPERTIES().map((prop) =>
            <option key={prop} value={prop}>
                {prop}
              </option>
            )}
          </select>
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#717171"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round">
              
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* Period Selector */}
        <div className="flex overflow-x-auto no-scrollbar bg-[#F0F0F0] rounded-[8px] p-[3px] flex-shrink-0">
          {PERIODS.map((period) =>
          <button
            key={period}
            onClick={() => setActivePeriod(period)}
            className={`px-3 py-1.5 rounded-[6px] text-[12px] font-medium whitespace-nowrap transition-all ${activePeriod === period ? 'bg-white text-[#222222] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-[#717171]'}`}>
            
              {period}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Tabs */}
      <div className="flex overflow-x-auto no-scrollbar border-b border-[#EBEBEB] mb-4 -mx-4 px-4">
        {TABS.map((tab) =>
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`whitespace-nowrap px-4 py-3 text-[13px] font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'border-[#007AFF] text-[#007AFF] font-semibold' : 'border-transparent text-[#717171]'}`}>
          
            {tab.label}
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' &&
        <>
            {/* KPIs — responsive grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {overviewKPIs.map((kpi, idx) =>
            <div
              key={idx}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              
                  <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-[22px] font-bold tracking-[-0.3px] text-[#222222]">
                    {kpi.value}
                  </div>
                  <div className="mt-1">
                    {kpi.trend &&
                <span
                  className={`text-[12px] font-semibold ${kpi.isPositive ? 'text-[#00A699]' : 'text-[#D93900]'}`}>
                  
                        {kpi.trend}
                      </span>
                }
                    <span className="text-[11px] text-[#B0B0B0] ml-1">
                      {kpi.trendDetail}
                    </span>
                  </div>
                </div>
            )}
            </div>

            {/* Revenue Over Time + Revenue by Property */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Revenue Over Time
                </h3>
                <div className="flex gap-4 text-[11px] text-[#717171]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-[2px] bg-[#007AFF]"></div>
                    Paid
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-[2px] bg-[#E8913A]"></div>
                    Booked
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-[2px] bg-[#00A699] opacity-50"></div>
                    Forecast
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#CBD5E1]"></div>
                    Last Year
                  </div>
                </div>
              </div>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                  data={revenueData}
                  margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
                  barCategoryGap="20%">

                    <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#F0F0F0" />

                    <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#B0B0B0' }}
                    dy={10} />

                    <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#B0B0B0' }}
                    tickFormatter={(val) => val >= 1000000 ? `R ${val / 1000000}M` : `R ${val / 1000}k`} />

                    <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #EBEBEB',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      fontSize: 13
                    }}
                    formatter={(value: number, name: string) => [
                      `R ${value.toLocaleString()}`,
                      name === 'paid' ? 'Paid' : name === 'booked' ? 'Booked' : name === 'forecast' ? 'Forecast' : 'Last Year'
                    ]} />

                    <Bar dataKey="paid" stackId="revenue" fill="#007AFF" radius={[0,0,0,0]} />
                    <Bar dataKey="booked" stackId="revenue" fill="#E8913A" radius={[0,0,0,0]} />
                    <Bar dataKey="forecast" stackId="revenue" fill="#00A699" fillOpacity={0.4} radius={[4,4,0,0]} />
                    <Line type="monotone" dataKey="previous" stroke="#CBD5E1" strokeWidth={2} strokeDasharray="6 4" dot={false} />

                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Revenue by Property */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                Revenue by Property
              </h3>
              <div className="space-y-4">
                {revenueByProperty.map((prop, idx) =>
              <div key={idx}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[13px] font-medium text-[#222222]">
                        {prop.name}
                      </span>
                      <span className="text-[13px] font-semibold text-[#222222]">
                        R {prop.revenue.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                      <div
                    className="h-full bg-[#007AFF] rounded-full transition-all"
                    style={{
                      width: `${prop.percentage}%`
                    }}>
                  </div>
                    </div>
                  </div>
              )}
              </div>
            </div>

            {/* Top Performing Listings */}
            <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
              <div className="p-5 border-b border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Top Performing Listings
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[#F7F7F7] text-[#717171]">
                    <tr>
                      <th className="p-3 pl-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Property
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Revenue
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Occupancy
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Avg Rate
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Avg Stay
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Bookings
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Rating
                      </th>
                      <th className="p-3 pr-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                        Top Platform
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {propertyPerformance.map((prop, idx) =>
                  <tr key={idx}>
                        <td className="p-3 pl-5 font-medium text-[13px] text-[#222222] whitespace-nowrap">
                          {prop.name}
                        </td>
                        <td className="p-3 text-[13px] text-[#222222]">
                          {prop.revenue}
                        </td>
                        <td className="p-3">
                          <span
                        className={`text-[13px] font-semibold ${prop.occupancy >= 60 ? 'text-[#00A699]' : 'text-[#D93900]'}`}>
                        
                            {prop.occupancy}%
                          </span>
                        </td>
                        <td className="p-3 text-[13px] text-[#222222]">
                          {prop.adr}
                        </td>
                        <td className="p-3 text-[13px] text-[#717171]">
                          {prop.avgStay}
                        </td>
                        <td className="p-3 text-[13px] text-[#222222]">
                          {prop.bookings}
                        </td>
                        <td className="p-3 text-[13px] text-[#717171]">
                          {prop.rating}
                        </td>
                        <td className="p-3 pr-5">
                          <span
                        className={`text-[11px] font-semibold px-2 py-[3px] rounded-full ${prop.topPlatform === 'Airbnb' ? 'bg-[#FF385C14] text-[#E31C5F]' : prop.topPlatform === 'Booking.com' ? 'bg-[#003B9510] text-[#003B95]' : 'bg-[#F0F0F0] text-[#717171]'}`}>
                        
                            {prop.topPlatform}
                          </span>
                        </td>
                      </tr>
                  )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        }

        {/* REVENUE TAB */}
        {activeTab === 'revenue' &&
        <>
            {/* Revenue KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                const totalRev = revenueData.reduce((s, m) => s + (m.paid + m.booked), 0);
                const totalBookings = propertyPerformance.reduce((s, p) => s + p.bookings, 0);
                const avgBookingVal = totalBookings > 0 ? Math.round(totalRev / totalBookings) : 0;
                return [
                  { label: 'Gross Revenue', value: totalRev > 0 ? `R ${totalRev.toLocaleString()}` : '--', trend: '', isPositive: true },
                  { label: 'Avg Booking Value', value: avgBookingVal > 0 ? `R ${avgBookingVal.toLocaleString()}` : '--', trend: '', isPositive: true },
                  { label: 'Net Revenue', value: netRevenue > 0 ? `R ${netRevenue.toLocaleString()}` : '--', trend: '', isPositive: true },
                  { label: 'Deductions %', value: commissionPercentage > 0 ? `${commissionPercentage}%` : '--', trend: '', isPositive: false },
                ];
              })().
            map((kpi, idx) =>
            <div
              key={idx}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">

                  <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-[20px] font-bold tracking-[-0.3px] text-[#222222]">
                    {kpi.value}
                  </div>
                  {kpi.trend && <span
                className={`text-[12px] font-semibold ${kpi.isPositive ? 'text-[#00A699]' : 'text-[#D93900]'}`}>

                    {kpi.trend}
                  </span>}
                  <span className="text-[11px] text-[#B0B0B0] ml-1">
                    selected period
                  </span>
                </div>
            )}
            </div>

            {/* Monthly Revenue Bar Chart */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Monthly Revenue Trend
                </h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center bg-[#F7F7F7] rounded-[8px] p-0.5 text-[11px] font-semibold">
                    <button
                      onClick={() => setRevenueMode('gross')}
                      className={`px-3 py-1 rounded-[6px] transition-all ${revenueMode === 'gross' ? 'bg-white text-[#222222] shadow-sm' : 'text-[#717171]'}`}>
                      Gross
                    </button>
                    <button
                      onClick={() => setRevenueMode('net')}
                      className={`px-3 py-1 rounded-[6px] transition-all ${revenueMode === 'net' ? 'bg-white text-[#222222] shadow-sm' : 'text-[#717171]'}`}>
                      Net
                    </button>
                  </div>
                  <div className="flex gap-4 text-[11px] text-[#717171]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-[2px] bg-[#007AFF]"></div>
                      This Year
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-[2px] bg-[#E2E8F0]"></div>
                      Last Year
                    </div>
                  </div>
                </div>
              </div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                  data={revenueData
                    .filter((m) => !m.isForecastOnly && (m.paid + m.booked) > 0)
                    .map((m) => {
                      const gross = m.paid + m.booked;
                      return {
                        month: m.month,
                        thisYear: revenueMode === 'net' ? gross - m.deductions : gross,
                        lastYear: m.previous,
                      };
                    })}
                  margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>

                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#B0B0B0' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#B0B0B0' }} tickFormatter={(val) => val >= 1000000 ? `R${val / 1000000}M` : `R${val / 1000}k`} />

                    <Tooltip
                    cursor={{ fill: '#F7F7F7' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const thisYear = payload.find((p: any) => p.dataKey === 'thisYear')?.value as number | undefined;
                      const lastYear = payload.find((p: any) => p.dataKey === 'lastYear')?.value as number | undefined;
                      const yoyChange = lastYear && thisYear && lastYear > 0
                        ? ((thisYear - lastYear) / lastYear * 100)
                        : null;
                      return (
                        <div className="bg-white rounded-[8px] border border-[#EBEBEB] shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-3 text-[12px]">
                            <div className="font-semibold text-[#222222] mb-1.5">{label}</div>
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-2 h-2 rounded-[2px] bg-[#007AFF]"></div>
                              <span className="text-[#717171]">{revenueMode === 'net' ? 'Net' : 'Gross'} This Year:</span>
                              <span className="font-semibold text-[#222222]">R {thisYear?.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-2 h-2 rounded-[2px] bg-[#E2E8F0]"></div>
                              <span className="text-[#717171]">Last Year:</span>
                              <span className="font-semibold text-[#222222]">R {lastYear?.toLocaleString()}</span>
                            </div>
                            {yoyChange !== null &&
                          <div className="mt-1.5 pt-1.5 border-t border-[#F0F0F0] flex items-center gap-1">
                                <span className="text-[#717171]">YoY:</span>
                                <span className={`font-semibold ${yoyChange >= 0 ? 'text-[#00A699]' : 'text-[#D93900]'}`}>
                                  {yoyChange >= 0 ? '↑' : '↓'} {Math.abs(yoyChange).toFixed(1)}%
                                </span>
                              </div>
                          }
                          </div>);
                    }} />

                    <Bar dataKey="lastYear" fill="#E2E8F0" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="thisYear" fill={revenueMode === 'net' ? '#00A699' : '#007AFF'} radius={[4, 4, 0, 0]} />

                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Revenue Breakdown Donut + Revenue by Channel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Revenue Breakdown */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Revenue Breakdown
                </h3>
                <div className="flex items-center">
                  <div className="h-[160px] w-[160px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                        data={channelMixData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none">
                        
                          {channelMixData.map((entry, index) =>
                        <Cell
                          key={`rev-cell-${index}`}
                          fill={entry.color} />

                        )}
                        </Pie>
                        <Tooltip
                        contentStyle={{
                          borderRadius: '8px',
                          border: '1px solid #EBEBEB',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                        }}
                        formatter={(value: number) => [`${value}%`, 'Share']} />
                      
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 pl-4 space-y-3">
                    {channelMixData.map((item, idx) =>
                  <div
                    key={idx}
                    className="flex items-center justify-between">

                        <div className="flex items-center gap-2">
                          <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{
                          backgroundColor: item.color
                        }}>
                      </div>
                          <span className="text-[13px] text-[#717171]">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[13px] font-semibold text-[#222222]">
                            {item.value}%
                          </span>
                        </div>
                      </div>
                  )}
                  </div>
                </div>
              </div>

              {/* Revenue by Property */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Revenue by Property
                </h3>
                <div className="space-y-4">
                  {revenueByProperty.map((prop, idx) =>
                <div key={idx}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[13px] font-medium text-[#222222]">
                          {prop.name}
                        </span>
                        <span className="text-[13px] font-semibold text-[#222222]">
                          R {prop.revenue.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                        <div
                      className="h-full bg-[#007AFF] rounded-full"
                      style={{
                        width: `${prop.percentage}%`
                      }}>
                    </div>
                      </div>
                    </div>
                )}
                </div>
              </div>
            </div>

            {/* Revenue Forecast + Top Revenue Periods */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Revenue Forecast */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#222222]">
                      Revenue Forecast
                    </h3>
                    <p className="text-[12px] text-[#B0B0B0] mt-0.5">
                      Actual vs projected revenue
                    </p>
                  </div>
                  <div className="flex gap-4 text-[11px] text-[#717171]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-[2px] bg-[#007AFF]"></div>
                      Paid
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-[2px] bg-[#E8913A]"></div>
                      Booked
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-[2px] bg-[#00A699] opacity-50"></div>
                      Forecast
                    </div>
                  </div>
                </div>
                <div className="h-[220px] w-full mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                    data={revenueData.slice(-8)}
                    margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
                    barCategoryGap="20%">

                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#B0B0B0' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#B0B0B0' }} tickFormatter={(val) => val >= 1000000 ? `R ${val / 1000000}M` : `R ${val / 1000}k`} />
                      <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid #EBEBEB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={(value: number, name: string) => [
                        `R ${value.toLocaleString()}`,
                        name === 'paid' ? 'Paid' : name === 'booked' ? 'Booked' : 'Forecast'
                      ]} />

                      <Bar dataKey="paid" stackId="revenue" fill="#007AFF" />
                      <Bar dataKey="booked" stackId="revenue" fill="#E8913A" />
                      <Bar dataKey="forecast" stackId="revenue" fill="#00A699" fillOpacity={0.4} radius={[4,4,0,0]} />

                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top Revenue Periods */}
              <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
                <div className="p-5 pb-3">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Top Revenue Periods
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-[#F7F7F7] text-[#717171]">
                      <tr>
                        <th className="p-3 pl-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                          Period
                        </th>
                        <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                          Revenue
                        </th>
                        <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                          Bookings
                        </th>
                        <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                          Nights
                        </th>
                        <th className="p-3 pr-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                          ADR
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F0F0]">
                      {topRevenuePeriods.map((row, idx) => {
                    const fmtD = (ds: string) => { const d = new Date(ds + 'T00:00:00'); return `${d.getDate()} ${d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}`; };
                    return (
                    <tr key={idx}>
                          <td className="p-3 pl-5">
                            <div className="text-[13px] font-medium text-[#222222]">{fmtD(row.start)} – {fmtD(row.end)}</div>
                          </td>
                          <td className="p-3 text-[13px] text-[#222222]">
                            R {row.revenue.toLocaleString()}
                          </td>
                          <td className="p-3 text-[13px] text-[#717171]">
                            {row.bookings}
                          </td>
                          <td className="p-3 text-[13px] text-[#717171]">
                            {row.nights}
                          </td>
                          <td className="p-3 pr-5 text-[13px] text-[#222222]">
                            R {row.adr.toLocaleString()}
                          </td>
                        </tr>);

                    })}
                    </tbody>
                  </table>
                </div>
                {/* Peak insight */}
                <div className="mx-5 mb-4 mt-3 p-3 bg-[#F0F9FF] rounded-[8px] flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-[#007AFF20] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#007AFF"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round">
                    
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </div>
                  <p className="text-[12px] text-[#334155] leading-relaxed">
                    {(() => {
                      if (topRevenuePeriods.length === 0) return 'No revenue data available.';
                      const peak = topRevenuePeriods[0];
                      const fmtD = (ds: string) => { const d = new Date(ds + 'T00:00:00'); return `${d.getDate()} ${d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}`; };
                      return <>Peak period: <strong>{fmtD(peak.start)} – {fmtD(peak.end)}</strong> generating R {peak.revenue.toLocaleString()} from {peak.bookings} bookings.</>;
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </>
        }

        {/* OCCUPANCY TAB */}
        {activeTab === 'occupancy' &&
        <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                const avgOcc = occupancyTrendData.length > 0 ? Math.round(occupancyTrendData.reduce((s, o) => s + o.rate, 0) / occupancyTrendData.length) : 0;
                const avgAdr = rateTrendData.length > 0 ? Math.round(rateTrendData.reduce((s, r) => s + r.adr, 0) / rateTrendData.length) : 0;
                const avgRevpar = rateTrendData.length > 0 ? Math.round(rateTrendData.reduce((s, r) => s + r.revpar, 0) / rateTrendData.length) : 0;
                const avgStayKpi = overviewKPIs.find(k => k.label === 'Avg Stay');
                return [
                  { label: 'Avg Occupancy', value: avgOcc > 0 ? `${avgOcc}%` : '--', trend: '', trendDetail: 'across properties', isPositive: avgOcc >= 50 },
                  { label: 'Avg Daily Rate (ADR)', value: avgAdr > 0 ? `R ${avgAdr.toLocaleString()}` : '--', trend: '', trendDetail: 'per night', isPositive: true },
                  { label: 'RevPAR', value: avgRevpar > 0 ? `R ${avgRevpar.toLocaleString()}` : '--', trend: '', trendDetail: 'rev per available night', isPositive: true },
                  { label: 'Avg Stay Duration', value: avgStayKpi ? avgStayKpi.value : '--', trend: '', trendDetail: 'per booking', isPositive: true },
                ];
              })().map((kpi, idx) =>
            <div
              key={idx}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">

                  <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-[20px] font-bold tracking-[-0.3px] text-[#222222]">
                    {kpi.value}
                  </div>
                  <div className="mt-1">
                    {kpi.trend &&
                <span
                  className={`text-[12px] font-semibold ${kpi.isPositive ? 'text-[#00A699]' : 'text-[#D93900]'}`}>

                        {kpi.trend}
                      </span>
                }
                    <span className="text-[11px] text-[#B0B0B0] ml-1">
                      {kpi.trendDetail}
                    </span>
                  </div>
                </div>
            )}
            </div>

            {/* Monthly Occupancy Rate + Rate Trends */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Monthly Occupancy — color-coded bars */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Monthly Occupancy Rate
                  </h3>
                  <div className="flex gap-3 text-[11px] text-[#717171]">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-[#00A699]"></div>
                      ≥70%
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-[#E8913A]"></div>
                      50-69%
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-[#D93900]"></div>
                      &lt;50%
                    </div>
                  </div>
                </div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                    data={occupancyTrendData}
                    margin={{
                      top: 20,
                      right: 5,
                      left: -15,
                      bottom: 0
                    }}>
                    
                      <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#F0F0F0" />
                    
                      <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fontSize: 10,
                        fill: '#B0B0B0'
                      }}
                      dy={10} />
                    
                      <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fontSize: 11,
                        fill: '#B0B0B0'
                      }}
                      tickFormatter={(val) => `${val}%`}
                      domain={[0, 100]} />
                    
                      <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #EBEBEB',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                      }}
                      formatter={(value: number) => [
                      `${value}%`,
                      'Occupancy']
                      } />
                    
                      <Bar
                      dataKey="rate"
                      radius={[4, 4, 0, 0]}
                      label={{
                        position: 'top',
                        fontSize: 10,
                        fill: '#717171',
                        formatter: (val: number) => `${val}%`
                      }}>
                      
                        {occupancyTrendData.map((entry, index) =>
                      <Cell
                        key={`occ-${index}`}
                        fill={
                        entry.rate >= 70 ?
                        '#00A699' :
                        entry.rate >= 50 ?
                        '#E8913A' :
                        '#D93900'
                        } />

                      )}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Rate Trends (ADR) */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Rate Trends (ADR)
                  </h3>
                  <div className="flex gap-4 text-[11px] text-[#717171]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#007AFF]"></div>
                      ADR
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#00A699]"></div>
                      RevPAR
                    </div>
                  </div>
                </div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                    data={rateTrendData}
                    margin={{
                      top: 5,
                      right: 5,
                      left: -15,
                      bottom: 0
                    }}>
                    
                      <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#F0F0F0" />
                    
                      <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fontSize: 10,
                        fill: '#B0B0B0'
                      }}
                      dy={10} />
                    
                      <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fontSize: 11,
                        fill: '#B0B0B0'
                      }}
                      tickFormatter={(val) => `R ${val.toLocaleString()}`} />
                    
                      <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #EBEBEB',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                      }}
                      formatter={(value: number) => [
                      `R ${value.toLocaleString()}`,
                      '']
                      } />
                    
                      <Line
                      type="monotone"
                      dataKey="adr"
                      stroke="#007AFF"
                      strokeWidth={2.5}
                      dot={{
                        r: 3,
                        fill: '#007AFF',
                        strokeWidth: 0
                      }} />
                    
                      <Line
                      type="monotone"
                      dataKey="revpar"
                      stroke="#00A699"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false} />
                    
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Occupancy by Property + Lead Time Analysis */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Occupancy by Property */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Occupancy by Property
                </h3>
                <div className="space-y-4">
                  {propertyPerformance.length > 0 ? propertyPerformance.map((prop, idx) => {
                    const occ = prop.occupancy;
                    const color = occ >= 70 ? '#00A699' : occ >= 50 ? '#E8913A' : '#D93900';
                    return (
                <div key={idx}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[13px] font-medium text-[#222222]">
                          {prop.name}
                        </span>
                        <span
                      className={`text-[13px] font-semibold ${occ >= 70 ? 'text-[#00A699]' : occ >= 50 ? 'text-[#E8913A]' : 'text-[#D93900]'}`}>

                          {occ}%
                        </span>
                      </div>
                      <div className="h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                        <div
                      className="h-full rounded-full"
                      style={{
                        width: `${occ}%`,
                        backgroundColor: color
                      }}>
                    </div>
                      </div>
                    </div>);
                  }) : <div className="text-[13px] text-[#B0B0B0] text-center py-4">No data available</div>}
                </div>
              </div>

              {/* Lead Time Analysis */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Lead Time Analysis
                  </h3>
                  <span className="text-[11px] text-[#B0B0B0]">
                    Days between booking and check-in
                  </span>
                </div>
                <div className="flex gap-6 mb-4">
                  <div className="text-center">
                    <div className="text-[24px] font-bold text-[#222222]">
                      --
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0]">
                      Avg Lead Time
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[24px] font-bold text-[#222222]">
                      {propertyPerformance.reduce((s, p) => s + p.bookings, 0) || '--'}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0]">
                      Total Bookings
                    </div>
                  </div>
                </div>
                <div className="text-[13px] text-[#B0B0B0] text-center py-4">No lead time data available</div>
              </div>
            </div>

            {/* Length of Stay + Lead Time vs Nightly Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Length of Stay Distribution */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Length of Stay Distribution
                  </h3>
                  <span className="text-[11px] text-[#B0B0B0]">
                    Number of bookings by nights stayed
                  </span>
                </div>
                <div className="flex gap-6 mb-4">
                  <div className="text-center">
                    <div className="text-[24px] font-bold text-[#222222]">
                      {(() => { const k = overviewKPIs.find(k => k.label === 'Avg Stay'); return k ? k.value.replace(' nights', '') : '--'; })()}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0]">
                      Avg Nights
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[24px] font-bold text-[#222222]">
                      {propertyPerformance.reduce((s, p) => s + p.bookings, 0) || '--'}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0]">
                      Total Bookings
                    </div>
                  </div>
                </div>
                <div className="text-[13px] text-[#B0B0B0] text-center py-4">No length-of-stay distribution data available</div>
              </div>

              {/* Lead Time vs Nightly Rate scatter */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-[15px] font-semibold text-[#222222]">
                    Lead Time vs Nightly Rate
                  </h3>
                  <span className="text-[11px] text-[#B0B0B0]">
                    Do earlier bookers pay more?
                  </span>
                </div>
                <div className="text-[13px] text-[#B0B0B0] text-center py-8">No lead time vs rate data available</div>
              </div>
            </div>
          </>
        }

        {/* CHANNELS TAB */}
        {activeTab === 'channels' &&
        <>
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <h3 className="text-[15px] font-semibold text-[#222222] mb-2">
                Booking Channel Mix
              </h3>
              <div className="flex items-center">
                <div className="h-[180px] w-[180px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                      data={channelMixData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none">
                      
                        {channelMixData.map((entry, index) =>
                      <Cell key={`cell-${index}`} fill={entry.color} />
                      )}
                      </Pie>
                      <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #EBEBEB',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                      }}
                      formatter={(value: number) => [`${value}%`, 'Share']} />
                    
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 pl-4 space-y-3">
                  {channelMixData.map((channel, idx) =>
                <div
                  key={idx}
                  className="flex items-center justify-between">
                  
                      <div className="flex items-center gap-2">
                        <div
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{
                        backgroundColor: channel.color
                      }}>
                    </div>
                        <span className="text-[13px] text-[#717171]">
                          {channel.name}
                        </span>
                      </div>
                      <span className="text-[14px] font-semibold text-[#222222]">
                        {channel.value}%
                      </span>
                    </div>
                )}
                </div>
              </div>
            </div>
          </>
        }

        {/* REVIEWS TAB */}
        {activeTab === 'reviews' &&
        <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                const total = recentReviews.length;
                const avgRating = total > 0 ? (recentReviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : '--';
                const fiveStarCount = recentReviews.filter(r => r.rating === 5).length;
                const fiveStarPct = total > 0 ? Math.round((fiveStarCount / total) * 100) : 0;
                const propsRated = new Set(recentReviews.map(r => r.property)).size;
                return [
                  { label: 'Overall Rating', value: total > 0 ? `${avgRating} ★` : '--', detail: `${total} reviews total` },
                  { label: 'Total Reviews', value: total > 0 ? String(total) : '--', detail: 'across all properties' },
                  { label: '5-Star Rate', value: total > 0 ? `${fiveStarPct}%` : '--', detail: `${fiveStarCount} five-star reviews` },
                  { label: 'Properties Rated', value: propsRated > 0 ? String(propsRated) : '--', detail: `of ${properties.length} total` },
                ];
              })().map((kpi, idx) =>
            <div
              key={idx}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">

                  <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-[24px] font-bold tracking-[-0.3px] text-[#222222]">
                    {kpi.value}
                  </div>
                  <div className="text-[11px] text-[#B0B0B0] mt-0.5">
                    {kpi.detail}
                  </div>
                </div>
            )}
            </div>

            {/* Rating Distribution + Ratings by Property */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Rating Distribution */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Rating Distribution
                </h3>
                <div className="space-y-3">
                  {(() => {
                    const total = recentReviews.length;
                    const starColors: Record<number, string> = { 5: '#00A699', 4: '#007AFF', 3: '#E8913A', 2: '#D93900', 1: '#D93900' };
                    return [5, 4, 3, 2, 1].map(s => {
                      const count = recentReviews.filter(r => r.rating === s).length;
                      return { stars: s, count, pct: total > 0 ? Math.round((count / total) * 100) : 0, color: starColors[s] };
                    });
                  })().map((item, idx) =>
                <div key={idx} className="flex items-center gap-3">
                      <span className="text-[13px] text-[#DDAD4F] w-[60px] flex-shrink-0 tracking-tight">
                        {'★'.repeat(item.stars)}
                        {'☆'.repeat(5 - item.stars)}
                      </span>
                      <div className="flex-1 h-[18px] bg-[#F0F0F0] rounded-[3px] overflow-hidden">
                        <div
                      className="h-full rounded-[3px] flex items-center pl-2"
                      style={{
                        width: `${Math.max(item.pct > 0 ? item.pct : 0, item.pct > 0 ? 12 : 2)}%`,
                        backgroundColor: item.color
                      }}>
                      
                          {item.pct >= 15 &&
                      <span className="text-[10px] font-semibold text-white">
                              {item.pct}%
                            </span>
                      }
                        </div>
                      </div>
                      <span className="text-[13px] font-medium text-[#222222] w-[20px] text-right flex-shrink-0">
                        {item.count}
                      </span>
                    </div>
                )}
                </div>
              </div>

              {/* Ratings by Property */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Ratings by Property
                </h3>
                <div className="space-y-4">
                  {(() => {
                    const propReviews: Record<string, number[]> = {};
                    recentReviews.forEach(r => {
                      if (!propReviews[r.property]) propReviews[r.property] = [];
                      propReviews[r.property].push(r.rating);
                    });
                    const entries = Object.entries(propReviews).map(([name, ratings]) => ({
                      name,
                      rating: parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)),
                      color: (ratings.reduce((s, r) => s + r, 0) / ratings.length) >= 4.5 ? '#00A699' : '#007AFF',
                    })).sort((a, b) => b.rating - a.rating);
                    if (entries.length === 0) return <div className="text-[13px] text-[#B0B0B0] text-center py-4">No review data available</div>;
                    return entries.map((prop, idx) =>
                <div key={idx}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[13px] font-medium text-[#222222]">
                          {prop.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                          <div
                        className="h-full rounded-full"
                        style={{
                          width: `${prop.rating / 5 * 100}%`,
                          backgroundColor: prop.color
                        }}>
                      </div>
                        </div>
                        <span className="text-[13px] font-semibold text-[#007AFF] flex-shrink-0">
                          {prop.rating}
                        </span>
                      </div>
                    </div>);
                  })()}
                </div>
              </div>
            </div>

            {/* Recent Reviews */}
            <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
              <div className="p-5 border-b border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Recent Reviews
                </h3>
              </div>
              <div className="divide-y divide-[#F0F0F0]">
                {recentReviews.map((review) => {
                const colors = [
                '#00A699',
                '#007AFF',
                '#8B5CF6',
                '#E8913A',
                '#D93900'];

                const colorIdx = review.guest.charCodeAt(0) % colors.length;
                const platformColor = '#FF385C';
                return (
                  <div key={review.id} className="p-5">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-white"
                          style={{
                            backgroundColor: colors[colorIdx]
                          }}>
                          
                            {review.guest.charAt(0)}
                          </div>
                          <div>
                            <div className="text-[14px] font-semibold text-[#222222]">
                              {review.guest}
                            </div>
                            <div className="text-[12px] text-[#B0B0B0]">
                              {review.date}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex text-[#DDAD4F] text-[13px]">
                            {'★'.repeat(review.rating)}
                            {'☆'.repeat(5 - review.rating)}
                          </div>
                          <div className="w-5 h-5 rounded-[4px] bg-[#FF385C] flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[10px] font-bold">
                              A
                            </span>
                          </div>
                        </div>
                      </div>
                      <p className="text-[13px] text-[#717171] leading-relaxed mt-3">
                        {review.text}
                      </p>
                      <div className="text-[12px] text-[#B0B0B0] mt-2 font-medium">
                        {review.property}
                      </div>
                    </div>);

              })}
              </div>
            </div>
          </>
        }

        {/* GUESTS TAB */}
        {activeTab === 'guests' &&
        <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                const totalBookings = propertyPerformance.reduce((s, p) => s + p.bookings, 0);
                const countriesCount = guestCountries.length;
                return [
                  { label: 'Total Bookings', value: totalBookings > 0 ? String(totalBookings) : '--', detail: 'confirmed bookings' },
                  { label: 'Countries', value: countriesCount > 0 ? String(countriesCount) : '--', detail: 'unique origins' },
                  { label: 'Top Country', value: guestCountries.length > 0 ? guestCountries[0].country : '--', detail: guestCountries.length > 0 ? `${guestCountries[0].percentage}% of guests` : '' },
                  { label: 'Properties', value: propertyPerformance.length > 0 ? String(propertyPerformance.length) : '--', detail: 'active listings' },
                ];
              })().map((kpi, idx) =>
            <div
              key={idx}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">

                  <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-[24px] font-bold tracking-[-0.3px] text-[#222222]">
                    {kpi.value}
                  </div>
                  <div className="text-[11px] text-[#B0B0B0] mt-0.5">
                    {kpi.detail}
                  </div>
                </div>
            )}
            </div>

            {/* Guest Countries + Guest Languages */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Guest Countries */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Guest Countries
                </h3>
                <div className="space-y-3">
                  {(guestCountries.length > 0 ? guestCountries : []).map((item, idx) =>
                <div key={idx} className="flex items-center gap-3">
                      <span className="text-[13px] text-[#222222] w-[110px] flex-shrink-0 font-medium">
                        {item.country}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1">
                          {item.percentage >= 5 &&
                      <span className="text-[10px] font-semibold text-white bg-[#007AFF] rounded-[3px] px-1.5 py-[1px] flex-shrink-0">
                              {item.percentage}%
                            </span>
                      }
                          <div className="flex-1 h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                            <div
                          className="h-full bg-[#007AFF] rounded-full"
                          style={{
                            width: `${item.percentage * 2.5}%`
                          }}>
                        </div>
                          </div>
                        </div>
                        <span className="text-[13px] font-medium text-[#222222] w-[28px] text-right flex-shrink-0">
                          {item.percentage}%
                        </span>
                      </div>
                    </div>
                )}
                {guestCountries.length === 0 && <div className="text-[13px] text-[#B0B0B0] text-center py-4">No guest country data available</div>}
                </div>
              </div>

              {/* Guest Languages */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Guest Languages
                </h3>
                <div className="space-y-3">
                  {guestLanguages.map((item, idx) =>
                <div key={idx} className="flex items-center gap-3">
                      <span className="text-[13px] text-[#222222] w-[110px] flex-shrink-0 font-medium">
                        {item.language}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1">
                          {item.percentage >= 5 &&
                      <span className="text-[10px] font-semibold text-white bg-[#00A699] rounded-[3px] px-1.5 py-[1px] flex-shrink-0">
                              {item.percentage}%
                            </span>
                      }
                          <div className="flex-1 h-[6px] bg-[#F0F0F0] rounded-full overflow-hidden">
                            <div
                          className="h-full bg-[#00A699] rounded-full"
                          style={{ width: `${item.percentage * 2.5}%` }}>
                        </div>
                          </div>
                        </div>
                        <span className="text-[13px] font-medium text-[#222222] w-[28px] text-right flex-shrink-0">
                          {item.percentage}%
                        </span>
                      </div>
                    </div>
                )}
                {guestLanguages.length === 0 && <div className="text-[13px] text-[#B0B0B0] text-center py-4">No language data available</div>}
                </div>
              </div>
            </div>
          </>
        }

        {/* SEASONALITY TAB */}
        {activeTab === 'seasonality' &&
        <>
            {/* Occupancy Heatmap */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Occupancy Heatmap — 12-Month View
                </h3>
                <div className="flex gap-3 text-[11px] text-[#717171]">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#00A699]"></div>
                    High (≥75%)
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#E8913A]"></div>Mid
                    (50-74%)
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#D93900]"></div>Low
                    (&lt;50%)
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr>
                      <th className="text-left p-2 text-[#B0B0B0] font-medium w-[100px]"></th>
                      {(() => {
                    const months: string[] = [];
                    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const now = new Date();
                    for (let i = 0; i < 12; i++) {
                      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
                      months.push(MONTH_NAMES[d.getMonth()]);
                    }
                    return months;
                  })().map((m, i) =>
                    <th
                      key={i}
                      className="p-2 text-center text-[#B0B0B0] font-medium">
                          {m}
                        </th>
                    )}
                    </tr>
                  </thead>
                  <tbody>
                    {occupancyHeatmap.length > 0 ? occupancyHeatmap.map((prop, idx) =>
                  <tr key={idx}>
                        <td className="p-2 text-[13px] font-medium text-[#222222] whitespace-nowrap">
                          {prop.property}
                        </td>
                        {prop.months.map((m, mIdx) => {
                      const bg = m.rate >= 75 ? 'bg-[#00A699] text-white' : m.rate >= 50 ? 'bg-[#FFF3E0] text-[#E8913A]' : m.rate > 0 ? 'bg-[#FEF2F2] text-[#D93900]' : 'bg-[#F0F0F0] text-[#B0B0B0]';
                      return (
                        <td key={mIdx} className="p-1.5 text-center">
                            <div className={`rounded-[6px] py-1.5 px-1 text-[12px] font-semibold ${bg}`}>
                              {m.rate > 0 ? `${m.rate}%` : '--'}
                            </div>
                          </td>);

                    })}
                      </tr>
                  ) : <tr><td colSpan={13} className="p-4 text-center text-[13px] text-[#B0B0B0]">No heatmap data available</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Booking Patterns + Check-in Day */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Check-in Day Distribution */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Check-in Day Distribution
                </h3>
                {dowStats.length > 0 ?
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dowStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#00A699" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer> :
                <div className="text-[13px] text-[#B0B0B0] text-center py-8">No check-in pattern data available</div>
                }
              </div>

              {/* Check-out Day Distribution */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Check-out Day Distribution
                </h3>
                {checkoutDowStats.length > 0 ?
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={checkoutDowStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#E8913A" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer> :
                <div className="text-[13px] text-[#B0B0B0] text-center py-8">No check-out pattern data available</div>
                }
              </div>
            </div>

            {/* Booking Time of Day */}
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Booking Time of Day (SAST)
                </h3>
                {hourDistribution.length > 0 ?
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hourDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#007AFF" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer> :
                <div className="text-[13px] text-[#B0B0B0] text-center py-8">No booking time data available</div>
                }
              </div>
            </div>

            {/* Avg Stay by Property */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] sm:w-1/2">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Avg Stay by Property
                </h3>
                <span className="text-[11px] text-[#B0B0B0]">
                  Average length of stay in nights
                </span>
              </div>
              <div className="space-y-4">
                {propertyPerformance.length > 0 ? propertyPerformance.map((prop, idx) => {
                  const nights = parseFloat(prop.avgStay) || 0;
                  const color = nights >= 4 ? '#007AFF' : '#00A699';
                  return (
              <div key={idx}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[13px] font-medium text-[#222222]">
                        {prop.name}
                      </span>
                      <span className="text-[13px] font-semibold text-[#222222]">
                        {prop.avgStay}
                      </span>
                    </div>
                    <div className="h-[22px] bg-[#F0F0F0] rounded-[4px] overflow-hidden">
                      <div
                    className="h-full rounded-[4px] flex items-center pl-2.5"
                    style={{
                      width: `${Math.min(nights / 7 * 100, 100)}%`,
                      backgroundColor: color
                    }}>

                        <span className="text-[11px] font-semibold text-white">
                          {nights.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>);
                }) : <div className="text-[13px] text-[#B0B0B0] text-center py-4">No data available</div>}
              </div>
            </div>
          </>
        }

        {/* INSIGHTS TAB */}
        {activeTab === 'insights' &&
        <>
            {/* Revenue & Pricing + Occupancy & Demand */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Revenue & Pricing Insights */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Revenue & Pricing Insights
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#FEE2E2] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#D93900"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                        <polyline points="17 6 23 6 23 12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Revenue trend
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {(() => {
                          if (revenueData.length < 2) return 'Not enough data to determine trend.';
                          const last = revenueData[revenueData.length - 1];
                          const prev = revenueData[revenueData.length - 2];
                          if ((prev.paid + prev.booked) === 0) return `Latest month (${last.month}): R ${(last.paid + last.booked).toLocaleString()}.`;
                          const change = Math.round((((last.paid + last.booked) - (prev.paid + prev.booked)) / (prev.paid + prev.booked)) * 100);
                          return `${last.month} revenue is R ${(last.paid + last.booked).toLocaleString()} vs R ${(prev.paid + prev.booked).toLocaleString()} in ${prev.month} (${change >= 0 ? '+' : ''}${change}%).`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#D1FAE5] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#00A699"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        {revenueByProperty.length > 0 ? `Top earner: ${revenueByProperty[0].name}` : 'Top earner'}
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {revenueByProperty.length > 0
                          ? `Generating R ${revenueByProperty[0].revenue.toLocaleString()} (${revenueByProperty[0].percentage}% of total revenue).`
                          : 'No property revenue data available.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#DBEAFE] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#007AFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        {(() => { const direct = channelMixData.find(c => c.name === 'Direct'); return direct ? `Direct bookings at ${direct.value}%` : 'Direct bookings'; })()}
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {(() => { const direct = channelMixData.find(c => c.name === 'Direct'); return direct ? `Direct bookings represent ${direct.value}% of your channel mix. Keep promoting your direct booking link to save on commissions.` : 'No direct booking data available.'; })()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Occupancy & Demand Insights */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Occupancy & Demand Insights
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#FEF3C7] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#E8913A"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <rect
                        x="3"
                        y="4"
                        width="18"
                        height="18"
                        rx="2"
                        ry="2" />
                      
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Occupancy overview
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {occupancyTrendData.length > 0
                          ? `Average occupancy is ${Math.round(occupancyTrendData.reduce((s, o) => s + o.rate, 0) / occupancyTrendData.length)}% across the tracked period. Consider seasonal pricing adjustments for low-occupancy months.`
                          : 'No occupancy data available yet.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#EDE9FE] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#8B5CF6"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Booking volume
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {(() => {
                          const total = propertyPerformance.reduce((s, p) => s + p.bookings, 0);
                          return total > 0
                            ? `${total} total bookings across ${propertyPerformance.length} ${propertyPerformance.length === 1 ? 'property' : 'properties'} in the tracked period.`
                            : 'No booking data available yet.';
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Guest & Channel + Reviews & Quality */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Guest & Channel Insights */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Guest & Channel Insights
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#D1FAE5] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#00A699"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        {guestCountries.length > 0 ? `Top guest market: ${guestCountries[0].country}` : 'Top guest market'}
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {guestCountries.length > 0
                          ? `${guestCountries[0].percentage}% of guests from ${guestCountries[0].country}. Consider tailoring welcome guides and listing descriptions for this audience.`
                          : 'No guest country data available.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#FEF3C7] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#E8913A"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Channel mix overview
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {channelMixData.length > 0
                          ? `Top channel: ${channelMixData[0].name} at ${channelMixData[0].value}% of bookings.`
                          : 'No channel data available.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#FEF3C7] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#E8913A"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Property count
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {propertyPerformance.length > 0
                          ? `Managing ${propertyPerformance.length} active ${propertyPerformance.length === 1 ? 'property' : 'properties'}.`
                          : 'No property data available.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reviews & Quality Insights */}
              <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
                <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                  Reviews & Quality Insights
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-[#DBEAFE] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#007AFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#222222]">
                        Reviews summary
                      </div>
                      <p className="text-[12px] text-[#717171] leading-relaxed mt-0.5">
                        {(() => {
                          if (recentReviews.length === 0) return 'No reviews data available.';
                          const avg = (recentReviews.reduce((s, r) => s + r.rating, 0) / recentReviews.length).toFixed(1);
                          return `${avg}/5 across ${recentReviews.length} reviews.`;
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Revenue Predictions */}
            <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
              <div className="p-5 pb-3">
                <h3 className="text-[15px] font-semibold text-[#222222]">
                  Revenue Predictions (3-Month Forecast)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-[#F7F7F7] text-[#717171]">
                    <tr>
                      <th className="p-3 pl-5 font-semibold uppercase tracking-[0.3px] text-[10px] text-left">
                        Month
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px] text-left">
                        Predicted Revenue
                      </th>
                      <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px] text-left">
                        Est. Bookings
                      </th>
                      <th className="p-3 pr-5 font-semibold uppercase tracking-[0.3px] text-[10px] text-left">
                        Est. Nights
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {(revenueData.length > 0 ? (() => {
                      const avg3 = revenueData.length >= 3
                        ? Math.round(revenueData.slice(-3).reduce((s, m) => s + (m.paid + m.booked), 0) / 3)
                        : Math.round(revenueData.reduce((s, m) => s + (m.paid + m.booked), 0) / revenueData.length);
                      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                      const now = new Date();
                      return [1, 2, 3].map(offset => {
                        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
                        return { month: `${months[d.getMonth()]} ${d.getFullYear()}`, revenue: `R ${avg3.toLocaleString()}`, bookings: '--', nights: '--' };
                      });
                    })() : []).map((row, idx) =>
                  <tr key={idx}>
                        <td className="p-3 pl-5 text-[13px] font-medium text-[#222222]">
                          {row.month}
                          <span className="ml-2 text-[10px] font-semibold text-[#007AFF] bg-[#007AFF10] px-1.5 py-[1px] rounded-[3px]">
                            forecast
                          </span>
                        </td>
                        <td className="p-3 text-[13px] text-[#222222]">
                          {row.revenue}
                        </td>
                        <td className="p-3 text-[13px] text-[#717171]">
                          {row.bookings}
                        </td>
                        <td className="p-3 pr-5 text-[13px] text-[#717171]">
                          {row.nights}
                        </td>
                      </tr>
                  )}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 text-[11px] text-[#B0B0B0] italic">
                Based on same-month historical data where available, otherwise
                3-month average.
              </div>
            </div>

            {/* Pipeline Summary */}
            <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
              <h3 className="text-[15px] font-semibold text-[#222222] mb-4">
                Pipeline Summary
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {[
              {
                label: 'Total Revenue',
                value: (() => { const t = revenueData.reduce((s, m) => s + (m.paid + m.booked), 0); return t > 0 ? `R ${t.toLocaleString()}` : '--'; })()
              },
              {
                label: 'Net Revenue',
                value: netRevenue > 0 ? `R ${netRevenue.toLocaleString()}` : '--'
              },
              {
                label: 'Deductions %',
                value: commissionPercentage > 0 ? `${commissionPercentage}%` : '--'
              }].
              map((kpi, idx) =>
              <div key={idx} className="bg-[#F7F7F7] rounded-[10px] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                      {kpi.label}
                    </div>
                    <div className="text-[22px] font-bold tracking-[-0.3px] text-[#222222]">
                      {kpi.value}
                    </div>
                  </div>
              )}
              </div>
            </div>
          </>
        }

        {/* PLACEHOLDER FOR OTHER TABS */}
        {['patterns', 'market'].includes(activeTab) &&
        <div className="bg-white rounded-[12px] p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
            <div className="w-12 h-12 bg-[#F7F7F7] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-[20px]">📊</span>
            </div>
            <h3 className="text-[15px] font-semibold text-[#222222] mb-2 capitalize">
              {activeTab} Data
            </h3>
            <p className="text-[14px] text-[#717171] max-w-[250px] mx-auto">
              Detailed {activeTab} analytics and visualizations will appear
              here.
            </p>
          </div>
        }
      </div>
    </div>);

}