import { vi } from 'vitest'

// Unit tests never reach the real Supabase project. A test that needs other values
// mocks '../lib/api/orgSettings' itself, which overrides this default.
vi.mock('../lib/api/orgSettings', () => ({
  getOrganizationSettings: vi.fn(async () => ({
    quiet_days: 14,
    trash_retention_days: 30,
    new_project_visibility: 'private',
    school_email_domain: 'dyci.edu.ph',
  })),
  setOrganizationSettings: vi.fn(),
  trashPurgePreview: vi.fn(),
}))
