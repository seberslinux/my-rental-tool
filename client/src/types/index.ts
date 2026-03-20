export interface User {
  id: number;
  email?: string;
  name: string;
  role: 'admin' | 'property_manager' | 'cleaner';
  avatar_url?: string;
  phone?: string;
  authType?: 'pin' | 'token';
  active?: boolean;
  created_at?: string;
  property_ids?: number[];
}

export interface Property {
  id: number;
  smoobu_id: number;
  name: string;
  address?: string;
  cleaning_hours_required?: number;
  base_price?: number;
  base_currency?: string;
  airbnb_url?: string;
  booking_url?: string;
  vrbo_url?: string;
  airbnb_commission?: number;
  booking_commission?: number;
  vrbo_commission?: number;
  airbnb_bank_charge?: number;
  booking_bank_charge?: number;
  vrbo_bank_charge?: number;
  vat_rate?: number;
  property_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  max_guests?: number;
  location?: string;
  neighbourhood?: string;
  wifi_network?: string;
  wifi_password?: string;
  access_code?: string;
  check_in_instructions?: string;
  check_in_time?: string;
  check_out_time?: string;
  checklist_clean?: string;
  checklist_inspect?: string;
}

export interface Booking {
  id: number;
  smoobu_id?: number;
  property_id: number;
  property_name?: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  platform: string;
  total_price?: number;
  price_per_night?: number;
  currency?: string;
  status?: string;
  num_guests?: number;
  created_at?: string;
  lead_time_days?: number;
  length_of_stay?: number;
}

export interface Cleaner {
  id: number;
  name: string;
  phone: string;
  email?: string;
  hourly_rate?: number;
  flat_rate?: number;
  rate_type?: 'hourly' | 'flat';
  notes?: string;
  properties?: { id: number; name: string }[];
  availability?: CleanerAvailability[];
  overrides?: CleanerOverride[];
}

export interface CleanerAvailability {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CleanerOverride {
  date: string;
  available: boolean;
}

export interface CleaningJob {
  id: number;
  property_id: number;
  property_name?: string;
  cleaner_id?: number;
  cleaner_name?: string;
  booking_id?: number;
  cleaning_date: string;
  start_time?: string;
  end_time?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'ready';
}

export interface DashboardStats {
  upcoming_checkouts: Booking[];
  occupancy: OccupancyItem[];
  gaps: GapItem[];
  pending_cleaning_jobs: CleaningJob[];
  display_currency: string;
}

export interface OccupancyItem {
  property_id: number;
  name: string;
  occupancy_rate: number;
  booked_nights: number;
}

export interface GapItem {
  property_id: number;
  property_name: string;
  gap_start: string;
  gap_end: string;
  nights: number;
}

export interface Expense {
  id: number;
  property_id: number;
  property_name?: string;
  category_id: number;
  category_name?: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  vendor?: string;
  is_recurring?: boolean;
  recurrence_interval?: string;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  is_default?: boolean;
}

export interface MaintenanceIssue {
  id: number;
  property_id: number;
  property_name?: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
  assigned_to?: string;
  reported_date: string;
  resolved_date?: string;
  cost?: number;
}

export interface Review {
  id: number;
  property_id: number;
  property_name?: string;
  guest_name?: string;
  platform?: string;
  rating: number;
  comment?: string;
  date: string;
  sentiment?: string;
}

export interface PaySummary {
  month: string;
  cleaners: {
    cleaner_id: number;
    cleaner_name: string;
    jobs: CleaningJob[];
    subtotal: number;
  }[];
  grand_total: number;
}

export interface PropertySummary {
  property: Property;
  kpis: {
    revenue_30d: number;
    occupancy_30d: number;
    avg_nightly_rate_30d: number;
    net_profit_30d: number;
    cancellation_rate_30d: number;
  };
  monthly: {
    month: string;
    revenue: number;
    occupancy_pct: number;
    avg_rate: number;
    booking_count: number;
  }[];
  upcoming_bookings: Booking[];
  recent_reviews: Review[];
}
