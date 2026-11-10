/**
 * Card heading in the field-report voice: "01  PROGRESS". The number is
 * decoration, so it is hidden from assistive tech. `rule` draws the hairline
 * that runs from the title to the card's edge (the report form's sections).
 * @param {{ id?: string, no: string, rule?: boolean, children: import('react').ReactNode }} props
 */
export default function SectionHeading({ id, no, rule = false, children }) {
  return (
    <h2 id={id} className={rule ? 'mb-5 flex items-center gap-3' : 'flex items-baseline gap-2.5'}>
      <span className="section-no" aria-hidden="true">
        {no}
      </span>
      <span className="section-title">{children}</span>
      {rule && <span className="h-px flex-1 bg-concrete-200" aria-hidden="true" />}
    </h2>
  )
}
