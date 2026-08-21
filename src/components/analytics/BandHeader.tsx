/**
 * The heading of one analytics band.
 *
 * The eyebrow names which of the four kinds of analytics the band is —
 * descriptive, diagnostic, predictive, prescriptive — and the heading asks the
 * question in the words a professor would use. Both on purpose: the label
 * answers anybody who asks what kind of analysis this is, and the question is
 * what the page is actually for.
 */
export function BandHeader({
  kind,
  title,
  body,
}: {
  kind: 'Descriptive' | 'Diagnostic' | 'Predictive' | 'Prescriptive'
  title: string
  body: string
}) {
  return (
    <header className="border-t border-line pt-6">
      <p className="eyebrow">{kind}</p>
      <h2 className="mt-1 text-[21px] leading-tight">{title}</h2>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">{body}</p>
    </header>
  )
}
