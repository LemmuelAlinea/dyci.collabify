export type GroupFilterState = {
  query: string
  classId: string
  setId: string
}

export const EMPTY_FILTERS: GroupFilterState = { query: '', classId: '', setId: '' }
