const OFFICE_EMBED = 'https://view.officeapps.live.com/op/embed.aspx'

/** Microsoft's viewer page for a file it can fetch at `fileUrl`. */
export function officeViewerUrl(fileUrl: string) {
  return `${OFFICE_EMBED}?src=${encodeURIComponent(fileUrl)}`
}

/**
 * Microsoft can only fetch a file from a public address, so on a developer's
 * own machine the viewer has nothing to show.
 */
export function officeViewerReachable(hostname: string) {
  return !/^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost|.*\.test)$/i.test(hostname)
}
