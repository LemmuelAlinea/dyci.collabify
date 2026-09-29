export type Scope = {
  classId: string
  projectId: string
  boardId: string
  studentId: string
  taskId: string
}

export const EMPTY_SCOPE: Scope = {
  classId: '',
  projectId: '',
  boardId: '',
  studentId: '',
  taskId: '',
}
