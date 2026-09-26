/**
 * Staff sign-in state (ADR 0007). OWNER: agent "staff-shell". Contract only until implemented.
 *
 * useStaff() returns:
 *   status: 'loading' | 'signed_out' | 'signed_in' | 'not_staff'
 *   staff: Me | null            (from GET /api/staff/me once signed in)
 *   signInWithSso(): Promise<void>
 *   signInDev(email): Promise<void>   (config.staffAuth === 'dev' only)
 *   signOut(): Promise<void>
 */
import { createContext, useContext } from 'react'

const StaffAuthContext = createContext(null)

export function StaffAuthProvider({ children }) {
  return <StaffAuthContext.Provider value={null}>{children}</StaffAuthContext.Provider>
}

export function useStaff() {
  return useContext(StaffAuthContext)
}
