/**
 * The staff app ("control room"): sign-in state, routes, guards and the layout
 * (DESIGN.md, "The staff side"). Mounted by App.jsx at /staff/*.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Inbox, Lock, LogOut, MapPinned, Menu, UserCog, Users, X } from 'lucide-react'
import { LogoMark } from '../components/Logo.jsx'
import { StaffAuthProvider, useStaff } from './auth.jsx'
import { hasRole, ROLE_LABELS } from './ui.jsx'
import SignIn from './pages/SignIn.jsx'
import Queue from './pages/Queue.jsx'
import Incident from './pages/Incident.jsx'
import Teams from './pages/Teams.jsx'
import Members from './pages/Members.jsx'
import Places from './pages/Places.jsx'

export const STAFF_ROOT = '/staff'

const NAV_ITEMS = [
  {
    to: STAFF_ROOT,
    label: 'Queue',
    Icon: Inbox,
    minRole: 'dispatcher',
    // Incidents are opened from the queue, so the queue stays marked.
    isActive: (path) => path === STAFF_ROOT || path === `${STAFF_ROOT}/` || path.startsWith(`${STAFF_ROOT}/incidents`),
  },
  { to: `${STAFF_ROOT}/teams`, label: 'Teams', Icon: Users, minRole: 'supervisor' },
  { to: `${STAFF_ROOT}/members`, label: 'Staff', Icon: UserCog, minRole: 'admin' },
  { to: `${STAFF_ROOT}/places`, label: 'Places', Icon: MapPinned, minRole: 'admin' },
]

export default function StaffApp() {
  return (
    <StaffAuthProvider>
      <Routes>
        <Route path="sign-in" element={<SignIn />} />
        <Route element={<RequireStaff />}>
          <Route index element={<Page title="Queue" element={<Queue />} />} />
          <Route path="incidents/:id" element={<Page title="Incident" element={<Incident />} />} />
          <Route path="teams" element={<Page title="Teams" minRole="supervisor" element={<Teams />} />} />
          <Route path="members" element={<Page title="Staff" minRole="admin" element={<Members />} />} />
          <Route path="places" element={<Page title="Places" minRole="admin" element={<Places />} />} />
          <Route path="*" element={<Page title="Not found" element={<NotFoundPanel />} />} />
        </Route>
      </Routes>
    </StaffAuthProvider>
  )
}

/** Only signed-in staff get past here; everyone else is sent to sign in. */
function RequireStaff() {
  const { status } = useStaff()
  const location = useLocation()
  if (status === 'loading') return <LoadingScreen />
  if (status === 'signed_out') {
    return <Navigate to={`${STAFF_ROOT}/sign-in`} replace state={{ from: location }} />
  }
  if (status === 'not_staff') return <SignIn />
  return <StaffLayout />
}

/**
 * One routed page: sets the tab title and checks the role.
 * @param {{ title: string, element: import('react').ReactNode, minRole?: 'dispatcher' | 'supervisor' | 'admin' }} props
 */
function Page({ title, element, minRole = 'dispatcher' }) {
  const { staff } = useStaff()
  // A layout effect runs before the page's own effects, so a page can still set a
  // more specific title (e.g. the incident's headline) and win.
  useLayoutEffect(() => {
    document.title = `${title} · InfraAlert staff`
  }, [title])
  if (!hasRole(staff, minRole)) return <NoAccessPanel minRole={minRole} />
  return element
}

function StaffLayout() {
  return (
    <div className="min-h-screen bg-concrete-50 text-sm text-ink">
      <a
        href="#staff-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:border-2 focus:border-ink focus:bg-signal-400 focus:px-4 focus:py-3 focus:font-bold focus:text-ink"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink text-white lg:flex">
        <NavPanel />
      </aside>

      <MobileTopBar />

      <main id="staff-main" tabIndex={-1} className="min-h-screen focus:outline-none lg:pl-60">
        <Outlet />
      </main>
    </div>
  )
}

function Brand() {
  return (
    <Link to={STAFF_ROOT} className="flex items-center gap-2.5" aria-label="InfraAlert staff, queue">
      <LogoMark className="h-9 w-9 shrink-0" />
      <span>
        <span className="block text-lg font-black leading-none tracking-tight">
          Infra<span className="text-signal-400">Alert</span>
        </span>
        <span className="mt-1 block font-mono text-[11px] uppercase leading-none tracking-sign text-asphalt-400">
          Control room
        </span>
      </span>
    </Link>
  )
}

