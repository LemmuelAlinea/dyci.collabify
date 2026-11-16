import { describe, expect, it } from 'vitest'
import { pageAlignedSections } from '../../../supabase/functions/_shared/wordSections'

const para = (text: string, inner = '') => `<w:p><w:r>${inner}<w:t>${text}</w:t></w:r></w:p>`
const breakPara = (sect: string) => `<w:p><w:pPr>${sect}</w:pPr></w:p>`
const sect = (type: string | null, refs = '') =>
  `<w:sectPr>${refs}${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`
const header = '<w:headerReference w:type="default" r:id="rId9"/>'
const doc = (body: string) => `<w:document><w:body>${body}</w:body></w:document>`

describe('pageAlignedSections', () => {
  it('makes a continuous break a page break where Word started a page and the header changes', () => {
    const xml = doc(para('Front matter') + breakPara(sect(null)) + para('CHAPTER 1', '<w:lastRenderedPageBreak/>') + sect('continuous', header))
    const out = pageAlignedSections(xml)
    expect(out.changed).toBe(1)
    expect(out.xml).toContain('<w:type w:val="nextPage"/>')
    expect(out.xml).not.toContain('continuous')
  })

  it('also follows an explicit page break or page-break-before', () => {
    const explicit = doc(breakPara(sect(null)) + para('Next', '<w:br w:type="page"/>') + sect('continuous', header))
    const before = doc(breakPara(sect(null)) + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Next</w:t></w:r></w:p>' + sect('continuous', header))
    expect(pageAlignedSections(explicit).changed).toBe(1)
    expect(pageAlignedSections(before).changed).toBe(1)
  })

  it('leaves a break that falls mid-page, or that changes no header, footer or numbering', () => {
    const midPage = doc(breakPara(sect(null)) + para('Same page') + sect('continuous', header))
    const nothingNew = doc(breakPara(sect(null)) + para('CHAPTER 1', '<w:lastRenderedPageBreak/>') + sect('continuous'))
    expect(pageAlignedSections(midPage)).toEqual({ xml: midPage, changed: 0 })
    expect(pageAlignedSections(nothingNew)).toEqual({ xml: nothingNew, changed: 0 })
  })

  it('ignores a rendered page break that comes after the first text', () => {
    const xml = doc(breakPara(sect(null)) + `<w:p><w:r><w:t>Long</w:t><w:lastRenderedPageBreak/><w:t>paragraph</w:t></w:r></w:p>` + sect('continuous', header))
    expect(pageAlignedSections(xml).changed).toBe(0)
  })

  it('leaves a one-section file alone', () => {
    const xml = doc(para('Only') + sect(null, header))
    expect(pageAlignedSections(xml)).toEqual({ xml, changed: 0 })
  })
})
