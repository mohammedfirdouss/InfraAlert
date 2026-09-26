import { Link, Route, Routes } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import ReportForm from './pages/ReportForm.jsx'
import ReportStatusPage from './pages/ReportStatusPage.jsx'

function NotFound() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-gray-900">Page not found</h1>
      <Link to="/" className="btn-primary mt-6">
        Report an issue
      </Link>
    </div>
  )
}

/** Citizen-facing app. The staff dashboard arrives in step 4 behind SSO. */
export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link to="/" className="flex items-center gap-2 text-white font-bold text-lg">
            <span className="p-1 bg-primary-600 rounded-lg">
              <AlertTriangle size={18} className="text-white" aria-hidden="true" />
            </span>
            InfraAlert
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<ReportForm />} />
          <Route path="/reports/:id" element={<ReportStatusPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="bg-gray-900 text-gray-500 text-xs text-center py-4 border-t border-gray-800">
        &copy; {new Date().getFullYear()} InfraAlert
      </footer>
    </div>
  )
}
