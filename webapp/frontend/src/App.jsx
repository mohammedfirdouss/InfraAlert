import React, { useState } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import { AlertTriangle, LayoutDashboard, FilePlus, ClipboardList, Menu, X } from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import ReportForm from './pages/ReportForm.jsx'
import ReportsList from './pages/ReportsList.jsx'
import ReportDetail from './pages/ReportDetail.jsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/report', label: 'Report Issue', icon: FilePlus },
  { to: '/reports', label: 'View Reports', icon: ClipboardList },
]

function NavItem({ to, label, icon: Icon, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white',
        ].join(' ')
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on navigation
  React.useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation bar */}
      <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 text-white font-bold text-lg shrink-0">
              <div className="p-1 bg-primary-600 rounded-lg">
                <AlertTriangle size={18} className="text-white" />
              </div>
              <span>InfraAlert</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>

            {/* Report Issue CTA (desktop) */}
            <Link
              to="/report"
              className="hidden sm:inline-flex btn-primary text-xs py-1.5 px-3"
            >
              <FilePlus size={14} />
              Report Issue
            </Link>

            {/* Mobile hamburger */}
            <button
              className="sm:hidden p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="sm:hidden border-t border-gray-800 px-4 py-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <NavItem
                key={item.to}
                {...item}
                onClick={() => setMobileOpen(false)}
              />
            ))}
          </div>
        )}
      </nav>

      {/* Page content */}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/report" element={<ReportForm />} />
          <Route path="/reports" element={<ReportsList />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-500 text-xs text-center py-4 border-t border-gray-800">
        &copy; {new Date().getFullYear()} InfraAlert — AI-powered infrastructure issue reporting
      </footer>
    </div>
  )
}
