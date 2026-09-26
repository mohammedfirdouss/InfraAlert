/**
 * InfraAlert mark: a road-sign diamond in signal yellow holding a survey pin.
 * @param {{ className?: string }} props
 */
export function LogoMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="6" y="6" width="28" height="28" rx="4" transform="rotate(45 20 20)"
        fill="#ffd60a" stroke="#14161a" strokeWidth="2.5" />
      <path d="M20 29.5c-.6 0-6.2-6.6-6.2-11.6a6.2 6.2 0 1 1 12.4 0c0 5-5.6 11.6-6.2 11.6Z"
        fill="#14161a" />
      <circle cx="20" cy="17.8" r="2.4" fill="#ffd60a" />
    </svg>
  )
}
