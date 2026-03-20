export const kpis = [
{ label: 'Revenue', value: 'R 42,350', trend: '+12%', isPositive: true },
{ label: 'Occupancy', value: '78%', trend: '+5%', isPositive: true },
{ label: 'Avg Rate', value: 'R 1,850', trend: '-3%', isPositive: false }];


export const needsAttention = [
{
  id: 1,
  title: 'No cleaner assigned',
  subtitle: 'Sea Point Studio · tomorrow',
  dotColor: 'bg-[#D93900]'
},
{
  id: 2,
  title: '1-night gap on Mar 22',
  subtitle: 'Camps Bay Villa · offer discount?',
  dotColor: 'bg-[#E8913A]'
},
{
  id: 3,
  title: 'New review · 4.8 ★',
  subtitle: 'Maria K. · Green Point Apartment',
  dotColor: 'bg-[#007AFF]'
}];


export const currentlyStaying = [
{
  id: 1,
  property: 'Camps Bay Villa',
  platform: 'Airbnb',
  guestName: 'Thomas Mueller',
  meta: 'Germany · 3 guests · Mar 15–21',
  rate: 'R 2,100',
  total: 'R 12,600 total',
  isVacant: false
},
{
  id: 2,
  property: 'Green Point Apartment',
  platform: 'Booking',
  guestName: 'Sarah Johnson',
  meta: 'United Kingdom · 2 guests · Mar 16–19',
  rate: 'R 1,450',
  total: 'R 4,350 total',
  isVacant: false
},
{
  id: 3,
  property: 'Sea Point Studio',
  platform: 'Vacant',
  guestName: 'No current guest',
  meta: 'Next check-in: Mar 20 · Pierre Dupont',
  statusText: 'Needs cleaning · Thandi M. · tomorrow 10:00',
  statusType: 'needs-cleaning',
  isVacant: true
}];


export const nextUp = [
{
  id: 1,
  type: 'out',
  label: 'Check-out · tomorrow',
  name: 'Sarah Johnson',
  detail: 'Green Point Apartment'
},
{
  id: 2,
  type: 'in',
  label: 'Check-in · Mar 20',
  name: 'Pierre Dupont',
  detail: 'Sea Point Studio · France · 2 guests'
},
{
  id: 3,
  type: 'out',
  label: 'Check-out · Mar 21',
  name: 'Thomas Mueller',
  detail: 'Camps Bay Villa',
  isLast: true
}];


export const cleaningJobs = [
{
  id: 1,
  title: 'Sea Point Studio · Unassigned',
  subtitle: 'Tomorrow, 10:00–12:30 · before Pierre Dupont',
  status: 'warn',
  buttonText: 'Assign',
  isProblem: true
},
{
  id: 2,
  title: 'Green Point Apt · Thandi M.',
  subtitle: 'Mar 19, 11:00–13:30 · after Sarah Johnson',
  status: 'ok',
  buttonText: 'Confirmed',
  isProblem: false
},
{
  id: 3,
  title: 'Camps Bay Villa · Linda K.',
  subtitle: 'Mar 21, 10:00–13:00 · after Thomas Mueller',
  status: 'ok',
  buttonText: 'Confirmed',
  isProblem: false
}];


export const upcomingHolidays = [
{
  id: 1,
  title: 'Human Rights Day',
  subtitle: 'Mar 21 · South Africa · expect higher demand'
},
{
  id: 2,
  title: 'Good Friday',
  subtitle: 'Apr 18 · International · long weekend'
},
{
  id: 3,
  title: 'Easter Weekend',
  subtitle: 'Apr 18–21 · Europe + SA · peak bookings'
}];