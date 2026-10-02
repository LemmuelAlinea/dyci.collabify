import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'

/**
 * Marks the member who leads their group, wherever members are listed. On a
 * phone it is the crown alone, so the name beside it keeps its room.
 */
export function LeaderBadge({ className = '' }: { className?: string }) {
  return (
    <span title="Group leader" className={`inline-flex ${className}`}>
      <Badge tone="accent" className="gap-1 !px-1.5 font-medium">
        <Icon name="crown" size={11} strokeWidth={2} />
        <span className="max-sm:sr-only">Leader</span>
      </Badge>
    </span>
  )
}
