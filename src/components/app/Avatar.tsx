import { initials } from '../../lib/types'
import type { Profile } from '../../lib/types'

export function Avatar({
  profile,
  size = 36,
}: {
  profile: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>
  size?: number
}) {
  const box = { width: size, height: size }

  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        style={box}
        className="shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
      />
    )
  }

  return (
    <span
      style={{ ...box, fontSize: Math.max(11, size * 0.36) }}
      className="grid shrink-0 place-items-center rounded-full bg-navy-600 font-semibold text-amber-400 dark:bg-navy-500"
      aria-hidden
    >
      {initials(profile)}
    </span>
  )
}