/** Logo, lane strip, nav and the signed-in person. Shared by the sidebar and the mobile menu. */
function NavPanel({ header = <Brand />, onNavigate }) {
  const { staff, signOut } = useStaff()
  const { pathname } = useLocation()
  const items = NAV_ITEMS.filter((item) => hasRole(staff, item.minRole))

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">{header}</div>
      <div className="lane-strip" aria-hidden="true" />

      <nav aria-label="Staff" className="mt-4 flex-1">
        <ul>
          {items.map(({ to, label, Icon, isActive }) => {
            const active = isActive ? isActive(pathname) : pathname === to || pathname.startsWith(`${to}/`)
            return (
              <li key={to}>
                <Link
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-[44px] items-center gap-3 px-5 text-[13px] font-extrabold uppercase tracking-sign transition-colors ${
                    active ? 'bg-asphalt-800 text-white' : 'text-asphalt-400 hover:bg-asphalt-800/60 hover:text-white'
                  }`}
                >
                  {active && <span className="absolute inset-y-0 left-0 w-1 bg-signal-400" aria-hidden="true" />}
                  <Icon size={18} strokeWidth={2.25} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {staff && (
        <div className="border-t border-asphalt-700 px-4 py-4">
          <p className="truncate font-bold text-white" title={staff.email}>
            {staff.display_name || staff.email}
          </p>
          <p className="mt-1 flex items-center gap-2">
            <span className="rounded border border-asphalt-600 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-sign text-signal-300">
              {ROLE_LABELS[staff.role] ?? staff.role}
            </span>
          </p>
          <button
            type="button"
            onClick={signOut}
            className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border-2 border-asphalt-600 px-3 font-bold text-white transition-colors hover:border-white"
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

function MobileTopBar() {
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const wasOpen = useRef(false)
  const { pathname } = useLocation()

  // Close on navigation.
  useEffect(() => setOpen(false), [pathname])

  // Focus the panel on open; hand focus back to the menu button on close.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector('button')?.focus()
    } else if (wasOpen.current) {
      menuButtonRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-ink text-white lg:hidden">
      <div className="flex h-14 items-center justify-between px-3">
        <Brand />
        <button
          ref={menuButtonRef}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border-2 border-asphalt-600 hover:border-white"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="staff-mobile-menu"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
      </div>
      <div className="lane-strip" aria-hidden="true" />

      {open && (
        <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
          <div className="absolute inset-0 bg-ink/60" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            id="staff-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ink text-white shadow-lift animate-rise-in"
          >
            <NavPanel
              onNavigate={() => setOpen(false)}
              header={
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <LogoMark className="h-9 w-9 shrink-0" />
                    <span className="font-mono text-[11px] uppercase tracking-sign text-asphalt-400">Control room</span>
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border-2 border-asphalt-600 hover:border-white"
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                  >
                    <X size={22} aria-hidden="true" />
                  </button>
                </div>
              }
            />
          </div>
        </div>
      )}
    </header>
  )
}

/** A quiet placeholder of the shell while we find out who is signed in. */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-concrete-50" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the control room…
      </span>
      <div className="h-14 bg-ink lg:hidden" aria-hidden="true" />
      <div className="fixed inset-y-0 left-0 hidden w-60 bg-ink lg:block" aria-hidden="true" />
      <div className="space-y-3 px-4 py-6 lg:pl-64 lg:pr-8" aria-hidden="true">
        <div className="h-7 w-48 animate-pulse rounded bg-concrete-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-concrete-200" />
        <div className="mt-6 h-12 animate-pulse rounded bg-concrete-100" />
        <div className="h-12 animate-pulse rounded bg-concrete-100" />
        <div className="h-12 animate-pulse rounded bg-concrete-100" />
      </div>
    </div>
  )
}

const ROLE_REQUIREMENT = {
  supervisor: 'This page is for supervisors and admins.',
  admin: 'This page is for admins.',
}

/** @param {{ minRole: 'dispatcher' | 'supervisor' | 'admin' }} props */
function NoAccessPanel({ minRole }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 animate-rise-in">
      <div className="card p-6">
        <Lock size={28} strokeWidth={2.25} aria-hidden="true" />
        <h1 className="mt-3 text-xl font-black">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-asphalt-600">
          {ROLE_REQUIREMENT[minRole] ?? ''} If you need it for your work, ask an admin to change your role.
        </p>
        <Link to={STAFF_ROOT} className="btn-secondary mt-5">
          Back to the queue
        </Link>
      </div>
    </div>
  )
}

function NotFoundPanel() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 animate-rise-in">
      <p className="font-mono text-xs text-asphalt-400">404 · ROAD CLOSED</p>
      <h1 className="mt-2 text-xl font-black">Page not found</h1>
      <p className="mt-2 text-asphalt-600">This staff page doesn&apos;t exist, or its link was mistyped.</p>
      <Link to={STAFF_ROOT} className="btn-secondary mt-5">
        Back to the queue
      </Link>
    </div>
  )
}
