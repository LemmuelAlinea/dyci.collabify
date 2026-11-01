/**
 * Thrown by deleteGeneralProject when the project row is already gone and only
 * the clean-up of its uploaded files failed. Callers leave the project's pages
 * instead of showing a retryable error.
 */
export class ProjectDeletedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectDeletedError'
  }
}
