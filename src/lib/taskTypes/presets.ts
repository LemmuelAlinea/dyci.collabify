// src/lib/taskTypes/presets.ts
/** The task type presets a project manager or professor applies in Settings → Tasks. */
import type { IconName } from '../../components/ui/Icon'
import type { TaskTypeIcon } from './icons'
import type { TaskTypeEntry, TypeFamily, TypeSlot } from './typeSet'

export type TaskTypePreset = { key: string; name: string; icon: IconName; types: TaskTypeEntry[] }

const t = (slot: TypeSlot, name: string, color: string, icon: TaskTypeIcon, description: string): TaskTypeEntry =>
  ({ slot, name, description, color, icon })
const D = 'default' as const
const B = 'bug' as const
const C = null

export const TASK_TYPE_PRESETS: readonly TaskTypePreset[] = [
  { key: 'general', name: 'General Project', icon: 'kanban', types: [
    t(D, 'Task', '#2563eb', 'square-check', 'Standard actionable work'),
    t(C, 'Deliverable', '#9333ea', 'package', 'Required project output'),
    t(C, 'Planning', '#d97706', 'list-checks', 'Planning and preparation'),
    t(C, 'Documentation', '#64748b', 'file-text', 'Project records and documents'),
    t(C, 'Review', '#0d9488', 'clipboard-check', 'Evaluation of completed work'),
    t(B, 'Issue', '#dc2626', 'circle-alert', 'Problems requiring resolution'),
    t(C, 'Approval', '#16a34a', 'circle-check', 'Work requiring authorization'),
  ] },
  { key: 'software', name: 'System and Software Development', icon: 'code', types: [
    t(D, 'Task', '#2563eb', 'square-check', 'General development work'),
    t(B, 'Bug Task', '#dc2626', 'bug', 'Software defects'),
    t(C, 'Deployment', '#0891b2', 'rocket', 'System releases and delivery'),
    t(C, 'Feature', '#9333ea', 'layers', 'New functionality'),
    t(C, 'Onboarding', '#16a34a', 'user-plus', 'Member and environment setup'),
    t(C, 'Product Backlog Item', '#d97706', 'list-todo', 'Product requirements'),
    t(C, 'Test Case', '#0d9488', 'clipboard-check', 'Software testing'),
    t(C, 'Epic', '#db2777', 'zap', 'Large bodies of work'),
  ] },
  { key: 'research', name: 'Academic and Research', icon: 'school', types: [
    t(D, 'Research Task', '#2563eb', 'search', 'General research activities'),
    t(C, 'Research Objective', '#9333ea', 'target', 'Major research work grouping'),
    t(C, 'Literature Review', '#7c3aed', 'book-open', 'Review of related studies'),
    t(C, 'Data Collection', '#0891b2', 'database', 'Gathering research data'),
    t(C, 'Data Analysis', '#0d9488', 'chart', 'Statistical and qualitative analysis'),
    t(C, 'Experiment', '#ea580c', 'flask', 'Experimental procedures'),
    t(C, 'Manuscript Writing', '#64748b', 'file-pen', 'Writing research documents'),
    t(C, 'Validation', '#16a34a', 'shield-check', 'Instrument and result validation'),
    t(C, 'Revision', '#d97706', 'square-pen', 'Corrections and improvements'),
    t(C, 'Ethics Review', '#db2777', 'scale', 'Research ethics requirements'),
  ] },
  { key: 'feasibility', name: 'Feasibility Study', icon: 'chart', types: [
    t(D, 'Study Task', '#2563eb', 'square-check', 'General feasibility work'),
    t(C, 'Market Study', '#9333ea', 'pie-chart', 'Demand and competitor assessment'),
    t(C, 'Technical Study', '#0891b2', 'cog', 'Technical requirements and viability'),
    t(C, 'Financial Study', '#16a34a', 'calculator', 'Costs and profitability'),
    t(C, 'Management Study', '#4f46e5', 'users', 'Organizational requirements'),
    t(C, 'Socioeconomic Study', '#0d9488', 'globe', 'Social and economic impact'),
    t(C, 'Legal Compliance', '#64748b', 'scale', 'Legal and regulatory requirements'),
    t(C, 'Risk Assessment', '#dc2626', 'shield-alert', 'Business risks and threats'),
    t(C, 'Report Preparation', '#d97706', 'file-text', 'Findings and recommendations'),
  ] },
  { key: 'construction', name: 'Construction', icon: 'hardHat', types: [
    t(C, 'Work Package', '#9333ea', 'package', 'Grouped construction activities'),
    t(D, 'Construction Task', '#2563eb', 'hard-hat', 'Site construction work'),
    t(C, 'Site Preparation', '#a16207', 'shovel', 'Site clearing and preparation'),
    t(C, 'Procurement', '#d97706', 'shopping-cart', 'Materials and equipment purchasing'),
    t(C, 'Installation', '#0891b2', 'wrench', 'Equipment and system installation'),
    t(C, 'Inspection', '#0d9488', 'scan-search', 'Site and quality inspections'),
    t(C, 'Safety Task', '#ea580c', 'shield-alert', 'Workplace safety requirements'),
    t(C, 'Permit', '#64748b', 'file-check', 'Construction permits'),
    t(B, 'Deficiency', '#dc2626', 'triangle-alert', 'Nonconforming work'),
    t(C, 'Handover', '#16a34a', 'handshake', 'Completed work turnover'),
  ] },
  { key: 'real-estate', name: 'Real Estate', icon: 'building', types: [
    t(D, 'Property Task', '#2563eb', 'building', 'General property activities'),
    t(C, 'Property Acquisition', '#9333ea', 'key', 'Land and property acquisition'),
    t(C, 'Site Assessment', '#0891b2', 'map-pin', 'Property location evaluation'),
    t(C, 'Due Diligence', '#0d9488', 'scan-search', 'Property and ownership verification'),
    t(C, 'Valuation', '#16a34a', 'calculator', 'Property value assessment'),
    t(C, 'Permit and Compliance', '#64748b', 'file-check', 'Regulatory documentation'),
    t(C, 'Listing and Marketing', '#db2777', 'megaphone', 'Property promotion'),
    t(C, 'Negotiation', '#d97706', 'handshake', 'Client and seller negotiations'),
    t(C, 'Contract Processing', '#4f46e5', 'square-pen', 'Agreements and contracts'),
    t(C, 'Property Turnover', '#ea580c', 'key', 'Property handover activities'),
  ] },
  { key: 'business', name: 'Business and Entrepreneurship', icon: 'briefcase', types: [
    t(D, 'Business Task', '#2563eb', 'square-check', 'General business activities'),
    t(C, 'Business Initiative', '#9333ea', 'target', 'Major business objectives'),
    t(C, 'Market Research', '#0891b2', 'search', 'Market and competitor analysis'),
    t(C, 'Financial Planning', '#16a34a', 'wallet', 'Financial projections and budgeting'),
    t(C, 'Strategy Development', '#4f46e5', 'lightbulb', 'Business strategy creation'),
    t(C, 'Procurement', '#d97706', 'shopping-cart', 'Resource acquisition'),
    t(C, 'Business Compliance', '#64748b', 'scale', 'Registration and compliance'),
    t(C, 'Business Launch', '#db2777', 'rocket', 'Launching business operations'),
    t(C, 'Performance Review', '#0d9488', 'chart', 'Business performance evaluation'),
  ] },
  { key: 'marketing', name: 'Marketing and Advertising', icon: 'megaphone', types: [
    t(D, 'Marketing Task', '#2563eb', 'square-check', 'General marketing work'),
    t(C, 'Campaign', '#9333ea', 'megaphone', 'Grouped promotional activities'),
    t(C, 'Market Research', '#0891b2', 'search', 'Audience and competitor research'),
    t(C, 'Content Creation', '#db2777', 'pen-tool', 'Marketing content production'),
    t(C, 'Creative Design', '#7c3aed', 'palette', 'Promotional visual assets'),
    t(C, 'Advertising', '#ea580c', 'radio', 'Advertising activities'),
    t(C, 'Publication', '#16a34a', 'send', 'Content publishing'),
    t(C, 'Campaign Analytics', '#0d9488', 'chart', 'Campaign performance analysis'),
    t(C, 'Content Review', '#d97706', 'clipboard-check', 'Content verification'),
  ] },
  { key: 'events', name: 'Event Management', icon: 'calendar', types: [
    t(D, 'Event Task', '#2563eb', 'square-check', 'General event activities'),
    t(C, 'Event Planning', '#9333ea', 'calendar', 'Event preparation'),
    t(C, 'Venue Management', '#0891b2', 'map-pin', 'Venue arrangements'),
    t(C, 'Logistics', '#ea580c', 'truck', 'Equipment and transportation'),
    t(C, 'Supplier Coordination', '#d97706', 'handshake', 'Vendor management'),
    t(C, 'Registration', '#16a34a', 'user-plus', 'Participant registration'),
    t(C, 'Promotion', '#db2777', 'megaphone', 'Event advertising'),
    t(C, 'Event Production', '#4f46e5', 'monitor-play', 'Program execution'),
    t(C, 'Post-event Evaluation', '#0d9488', 'clipboard-check', 'Feedback and event assessment'),
  ] },
  { key: 'creative', name: 'Creative and Design', icon: 'palette', types: [
    t(D, 'Creative Task', '#2563eb', 'square-check', 'General creative activities'),
    t(C, 'Concept Development', '#d97706', 'lightbulb', 'Creative ideation'),
    t(C, 'Design', '#9333ea', 'palette', 'Visual and graphic design'),
    t(C, 'Content Writing', '#4f46e5', 'pen-tool', 'Written content'),
    t(C, 'Asset Production', '#db2777', 'image', 'Multimedia asset creation'),
    t(C, 'Editing', '#ea580c', 'scissors', 'Content editing'),
    t(C, 'Creative Review', '#0d9488', 'scan-eye', 'Creative quality review'),
    t(C, 'Revision', '#0891b2', 'refresh-cw', 'Requested creative changes'),
    t(C, 'Publication', '#16a34a', 'send', 'Final content release'),
  ] },
  { key: 'hr', name: 'Human Resources', icon: 'users', types: [
    t(D, 'HR Task', '#2563eb', 'square-check', 'General HR activities'),
    t(C, 'Recruitment', '#9333ea', 'user-search', 'Candidate recruitment'),
    t(C, 'Screening', '#0891b2', 'filter', 'Applicant screening'),
    t(C, 'Interview', '#4f46e5', 'messages-square', 'Candidate interviews'),
    t(C, 'Onboarding', '#16a34a', 'user-plus', 'New employee integration'),
    t(C, 'Training', '#d97706', 'graduation-cap', 'Employee development'),
    t(C, 'Performance Evaluation', '#0d9488', 'clipboard-check', 'Employee evaluation'),
    t(C, 'HR Compliance', '#64748b', 'shield-check', 'Employment requirements'),
    t(C, 'Offboarding', '#ea580c', 'user-minus', 'Employee separation processes'),
  ] },
  { key: 'operations', name: 'Operations and Administration', icon: 'settings', types: [
    t(D, 'Operational Task', '#2563eb', 'square-check', 'Routine operational work'),
    t(C, 'Administrative Task', '#64748b', 'briefcase', 'Administrative activities'),
    t(C, 'Process Improvement', '#9333ea', 'workflow', 'Process optimization'),
    t(C, 'Service Request', '#0891b2', 'inbox', 'Internal service requests'),
    t(C, 'Maintenance', '#ea580c', 'wrench', 'Equipment and system upkeep'),
    t(C, 'Procurement', '#d97706', 'shopping-cart', 'Resource purchasing'),
    t(B, 'Incident', '#dc2626', 'triangle-alert', 'Operational disruptions'),
    t(C, 'Audit', '#0d9488', 'clipboard-check', 'Operational verification'),
    t(C, 'Approval', '#16a34a', 'circle-check', 'Management authorization'),
  ] },
  { key: 'product', name: 'Product Development', icon: 'package', types: [
    t(D, 'Product Task', '#2563eb', 'square-check', 'General product development'),
    t(C, 'Product Initiative', '#db2777', 'target', 'Major product objectives'),
    t(C, 'Product Research', '#0891b2', 'search', 'Customer and product research'),
    t(C, 'Product Design', '#9333ea', 'drafting-compass', 'Product specifications'),
    t(C, 'Prototype', '#d97706', 'package', 'Experimental product models'),
    t(C, 'Manufacturing', '#ea580c', 'factory', 'Product manufacturing'),
    t(C, 'Product Testing', '#0d9488', 'flask', 'Performance verification'),
    t(B, 'Product Defect', '#dc2626', 'circle-alert', 'Product quality issues'),
    t(C, 'Product Launch', '#16a34a', 'rocket', 'Market release'),
  ] },
  { key: 'finance', name: 'Finance and Accounting', icon: 'calculator', types: [
    t(D, 'Financial Task', '#2563eb', 'square-check', 'General financial activities'),
    t(C, 'Budgeting', '#9333ea', 'wallet', 'Budget preparation'),
    t(C, 'Financial Analysis', '#0891b2', 'chart', 'Financial performance analysis'),
    t(C, 'Transaction Processing', '#16a34a', 'receipt', 'Financial transactions'),
    t(C, 'Reconciliation', '#4f46e5', 'arrow-left-right', 'Financial record reconciliation'),
    t(C, 'Audit', '#0d9488', 'scan-search', 'Financial verification'),
    t(C, 'Tax Compliance', '#d97706', 'scale', 'Tax requirements'),
    t(C, 'Financial Reporting', '#64748b', 'file-chart', 'Financial statements and reports'),
    t(B, 'Discrepancy', '#dc2626', 'triangle-alert', 'Financial inconsistencies'),
  ] },
]

export function presetByKey(key: string | null | undefined): TaskTypePreset | null {
  return TASK_TYPE_PRESETS.find((p) => p.key === key) ?? null
}

/**
 * The set a preset makes of the current one. A class project has no bug slot, so the preset's bug
 * type becomes a custom one; a work preset with no bug type keeps the project's bug type, last.
 * `removed` is each current custom name the new set doesn't hold.
 */
export function applyPreset(
  current: TaskTypeEntry[],
  preset: TaskTypePreset,
  family: TypeFamily,
): { set: TaskTypeEntry[]; removed: string[] } {
  const set = preset.types.map((t) => ({ ...t, slot: family === 'class' && t.slot === 'bug' ? null : t.slot }))
  if (family === 'work' && !set.some((t) => t.slot === 'bug')) {
    const bug = current.find((t) => t.slot === 'bug')
    if (bug) set.push({ ...bug })
  }
  const kept = new Set(set.filter((t) => t.slot === null).map((t) => t.name))
  const removed = current.filter((t) => t.slot === null && !kept.has(t.name)).map((t) => t.name)
  return { set, removed }
}
