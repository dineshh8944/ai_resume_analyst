// Local, instant keyword engine. Runs on every keystroke (no AI cost).

const STOP = new Set(`a about above across after all also an and any are as at be been being but by can could do does each etc for from had has have having he her his how i if in into is it its may more most must need new no not of on one only or other our out over own per such than that the their them then there these they this those through to under up us use using via was we well were what when where which while who will with within without would you your able ability strong good great plus preferred required requirements responsibilities experience years year work working team teams role job candidate looking join company including include includes etc knowledge familiarity understanding skills skill excellent proven demonstrated related relevant ideal best across both e.g i.e`.split(/\s+/))

// Common multi-word / punctuated terms that a plain tokenizer would break.
const PHRASES = [
  'machine learning', 'deep learning', 'data analysis', 'data science', 'data engineering', 'natural language processing',
  'rest api', 'rest apis', 'restful', 'ci/cd', 'unit testing', 'test driven development', 'object oriented', 'version control',
  'project management', 'stakeholder management', 'agile', 'scrum', 'problem solving', 'communication', 'leadership',
  'node.js', 'next.js', 'vue.js', 'react.js', 'express.js', 'c++', 'c#', '.net', 'asp.net', 'scikit-learn', 'power bi',
  'google cloud', 'amazon web services', 'microservices', 'cloud computing', 'system design', 'code review', 'customer success',
  'cross-functional', 'a/b testing', 'user research', 'product management', 'data visualization', 'etl', 'prompt engineering',
]
const TECH = ['python', 'java', 'javascript', 'typescript', 'react', 'angular', 'vue', 'svelte', 'django', 'flask', 'fastapi', 'spring',
  'sql', 'mysql', 'postgresql', 'postgres', 'mongodb', 'redis', 'kafka', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'github',
  'linux', 'html', 'css', 'sass', 'tailwind', 'graphql', 'api', 'apis', 'json', 'pytest', 'jest', 'pandas', 'numpy', 'tensorflow', 'pytorch',
  'llm', 'rag', 'nlp', 'excel', 'tableau', 'figma', 'jira', 'terraform', 'jenkins', 'golang', 'rust', 'php', 'swift', 'kotlin', 'ruby', 'scala', 'r',
  'seo', 'crm', 'salesforce', 'sap', 'devops', 'sre', 'saas', 'b2b', 'kpi', 'roi', 'ux', 'ui', 'ml', 'ai']

