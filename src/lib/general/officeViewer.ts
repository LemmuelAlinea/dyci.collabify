import { isComparableExcel, isExcelPath, isWordPath } from './files'

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

/**
 * Whether a binary file gets a preview: any Word file (.docx, .doc, .odt, .rtf, as
 * a PDF the server makes), a .xlsx or .xlsm always (Microsoft's viewer, else the
 * in-app sheet view), a .xls only where Microsoft's viewer reaches it.
 */
export function officePreviewable(path: string, hostname: string) {
  return isWordPath(path) || isComparableExcel(path) || (isExcelPath(path) && officeViewerReachable(hostname))
}
