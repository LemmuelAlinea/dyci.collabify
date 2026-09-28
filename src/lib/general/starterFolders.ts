/**
 * Folder layouts an empty Files can start from, by the kind of project it is.
 * Plain data: numbered where the order is the order the work happens, so the
 * folders sort the way people move through them.
 */

export type FolderLayout = { id: string; name: string; folders: string[] }

const RESEARCH: FolderLayout = {
  id: 'research',
  name: 'Research paper',
  folders: [
    '01 Proposal',
    '02 Chapters',
    '03 Instruments',
    '04 Data',
    '05 References',
    '06 Defense',
  ],
}

const SYSTEM: FolderLayout = {
  id: 'system',
  name: 'System or app',
  folders: ['docs', 'src', 'assets', 'tests', 'manuscript'],
}

const EVENT: FolderLayout = {
  id: 'event',
  name: 'Event',
  folders: [
    '01 Planning',
    '02 Budget',
    '03 Letters and permits',
    '04 Program',
    '05 Publicity',
    '06 Post-event report',
  ],
}

const COMPLIANCE: FolderLayout = {
  id: 'compliance',
  name: 'Accreditation or compliance',
  folders: ['01 Requirements', '02 Evidence', '03 Self-survey', '04 Action plan', '05 Submitted'],
}

const GENERAL: FolderLayout = {
  id: 'general',
  name: 'General',
  folders: ['Documents', 'Spreadsheets', 'References', 'Minutes', 'Final'],
}

export const LAYOUTS: FolderLayout[] = [RESEARCH, SYSTEM, EVENT, COMPLIANCE, GENERAL]

/** Which layout to suggest first, from the preset a project started with. */
export function suggestedLayout(preset: string | null, hasCode: boolean): FolderLayout {
  if (hasCode || preset === 'capstone') return SYSTEM
  switch (preset) {
    case 'research_paper':
    case 'action_research':
    case 'feasibility':
      return RESEARCH
    case 'school_event':
    case 'outreach':
    case 'competition':
      return EVENT
    case 'accreditation':
      return COMPLIANCE
    default:
      return GENERAL
  }
}