const ALIASES = {
  javascript: ['js'], typescript: ['ts'], postgresql: ['postgres'], 'node.js': ['nodejs', 'node js', 'node'],
  'rest api': ['rest apis', 'restful', 'rest'], 'machine learning': ['ml'], kubernetes: ['k8s'], 'amazon web services': ['aws'],
  aws: ['amazon web services'], 'react.js': ['react'], react: ['react.js', 'reactjs'], 'ci/cd': ['cicd', 'ci cd'], golang: ['go'],
  'google cloud': ['gcp'], gcp: ['google cloud'], ai: ['artificial intelligence'], 'natural language processing': ['nlp'],
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function normalizeKeyword(k) {
  return String(k || '').trim().replace(/\s+/g, ' ')
}

/** Build a regex that matches the keyword (and aliases / simple plurals) as a whole term. */
export function keywordRegex(keyword, aliases = []) {
  const k = normalizeKeyword(keyword).toLowerCase()
  const forms = new Set([k, ...(ALIASES[k] || []), ...aliases.map((a) => normalizeKeyword(a).toLowerCase())])
  const parts = []
  for (const f of forms) {
    if (!f) continue
    let p = esc(f).replace(/\s+/g, '[\\s\\-]+')
    if (/[a-z]$/.test(f) && f.length > 3) p += '(?:s|es|ed|ing)?'
    parts.push(p)
  }
  // Custom boundaries so c++, c#, .net, node.js work.
  return new RegExp(`(?<![A-Za-z0-9+#])(?:${parts.join('|')})(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, 'gi')
}

export function hasKeyword(text, keyword, aliases) {
  const re = keywordRegex(keyword, aliases)
  return re.test(text)
}

/** Offline keyword extraction from a job description, weighted by frequency + position. */
export function extractLocalKeywords(jd, max = 30) {
  const text = jd.toLowerCase()
  const found = new Map()
  const bump = (k, w) => found.set(k, (found.get(k) || 0) + w)

  for (const ph of PHRASES) {
    const n = (text.match(keywordRegex(ph)) || []).length
    if (n) bump(ph, 2 + n)
  }
  for (const t of TECH) {
    const n = (text.match(keywordRegex(t)) || []).length
    if (n) bump(t, 2 + n)
  }
  // Generic words that repeat (>=2) or sit in a requirements-ish line.
  const words = text.match(/[a-z][a-z+#.\-]{2,}/g) || []
  const freq = new Map()
  for (const w of words) {
    const c = w.replace(/[.\-]+$/, '')
    if (STOP.has(c) || c.length < 4) continue
    freq.set(c, (freq.get(c) || 0) + 1)
  }
  for (const [w, n] of freq) if (n >= 2 && !found.has(w) && ![...found.keys()].some((k) => k.includes(w))) bump(w, n)

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([keyword, w]) => ({ keyword, importance: w >= 5 ? 'high' : w >= 3 ? 'medium' : 'low', category: TECH.includes(keyword) ? 'technical' : 'general', aliases: [] }))
}

const WEIGHT = { high: 3, medium: 2, low: 1 }

/** Score a resume against a keyword list. Pure + fast, safe to call on every edit. */
export function matchResume(resumeText, keywords) {
  const results = keywords.map((kw) => {
    const re = keywordRegex(kw.keyword, kw.aliases)
    const count = (resumeText.match(re) || []).length
    return { ...kw, count, matched: count > 0 }
  })
  const total = results.reduce((s, r) => s + (WEIGHT[r.importance] || 1), 0)
  const got = results.reduce((s, r) => s + (r.matched ? WEIGHT[r.importance] || 1 : 0), 0)
  return { results, score: total ? Math.round((got / total) * 100) : 0, matched: results.filter((r) => r.matched), missing: results.filter((r) => !r.matched) }
}

/** Basic ATS-style hygiene checks on the resume text itself. */
export function structureChecks(text) {
  const t = text || ''
  const lower = t.toLowerCase()
  const words = (t.match(/\S+/g) || []).length
  const checks = [
    { id: 'email', ok: /[\w.+-]+@[\w-]+\.[\w.]+/.test(t), label: 'Contact email present' },
    { id: 'phone', ok: /(\+?\d[\d\s().-]{8,}\d)/.test(t), label: 'Phone number present' },
    { id: 'skills', ok: /\bskills\b/i.test(t), label: 'Has a Skills section' },
    { id: 'exp', ok: /\b(experience|employment|internship|projects?)\b/i.test(t), label: 'Has Experience / Projects' },
    { id: 'edu', ok: /\b(education|university|college|b\.?tech|b\.?sc|m\.?sc|degree)\b/i.test(lower), label: 'Has Education' },
    { id: 'numbers', ok: (t.match(/\b\d+(\.\d+)?\s?(%|x|k|m|\+)|\$\s?\d|₹\s?\d/gi) || []).length >= 2, label: 'Uses measurable results (%, $, numbers)' },
    { id: 'length', ok: words >= 200 && words <= 1000, label: `Length is reasonable (${words} words)` },
  ]
  return checks
}

/** Add a skill to the Skills section (or create one). Only call after the user confirms they have it. */
export function addSkillToResume(text, skill) {
  const lines = text.split('\n')
  const idx = lines.findIndex((l) => /^\s*(technical\s+)?skills?\b.*:?\s*$/i.test(l) || /^\s*(technical\s+)?skills?\s*[:\-–]/i.test(l))
  if (idx === -1) return `${text.replace(/\s+$/, '')}\n\nSKILLS\n${skill}\n`
  // "Skills: a, b, c" on one line
  if (/^\s*(technical\s+)?skills?\s*[:\-–]\s*\S/i.test(lines[idx])) {
    lines[idx] = `${lines[idx].replace(/[,\s]+$/, '')}, ${skill}`
    return lines.join('\n')
  }
  // Heading alone: append to the end of that block
  let end = idx + 1
  while (end < lines.length && lines[end].trim() !== '' ) end++
  if (end === idx + 1) { lines.splice(idx + 1, 0, skill); return lines.join('\n') }
  lines[end - 1] = `${lines[end - 1].replace(/[,\s]+$/, '')}, ${skill}`
  return lines.join('\n')
}
