import { Link } from 'react-router-dom';
import { DollarSign, Wrench, UserCog, Settings, Star, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

const items = [
  { to: '/finances', icon: DollarSign, label: 'Finances', desc: 'Expenses, P&L, categories', color: 'bg-green-50 text-green-600' },
  { to: '/maintenance', icon: Wrench, label: 'Maintenance', desc: 'Issues & repairs', color: 'bg-amber-50 text-amber-600' },
  { to: '/users', icon: UserCog, label: 'Users', desc: 'Team & permissions', color: 'bg-purple-50 text-purple-600' },
  { to: '/settings', icon: Settings, label: 'Settings', desc: 'Currency & preferences', color: 'bg-gray-100 text-gray-600' },
  { to: '/reviews', icon: Star, label: 'Reviews', desc: 'Guest feedback', color: 'bg-yellow-50 text-yellow-600' },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <div className="p-4 md:p-6">
        <div className="space-y-2 max-w-lg">
          {items.map(({ to, icon: Icon, label, desc, color }) => (
            <Link
              key={to}
              to={to}
              className="card flex items-center gap-4 hover:border-primary-300 transition-colors"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
