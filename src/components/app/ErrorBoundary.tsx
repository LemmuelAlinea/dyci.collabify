import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button, ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'

type Props = {
  children: ReactNode
  /** Where the failure happened, so the message can say which part broke. */
  scope?: string
  /** Where "get me out of here" goes. The role's own home, when there is one. */
  home?: string
}

type State = { error: Error | null }

/**
 * The last thing between a thrown error and a blank white page.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * before this existed one bad row of data took the entire app down to nothing —
 * no rail, no navigation, no way back short of the browser's reload button.
 * That is the difference between a defect and a dead end, and it is the first
 * thing anybody testing reliability tries.
 *
 * A class component because React still has no hook for this; there is no
 * `useErrorBoundary`, and `componentDidCatch` is the only way in.
 *
 * Two rules about what is shown. The person reading it is a student or a
 * professor, so the message says what to do rather than what went wrong in
 * JavaScript terms — and the real error goes to the console, where whoever is
 * debugging will look, rather than onto the screen where it helps nobody and
 * leaks the shape of the code.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept deliberately: this is the only record of what happened, and the
    // component stack is what makes it findable.
    console.error(`Collabify crashed${this.props.scope ? ` in ${this.props.scope}` : ''}`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400">
          <Icon name="alert" size={26} />
        </span>

        <h1 className="mt-5 leading-snug">
          {this.props.scope ? `${this.props.scope} stopped working` : 'Something went wrong'}
        </h1>

        <p className="mt-2.5 max-w-[46ch] text-[14px] leading-relaxed text-muted">
          Nothing you did caused this and nothing you have saved is lost. Try the page again
          — if it keeps happening, tell whoever looks after Collabify what you were doing.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {/* Clearing the error remounts the children, which is a real retry:
              the page refetches from scratch rather than reusing what broke. */}
          <Button className="!rounded-xl" onClick={() => this.setState({ error: null })}>
            <Icon name="refresh" size={16} />
            Try again
          </Button>
          {this.props.home && (
            <ButtonLink to={this.props.home} variant="outline" className="!rounded-xl">
              Back to the dashboard
            </ButtonLink>
          )}
        </div>
      </div>
    )
  }
}
