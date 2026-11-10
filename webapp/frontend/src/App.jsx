import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { LogoMark } from './components/Logo.jsx'
import Unsubscribe from './pages/Unsubscribe.jsx'
import VerifyUpdates from './pages/VerifyUpdates.jsx'

// Loaded on demand: citizens never download the staff app or its sign-in SDK.
const StaffApp = lazy(() => import('./staff/StaffApp.jsx'))

// The two pages with a map are their own chunks, so the email-link pages and the
// 404 don't download Leaflet. Their download starts as soon as this module runs
// on one of their URLs, without waiting for React to render the route.
const loadReportForm = () => import('./pages/ReportForm.jsx')
const loadReportStatusPage = () => import('./pages/ReportStatusPage.jsx')
const ReportForm = lazy(loadReportForm)
const ReportStatusPage = lazy(loadReportStatusPage)
if (typeof window !== 'undefined') {
  const { pathname } = window.location
  if (pathname === '/') loadReportForm()
  else if (/^\/reports\/[^/]+\/?$/.test(pathname)) loadReportStatusPage()
}

/**
 * Shown while a map page's chunk loads. It fills the screen below the header,
 * so the footer doesn't appear and then jump down when the page arrives.
 */
function PageLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8 sm:py-10" aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        <div className="h-5 w-28 rounded bg-concrete-200" />
        <div className="h-10 w-56 rounded bg-concrete-200" />
        <div className="h-4 w-full max-w-md rounded bg-concrete-200" />
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center animate-rise-in">
      <p className="font-mono text-sm text-asphalt-400">404 · ROAD CLOSED</p>
      <h1 className="mt-3 text-3xl font-black">Page not found</h1>
      <p className="mt-2 text-asphalt-500">This page doesn&apos;t exist, or its link was mistyped.</p>
      <Link to="/" className="btn-primary mt-8">
        Report an issue
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/staff/*"
        element={
          <Suspense fallback={<div className="min-h-screen bg-concrete-50" aria-busy="true" />}>
            <StaffApp />
          </Suspense>
        }
      />
      <Route path="*" element={<CitizenApp />} />
    </Routes>
  )
}

/** The public, citizen-facing site. */
function CitizenApp() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="on-dark bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="InfraAlert home">
            <LogoMark className="h-9 w-9" />
            <span className="text-xl font-black tracking-tight">
              Infra<span className="text-signal-400">Alert</span>
            </span>
          </Link>
          <span className="hidden font-mono text-[11px] uppercase tracking-sign text-asphalt-400 sm:block">
            Public works · Citizen reports
          </span>
        </div>
        <div className="lane-strip" aria-hidden="true" />
      </header>

      <main className="flex-1">
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<ReportForm />} />
            <Route path="/reports/:id" element={<ReportStatusPage />} />
            <Route path="/reports/:id/verify" element={<VerifyUpdates />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="mt-12 border-t-4 border-ink bg-ink text-asphalt-400">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-6 text-xs sm:flex-row sm:justify-between">
          <span>
            <span className="font-bold text-white">InfraAlert</span> · reports go to city public works
          </span>
          <span className="font-mono">No account needed · your IP is never stored</span>
        </div>
      </footer>
    </div>
  )
}
