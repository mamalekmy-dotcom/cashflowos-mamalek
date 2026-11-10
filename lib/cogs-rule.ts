// What counts as COGS in Stock 2026: food ingredients, ice and takeaway packaging, and
// gas (Eric, 10 Nov 2026). The rest of the sheet's OTHERS section (detergent, gloves,
// tissue) is an expense on the Management Report instead.
export const inCogs = (section: string, item = '') => !/OTHERS/i.test(section) || /\bGAS\b/i.test(item)
