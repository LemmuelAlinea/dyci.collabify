/**
 * Opens a tab for a download whose link takes awaits to make.
 *
 * Call it from inside the click, before anything is awaited: the tab opens
 * at once, which popup blockers allow, and gets its address after `load`. If
 * the browser blocked the tab anyway, this answers the link for the page to
 * show instead (null when the tab got it). A failed `load` closes the tab.
 */
export async function openTabFor(load: () => Promise<string>): Promise<string | null> {
  const tab = window.open('', '_blank')
  try {
    const url = await load()
    if (!tab) return url
    tab.opener = null
    tab.location.href = url
    return null
  } catch (err) {
    tab?.close()
    throw err
  }
}
