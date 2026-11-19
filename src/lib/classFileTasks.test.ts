import { describe, expect, it } from 'vitest'
import { alreadySetTitles, fileRows, fitLabel, noteFitDefaults, retarget, type FileTask } from './classFileTasks'
import type { ProjectTask } from './types'

const r = (origin: string | null, board: string, title: string) => ({ origin_id: origin, board_id: board, title }) as ProjectTask
const t = (title: string, fit: FileTask['fit'] = 'fits'): FileTask => ({ title, details: '', weight: 1, due: '', fit, fit_reason: fit === 'off' ? 'Not in weeks 5–8.' : '' })

describe('alreadySetTitles', () => {
  const rows = [r('o1', 'b1', 'Write the proposal'), r('o2', 'b1', 'Build the model'), r('o2', 'b2', ' Build the MODEL '), r(null, 'b2', 'Own task')]
  it('counts a task for every group only when it reached every board', () => {
    expect(alreadySetTitles(rows, 2, '')).toEqual(new Set(['build the model']))
  })
  it('counts a task for one group when it reached that board', () => {
    expect(alreadySetTitles(rows, 2, 'b1')).toEqual(new Set(['write the proposal', 'build the model']))
  })
  it('ignores tasks a group made itself', () => {
    expect(alreadySetTitles(rows, 2, 'b2')).toEqual(new Set(['build the model']))
  })
})

describe('fileRows', () => {
  it('starts off and already-set rows unticked', () => {
    const rows = fileRows([t('Build the model'), t('Make a TikTok page', 'off'), t('Write the proposal')], new Set(['write the proposal']))
    expect(rows.map((x) => [x.keep, x.already])).toEqual([[true, false], [false, false], [false, true]])
  })
  it('keeps a task with no verdict ticked', () => {
    const [row] = fileRows([{ ...t('Build the model'), fit: undefined as never }], new Set())
    expect(row.keep).toBe(true)
  })
  it('starts every row unticked when no task fits', () => {
    expect(fileRows([t('a', 'off'), t('b', 'off')], new Set()).some((x) => x.keep)).toBe(false)
  })
})

describe('retarget', () => {
  it('unticks only rows that newly become already set', () => {
    const start = fileRows([t('Make a TikTok page', 'off'), t('Build the model')], new Set())
    Object.assign(start[0], { keep: true, touched: true }) // ticked back on by hand
    const next = retarget(start, new Set(['build the model']))
    expect(next.map((x) => [x.keep, x.already])).toEqual([[true, false], [false, true]])
  })
  it('leaves a row the person ticked while already set alone when it stays already set', () => {
    const start = fileRows([t('Build the model')], new Set(['build the model']))
    Object.assign(start[0], { keep: true, touched: true })
    expect(retarget(start, new Set(['build the model']))[0].keep).toBe(true)
  })
  it('ticks an untouched row again when the new target lacks the task', () => {
    const start = fileRows([t('Build the model')], new Set(['build the model']))
    expect(retarget(start, new Set())[0]).toMatchObject({ already: false, keep: true })
  })
})

describe('fitLabel', () => {
  it('names a row both already set and off as Already set', () => {
    expect(fitLabel({ fit: 'off', already: true })).toBe('Already set')
  })
  it('names the verdict otherwise', () => {
    expect(fitLabel({ fit: 'off' })).toBe("Doesn't fit")
    expect(fitLabel({ fit: 'fits' })).toBe('Fits')
    expect(fitLabel({})).toBe('Fits')
  })
})

describe('noteFitDefaults', () => {
  it('unticks a class task that does not fit and gives its reason', () => {
    expect(noteFitDefaults({ fit: 'off', fit_reason: 'Not in weeks 5–8.' }, true)).toEqual({ keep: false, why: 'Not in weeks 5–8.', label: "Doesn't fit" })
  })
  it('keeps a class task ticked when it fits or the function sent no verdict', () => {
    expect(noteFitDefaults({ fit: 'fits' }, true)).toEqual({ keep: true, why: undefined, label: 'Fits' })
    // No verdict came back (an older function, or no brief to read): no label claims a check ran.
    expect(noteFitDefaults({}, true)).toEqual({ keep: true, why: undefined, label: null })
  })
  it('changes nothing on a work project', () => {
    expect(noteFitDefaults({ fit: 'off', fit_reason: 'x' }, false)).toEqual({ keep: true, why: undefined, label: null })
  })
})

describe('review fixes', () => {
  it('matches any copy of a set task, even one a group reworded', () => {
    const rows = [r('o1', 'b1', 'Write the proposal (ours)'), r('o1', 'b2', 'Write the proposal')]
    expect(alreadySetTitles(rows, 2, '').has('write the proposal')).toBe(true)
    expect(alreadySetTitles(rows, 2, 'b1').has('write the proposal')).toBe(true)
  })
  it('gives a task with no due date an empty one', () => {
    const [row] = fileRows([{ title: 'Build', details: '', weight: 1 } as FileTask], new Set())
    expect(row.due).toBe('')
  })
  it('re-derives a row nobody ticked when the target changes, and keeps a ticked one', () => {
    const start = fileRows([t('Write the proposal'), t('Make a TikTok page', 'off')], new Set(['write the proposal']))
    expect(start[0].keep).toBe(false)
    const back = retarget(start, new Set())
    expect(back[0]).toMatchObject({ already: false, keep: true })
    expect(back[1].keep).toBe(false)
    const touched = retarget([{ ...start[0], keep: true, touched: true }], new Set())
    expect(touched[0].keep).toBe(true)
    const untick = retarget([{ ...back[0], keep: false, touched: true }], new Set())
    expect(untick[0].keep).toBe(false)
  })
})
