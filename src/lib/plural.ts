/**
 * `n === 1 ? one : many`, said once instead of at every call site.
 *
 * Its own file rather than living beside the component that first needed it:
 * a file that exports both a component and a plain function loses fast refresh
 * for everything in it, and the dashboards were about to share this.
 */
export function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}
