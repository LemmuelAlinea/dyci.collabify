export type StageTerms = { singular: string; plural: string }

export const DEFAULT_STAGE_TERMS: StageTerms = { singular: 'Stage', plural: 'Stages' }

export function stageText(copy: string, terms: StageTerms = DEFAULT_STAGE_TERMS): string {
  return copy.replace(/\bsprints?\b(?!\s*#?\d)/gi, (word) => {
    const name = word.toLowerCase() === 'sprints' ? terms.plural : terms.singular
    return word[0] === word[0].toUpperCase() ? name : name[0].toLowerCase() + name.slice(1)
  })
}

export function validStageTerms(terms: StageTerms): boolean {
  return [terms.singular, terms.plural].every((name) =>
    name.trim() === name && name.length >= 1 && name.length <= 24 && /^[\p{L}][\p{L} -]*$/u.test(name))
}
