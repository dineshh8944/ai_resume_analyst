import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, UploadCloud, FileText, BriefcaseBusiness, CheckCircle2, AlertCircle, Lightbulb, MessageSquareText,
  LoaderCircle, Download, Undo2, RotateCcw, Plus, Wand2, ChevronDown, Check, Circle, TrendingUp, Copy, Zap, History, Trash2,
  Key, Settings, X, Eye, EyeOff, ExternalLink,
} from 'lucide-react'
import {
  MODELS, PROVIDERS, analyzeWithAI, optimizeResume, errText,
  getStoredConfig, saveStoredConfig, resetStoredConfig, testProviderConnection,
} from './lib/ai.js'
import { backendHealth, saveVersion, listHistory, getVersion, deleteVersion } from './lib/api.js'
import { extractLocalKeywords, matchResume, keywordRegex, structureChecks, addSkillToResume } from './lib/keywords.js'
import { extractPdfText } from './lib/pdf.js'
import { downloadDocx, downloadPdf, downloadTxt } from './lib/exporters.js'

const SAMPLE_JOB = `Junior Python Developer
Responsibilities:
- Build Python backend services and REST APIs.
- Develop APIs using FastAPI or Flask.
- Work with MongoDB or SQL databases.
- Collaborate with frontend developers using React and JavaScript.
- Write readable, testable code and debug issues.
Requirements:
- Strong Python fundamentals.
- Knowledge of REST APIs and JSON.
- Familiarity with FastAPI, MongoDB, Git, and React is preferred.
- Personal projects or internship experience are welcome.`

const SAMPLE_RESUME = `Priya Sharma
priya.sharma@example.com | +91 98765 43210 | Bengaluru

SUMMARY
Computer science graduate who enjoys building web applications and learning new tools.

SKILLS
Python, JavaScript, HTML, CSS, Git

PROJECTS
Student portal
- Built a website where students can see their marks and attendance.
- Worked with a small team to add login and search features.

Expense tracker
- Made an app to track daily expenses using Python and a database.

EDUCATION
B.Tech in Computer Science, Anna University, 2025`

const LS = 'resume-ai:v2'
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }

/** Split text into plain / highlighted segments for the live editor overlay. */
function segments(text, keywords) {
  const ranges = []
  for (const k of keywords) {
    const re = keywordRegex(k.keyword, k.aliases)
    let m
    while ((m = re.exec(text))) { ranges.push([m.index, m.index + m[0].length]); if (m[0].length === 0) re.lastIndex++ }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const out = []; let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue
    if (s > pos) out.push({ t: text.slice(pos, s) })
    out.push({ t: text.slice(s, e), hit: true }); pos = e
  }
  if (pos < text.length) out.push({ t: text.slice(pos) })
  return out
}

export default function App() {
  const saved = useMemo(load, [])
  const [resume, setResume] = useState(saved.resume || '')
  const [job, setJob] = useState(saved.job || '')
  const [model, setModel] = useState(saved.model || MODELS[0].id)
  const [autoAI, setAutoAI] = useState(false)
  const [ai, setAi] = useState(null)
  const [aiStale, setAiStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [drag, setDrag] = useState(false)
  const [history, setHistory] = useState([])
  const [baseline, setBaseline] = useState(null)     // score when the session started
  const [original, setOriginal] = useState(saved.resume || '')
  const [exportOpen, setExportOpen] = useState(false)
  const [tab, setTab] = useState('optimize')
  const [toast, setToast] = useState('')
  const [opt, setOpt] = useState(null)               // auto-optimize result (preview before accepting)
  const [optBusy, setOptBusy] = useState(false)
  const [confirmed, setConfirmed] = useState([])     // missing keywords the user says they truly have
  const [backend, setBackend] = useState(null)       // /api/health payload, or null when no server
  const [hist, setHist] = useState([])
  const backdrop = useRef(null)
  const stamp = useRef(0)

  // API Settings Modal state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiConfig, setApiConfig] = useState(getStoredConfig)
  const [showKey, setShowKey] = useState({})
  const [testStatus, setTestStatus] = useState({})

  // ---- optional FastAPI/MongoDB backend: detect once, then load history
  useEffect(() => { backendHealth().then((h) => { setBackend(h); if (h) listHistory().then((r) => setHist(r?.items || [])) }) }, [])
  const refreshHistory = () => backend && listHistory().then((r) => setHist(r?.items || []))

  // ---- persistence (best effort)
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ resume, job, model })) } catch { /* private mode */ }
  }, [resume, job, model])

  // ---- live keyword matching (instant, no AI cost)
  const localKeywords = useMemo(() => (job.trim().length > 20 ? extractLocalKeywords(job) : []), [job])
  const keywords = ai?.keywords?.length ? ai.keywords : localKeywords
  const match = useMemo(() => matchResume(resume, keywords), [resume, keywords])
  const checks = useMemo(() => structureChecks(resume), [resume])
  const segs = useMemo(() => segments(resume, match.matched), [resume, match.matched])

  // baseline = first live score after both inputs exist, resets on "Reset"
  useEffect(() => {
    if (baseline === null && resume.trim() && keywords.length) setBaseline(match.score)
  }, [baseline, resume, keywords, match.score])

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  // ---- edits (tracked for undo)
  const commit = useCallback((next) => {
    setHistory((h) => [...h.slice(-30), resume])
    setResume(next)
  }, [resume])
  const undo = () => setHistory((h) => { if (!h.length) return h; setResume(h[h.length - 1]); return h.slice(0, -1) })

  function onEdit(v) {
    setResume(v)
    if (ai) setAiStale(true)
  }

  // ---- file handling
  async function handleFile(f) {
    setError('')
    if (!f) return
    try {
      let text
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        if (f.size > 10 * 1024 * 1024) throw new Error('PDF must be 10 MB or smaller.')
        text = await extractPdfText(f)
        if (text.length < 40) throw new Error('No readable text found. This looks like a scanned image - paste your resume text instead.')
      } else if (/\.(txt|md)$/i.test(f.name) || f.type.startsWith('text/')) {
        text = await f.text()
      } else throw new Error('Please upload a PDF or .txt file, or paste your resume text.')
      setFileName(f.name); setResume(text); setOriginal(text); setHistory([]); setAi(null); setAiStale(false); setBaseline(null)
    } catch (e) { setError(e.message || 'Could not read that file.') }
  }

  // ---- AI analysis
  async function runAI(silent = false) {
    if (resume.trim().length < 40) return setError('Add your resume first (upload a PDF or paste text).')
    if (job.trim().length < 30) return setError('Paste a job description (at least 30 characters).')
    setError(''); setBusy(true)
    const my = ++stamp.current
    try {
      const data = await analyzeWithAI(resume, job, model)
      if (my !== stamp.current) return
      setAi(data); setAiStale(false); setBaseline(null)
      if (data.used_model && data.used_model !== model) flash(`Used: ${data.used_model}`)
      if (!silent) { setTab('actions'); persist('AI analysis') }
    } catch (e) {
      if (my === stamp.current) setError(errText(e))
    } finally { if (my === stamp.current) setBusy(false) }
  }

  // ---- optional auto re-analysis after the user stops typing
  useEffect(() => {
    if (!autoAI || !aiStale || busy) return
    const t = setTimeout(() => runAI(true), 3500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAI, aiStale, resume, busy])

  // ---- save a version to the backend (no-op when the server isn't running)
  async function persist(note, text = resume, score = match.score) {
    if (!backend) return
    const r = await saveVersion({ resume_text: text, job_description: job, keyword_score: score, ai_score: ai?.match_score ?? null, missing_keywords: match.missing.map((k) => k.keyword), model, note, filename: fileName })
    if (r) refreshHistory()
  }

  // ---- auto-optimize: AI rewrites the resume to add keywords + refresh summary
  async function runOptimize() {
    if (resume.trim().length < 40) return setError('Add your resume first (upload a PDF or paste text).')
    if (job.trim().length < 30) return setError('Paste a job description (at least 30 characters).')
    if (!keywords.length) return setError('No keywords found yet. Paste a fuller job description.')
    setError(''); setOptBusy(true); setTab('optimize'); setOpt(null)
    try {
      const r = await optimizeResume(resume, job, model, keywords.map((k) => k.keyword), confirmed)
      const after = matchResume(r.optimized, keywords).score
      setOpt({ ...r, before: match.score, after })
      if (r.used_model && r.used_model !== model) flash(`Used: ${r.used_model}`)
    } catch (e) {
      setError(errText(e))
    } finally { setOptBusy(false) }
  }

  function acceptOpt() {
    commit(opt.optimized); setAiStale(!!ai); persist('Auto-optimized', opt.optimized, opt.after); setOpt(null); flash('Optimized resume applied - you can still edit or Undo')
  }
  const toggleConfirm = (k) => setConfirmed((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))
  async function restore(id) {
    const v = await getVersion(id)
    if (v?.resume_text) { commit(v.resume_text); if (v.job_description) setJob(v.job_description); flash('Version restored') }
  }
  async function removeVersion(id) { await deleteVersion(id); refreshHistory() }

  // ---- applying suggestions
  function applyRewrite(r) {
    if (r.original && resume.includes(r.original)) {
      commit(resume.replace(r.original, r.improved)); setAiStale(true); flash('Applied to your resume')
    } else {
      navigator.clipboard?.writeText(r.improved); flash('Original line not found - improved text copied')
    }
  }
  function addSkill(k) { commit(addSkillToResume(resume, k)); setAiStale(!!ai); flash(`Added "${k}" to Skills`) }
  function resetAll() { setResume(original); setHistory([]); setBaseline(null); setAiStale(!!ai) }

  // ---- API Settings handlers
  async function handleTestKey(providerId) {
    const key = providerId === 'groq' ? apiConfig.groqKey
      : providerId === 'gemini' ? apiConfig.geminiKey
      : apiConfig.openaiKey
    const modelId = providerId === 'groq' ? apiConfig.groqModel
      : providerId === 'gemini' ? apiConfig.geminiModel
      : apiConfig.openaiModel

    setTestStatus((s) => ({ ...s, [providerId]: { loading: true } }))
    const res = await testProviderConnection(providerId, key, modelId)
    setTestStatus((s) => ({
      ...s,
      [providerId]: { loading: false, ok: res.success, message: res.success ? res.message : res.error },
    }))
  }

  function handleSaveSettings() {
    saveStoredConfig(apiConfig)
    setSettingsOpen(false)
    flash('API settings & keys saved')
  }

  function handleResetSettings() {
    const def = resetStoredConfig()
    setApiConfig(def)
    setTestStatus({})
    flash('Reset to defaults')
  }

  const activeProviderLabel = useMemo(() => {
    if (model.startsWith('groq:')) return 'Groq'
    if (model.startsWith('gemini:')) return 'Gemini'
    if (model.startsWith('openai:')) return 'OpenAI'
    if (apiConfig.provider === 'groq') return 'Groq'
    if (apiConfig.provider === 'gemini') return 'Gemini'
    if (apiConfig.provider === 'openai') return 'OpenAI'
    return 'Auto API'
  }, [model, apiConfig.provider])

  const delta = baseline === null ? 0 : match.score - baseline
  const ready = resume.trim() && job.trim().length > 20
  const fileBase = (fileName.replace(/\.[^.]+$/, '') || 'resume') + '-tailored'
  const priorityKeywords = match.missing.filter((k) => k.importance === 'high')

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-icon"><Sparkles size={19} /></span>ResumeMatch <b>AI</b></a>
        <div className="top-right">
          <label className="model-pick">
            <span>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="AI model">
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button className="badge-btn" onClick={() => setSettingsOpen(true)} title="Configure Groq, Gemini & OpenAI API Keys">
            <span className="dot" />
            <span>{activeProviderLabel}</span>
            <Settings size={13} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <span className="eyebrow"><Sparkles size={14} /> LIVE RESUME TAILORING</span>
          <h1>Edit your resume.<br /><em>Watch the match update.</em></h1>
          <p>Upload your resume, paste a job description, and get keyword gaps plus AI rewrites. Powered directly by your Groq, Gemini, or OpenAI API keys.</p>
        </section>

        <section className="workspace">
          {/* ---------- LEFT: inputs / editor ---------- */}
          <div className="col-left">
            <div className="panel">
              <div className="panel-head">
                <h2><FileText size={17} /> Your resume {fileName && <small className="muted">{fileName}</small>}</h2>
                <div className="row-gap">
                  <label className="btn ghost small">
                    <UploadCloud size={15} /> Upload PDF
                    <input type="file" hidden accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  <button className="btn ghost small" onClick={() => { setResume(SAMPLE_RESUME); setOriginal(SAMPLE_RESUME); setJob((j) => j || SAMPLE_JOB); setFileName(''); setHistory([]); setAi(null); setBaseline(null) }}>Try sample</button>
                </div>
              </div>

              <div className={`editor ${drag ? 'drag' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]) }}>
                <div className="backdrop" ref={backdrop} aria-hidden="true">
                  {segs.map((s, i) => s.hit ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>)}{'\n'}
                </div>
                <textarea
                  value={resume} spellCheck={false}
                  placeholder={'Drop a PDF here, click "Upload PDF", or paste your resume text...\n\nEdit freely - matched keywords highlight in green and the score updates instantly.'}
                  onChange={(e) => onEdit(e.target.value)}
                  onScroll={(e) => { if (backdrop.current) { backdrop.current.scrollTop = e.target.scrollTop; backdrop.current.scrollLeft = e.target.scrollLeft } }}
                />
              </div>
              <div className="editor-foot">
                <span className="muted">{(resume.match(/\S+/g) || []).length} words &middot; green = keyword found</span>
                <div className="row-gap">
                  <button className="btn ghost small" onClick={undo} disabled={!history.length}><Undo2 size={14} /> Undo</button>
                  <button className="btn ghost small" onClick={resetAll} disabled={resume === original}><RotateCcw size={14} /> Reset</button>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2><BriefcaseBusiness size={17} /> Job description</h2>
                <button className="btn ghost small" onClick={() => setJob(SAMPLE_JOB)}>Use sample</button>
              </div>
              <textarea className="plain" rows={9} value={job} onChange={(e) => { setJob(e.target.value); if (ai) setAiStale(true) }}
                placeholder="Paste the full job posting: title, responsibilities, requirements..." />
              <div className="editor-foot"><span className="muted">{job.length} characters</span></div>
            </div>
          </div>

          {/* ---------- RIGHT: live results ---------- */}
          <aside className="col-right">
            <div className="panel score-panel">
              <div className="ring" style={{ '--score': `${match.score}%` }}>
                <div><strong>{ready ? match.score : '--'}<small>%</small></strong><span>keyword match</span></div>
              </div>
              <div className="score-info">
                <span className="kicker"><TrendingUp size={14} /> LIVE SCORE</span>
                <h3>{!ready ? 'Add resume + job to start' : match.score >= 75 ? 'Strong keyword coverage' : match.score >= 50 ? 'Decent overlap, gaps remain' : 'Big keyword gaps to close'}</h3>
                {ready && <p className="muted">{match.matched.length} of {keywords.length} keywords found
                  {delta !== 0 && <b className={delta > 0 ? 'up' : 'down'}> &middot; {delta > 0 ? '+' : ''}{delta} since you started</b>}</p>}
                {ai && <p className="muted small-text">AI estimate: <b>{ai.match_score}%</b> at last analysis{aiStale && ' (resume changed since)'}</p>}
              </div>
            </div>

            <div className="actions-bar">
              <button className="btn primary" onClick={() => runAI(false)} disabled={busy || !ready}>
                {busy ? <><LoaderCircle className="spin" size={17} /> Analyzing with AI...</> : <><Sparkles size={17} /> {ai ? 'Re-run AI analysis' : 'Analyze with AI'}</>}
              </button>
              <div className="dl">
                <button className="btn dark" disabled={!resume.trim()} onClick={() => setExportOpen((o) => !o)}><Download size={16} /> Download <ChevronDown size={14} /></button>
                {exportOpen && (
                  <div className="menu" onMouseLeave={() => setExportOpen(false)}>
                    <button onClick={() => { downloadDocx(resume, fileBase); setExportOpen(false) }}>Word (.docx)</button>
                    <button onClick={() => { downloadPdf(resume, fileBase); setExportOpen(false) }}>PDF (.pdf)</button>
                    <button onClick={() => { downloadTxt(resume, fileBase); setExportOpen(false) }}>Plain text (.txt)</button>
                  </div>
                )}
              </div>
            </div>
            <button className="btn optimize" onClick={runOptimize} disabled={optBusy || !ready}>
              {optBusy ? <><LoaderCircle className="spin" size={17} /> Rewriting your resume...</> : <><Zap size={17} /> Auto-optimize my resume for this job</>}
            </button>
            <label className="auto">
              <input type="checkbox" checked={autoAI} onChange={(e) => setAutoAI(e.target.checked)} />
              Auto re-run AI a few seconds after I stop typing <span className="muted">(uses your API quota)</span>
            </label>
            {(!apiConfig.groqKey && !apiConfig.geminiKey && !apiConfig.openaiKey) && (
              <div className="notice">
                <Key size={15} /> No API keys set. Click <button className="text-link" onClick={() => setSettingsOpen(true)}>API Settings</button> to configure Groq, Gemini, or OpenAI.
              </div>
            )}
            {error && <div className="error"><AlertCircle size={16} />{error}</div>}
            {aiStale && !busy && ai && <div className="notice"><AlertCircle size={15} /> You&rsquo;ve edited since the last AI run. Keyword score is live; re-run AI for fresh advice.</div>}

            <div className="tabs" role="tablist">
              {[['optimize', 'Auto-optimize'], ['keywords', 'Keywords'], ['actions', 'What to change'], ['rewrites', `Rewrites${ai?.rewrites?.length ? ` (${ai.rewrites.length})` : ''}`], ['more', 'Checks & interview'], ...(backend ? [['history', `History (${hist.length})`]] : [])].map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
              ))}
            </div>

            {tab === 'optimize' && (
              <div className="panel">
                {optBusy && <p className="muted"><LoaderCircle className="spin" size={14} /> The AI is rewriting your summary, skills and bullets...</p>}
                {!optBusy && !opt && (
                  <>
                    <p className="summary">One click rewrites your resume for this job: a targeted summary, an updated Skills section and keyword-rich bullets, using only facts already in your resume.</p>
                    {match.missing.length > 0 && <>
                      <h3 className="sub"><AlertCircle size={16} /> Which of these missing keywords do you genuinely have?</h3>
                      <p className="muted small-text">Ticked skills are added to your resume. Unticked ones are only added if your resume already shows that skill. Never tick something you can&rsquo;t speak to in an interview.</p>
                      <div className="chips pick">
                        {match.missing.map((k) => (
                          <button key={k.keyword} className={`pickchip ${confirmed.includes(k.keyword) ? 'on' : ''}`} onClick={() => toggleConfirm(k.keyword)} aria-pressed={confirmed.includes(k.keyword)}>
                            {confirmed.includes(k.keyword) ? <Check size={12} /> : <Plus size={12} />} {k.keyword}
                          </button>
                        ))}
                      </div>
                      <button className="text-link" onClick={() => setConfirmed(confirmed.length === match.missing.length ? [] : match.missing.map((k) => k.keyword))}>{confirmed.length === match.missing.length ? 'Clear all' : 'I have all of these'}</button>
                    </>}
                    <button className="btn optimize" style={{ marginTop: 14, width: '100%' }} onClick={runOptimize} disabled={!ready}><Zap size={16} /> Auto-optimize now</button>
                  </>
                )}
                {opt && (
                  <>
                    <div className="beforeafter"><div><small>Before</small><b>{opt.before}%</b></div><span>&rarr;</span><div className="after"><small>After</small><b>{opt.after}%</b></div></div>
                    {opt.changes.length > 0 && <ul className="plain-list">{opt.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                    {opt.keywords_added.length > 0 && <><h3 className="sub ok"><CheckCircle2 size={16} /> Keywords added</h3><div className="chips">{opt.keywords_added.map((k) => <span className="chip" key={k}>+ {k}</span>)}</div></>}
                    {opt.keywords_not_added.length > 0 && <><h3 className="sub"><AlertCircle size={16} /> Not added (no evidence in your resume)</h3><ul className="plain-list">{opt.keywords_not_added.map((k) => <li key={k.keyword}><b>{k.keyword}</b>{k.reason && <> &ndash; {k.reason}</>}</li>)}</ul></>}
                    {opt.newNumbers.length > 0 && <div className="notice" style={{ marginTop: 10 }}><AlertCircle size={15} /><span>New numbers appeared that weren&rsquo;t in your original: <b>{opt.newNumbers.join(', ')}</b>. Check they&rsquo;re true or remove them.</span></div>}
                    <h3 className="sub" style={{ color: 'var(--ink)' }}>Preview</h3>
                    <pre className="preview">{opt.optimized}</pre>
                    <div className="row-gap" style={{ marginTop: 12 }}>
                      <button className="btn primary" onClick={acceptOpt}><Check size={16} /> Use this version</button>
                      <button className="btn ghost" onClick={() => setOpt(null)}>Discard</button>
                      <button className="btn ghost" onClick={runOptimize}><RotateCcw size={14} /> Try again</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'history' && backend && (
              <div className="panel">
                <p className="muted small-text" style={{ marginTop: 0 }}>Saved in {backend.storage === 'mongodb' ? 'MongoDB' : 'server memory (set MONGODB_URI to keep it permanently)'}.</p>
                {!hist.length && <p className="muted">No saved versions yet. Versions save automatically after an AI analysis or when you accept an optimized resume.</p>}
                <ul className="kw-list">
                  {hist.map((h) => (
                    <li key={h.id} className="kw">
                      <span className="kw-name">{h.note || 'Version'}<br /><small className="muted">{new Date(h.created_at).toLocaleString()} &middot; keyword score {h.keyword_score}%</small></span>
                      <button className="btn ghost tiny" onClick={() => restore(h.id)}>Restore</button>
                      <button className="btn ghost tiny" aria-label="Delete version" onClick={() => removeVersion(h.id)}><Trash2 size={12} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'keywords' && (
              <div className="panel">
                {!keywords.length ? <p className="muted">Paste a job description to see the keywords it asks for.</p> : <>
                  <h3 className="sub"><AlertCircle size={16} /> Missing from your resume ({match.missing.length})</h3>
                  {match.missing.length === 0 && <p className="muted">Nothing missing - every keyword is covered.</p>}
                  <ul className="kw-list">
                    {match.missing.map((k) => (
                      <li key={k.keyword} className={`kw miss ${k.importance}`}>
                        <span className="kw-name">{k.keyword}</span><span className="tag">{k.importance}</span>
                        <button className="btn ghost tiny" title="Only click if you genuinely have this skill" onClick={() => addSkill(k.keyword)}><Plus size={12} /> I have this</button>
                      </li>
                    ))}
                  </ul>
                  <h3 className="sub ok"><CheckCircle2 size={16} /> Found ({match.matched.length})</h3>
                  <div className="chips">{match.matched.map((k) => <span className="chip" key={k.keyword}><Check size={11} /> {k.keyword}{k.count > 1 && <em>&times;{k.count}</em>}</span>)}</div>
                  <p className="muted small-text">{ai ? 'Keywords extracted by AI from the job description.' : 'Keywords extracted offline. Run the AI analysis for smarter, role-specific keywords.'} Only add skills you truly have.</p>
                </>}
              </div>
            )}

            {tab === 'actions' && (
              <div className="panel">
                {!ai ? (
                  <>
                    <p className="muted">Quick wins from the live keyword check{ai ? '' : ' (run AI analysis for detailed advice)'}:</p>
                    <ul className="todo">
                      {priorityKeywords.slice(0, 6).map((k) => <li key={k.keyword}><Circle size={13} /> Mention <b>{k.keyword}</b> if you have used it - in Skills and a project bullet.</li>)}
                      {!priorityKeywords.length && <li><Check size={13} /> No high-importance keywords missing.</li>}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="summary">{ai.summary}</p>
                    <ol className="recs">
                      {ai.recommendations.map((r, i) => (
                        <li key={i} className={r.priority}><span className="tag">{r.priority}</span><b>{r.title}</b>{r.detail && <p>{r.detail}</p>}</li>
                      ))}
                    </ol>
                    {ai.strengths.length > 0 && <><h3 className="sub ok"><Sparkles size={16} /> Strengths</h3><ul className="plain-list">{ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
                  </>
                )}
              </div>
            )}

            {tab === 'rewrites' && (
              <div className="panel">
                {!ai?.rewrites?.length ? <p className="muted">{ai ? 'The AI had no line-level rewrites for this resume.' : 'Run the AI analysis to get line-by-line rewrites you can apply with one click.'}</p> :
                  ai.rewrites.map((r, i) => {
                    const present = r.original && resume.includes(r.original)
                    return (
                      <div className="rewrite" key={i}>
                        <div className="rw-head"><b>{r.section || 'Resume'}</b>{r.keywords_added.map((k) => <span className="chip" key={k}>+ {k}</span>)}</div>
                        {r.original && <p className="was">{r.original}</p>}
                        <p className="now">{r.improved}</p>
                        <p className="muted small-text">{r.reason}</p>
                        <p className="muted small-text">Replace any [placeholders] with your real numbers before downloading.</p>
                        <div className="row-gap">
                          <button className="btn primary small" onClick={() => applyRewrite(r)}><Wand2 size={14} /> {present ? 'Apply to resume' : 'Copy improved text'}</button>
                          <button className="btn ghost small" onClick={() => { navigator.clipboard?.writeText(r.improved); flash('Copied') }}><Copy size={13} /> Copy</button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}

            {tab === 'more' && (
              <div className="panel">
                <h3 className="sub"><Lightbulb size={16} /> ATS format checks</h3>
                <ul className="todo">{checks.map((c) => <li key={c.id} className={c.ok ? 'pass' : 'fail'}>{c.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {c.label}</li>)}</ul>
                <h3 className="sub"><MessageSquareText size={16} /> Interview practice</h3>
                {ai?.interview_questions?.length ? <ul className="plain-list">{ai.interview_questions.map((q, i) => <li key={i}>{q}</li>)}</ul> : <p className="muted">Run the AI analysis to get likely interview questions.</p>}
              </div>
            )}

            <p className="disclaimer">Scores are estimates of keyword alignment, not hiring predictions. Only add skills and results that are true, and review every AI suggestion before sending your resume.</p>
          </aside>
        </section>
      </main>

      {/* ---------- API Settings Modal ---------- */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2><Key size={18} /> API Keys &amp; Models</h2>
              <button className="btn-icon" onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>

            <div className="modal-body">
              <div>
                <label className="field-label">Active Provider Strategy</label>
                <div className="radio-group">
                  {[
                    ['auto', 'Auto (Best)'],
                    ['groq', 'Groq'],
                    ['gemini', 'Gemini'],
                    ['openai', 'OpenAI'],
                  ].map(([pId, label]) => (
                    <button
                      key={pId}
                      type="button"
                      className={`radio-pill ${apiConfig.provider === pId ? 'selected' : ''}`}
                      onClick={() => setApiConfig((c) => ({ ...c, provider: pId }))}
                    >
                      {apiConfig.provider === pId && <Check size={14} />} {label}
                    </button>
                  ))}
                </div>
                <p className="muted small-text">Auto automatically tries the fastest working API (Groq &rarr; Gemini &rarr; OpenAI) with seamless fallback.</p>
              </div>

              {/* GROQ */}
              <div className={`provider-card ${apiConfig.provider === 'groq' ? 'active-target' : ''}`}>
                <div className="provider-header">
                  <div className="provider-title">
                    <span>Groq</span>
                    <span className="provider-tag free">Ultra Fast / Free Tier</span>
                  </div>
                  <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-link" style={{ padding: 0 }}>
                    Get Groq Key <ExternalLink size={12} />
                  </a>
                </div>

                <div>
                  <div className="field-label">API Key</div>
                  <div className="input-with-action">
                    <input
                      type={showKey.groq ? 'text' : 'password'}
                      placeholder="gsk_..."
                      value={apiConfig.groqKey}
                      onChange={(e) => setApiConfig((c) => ({ ...c, groqKey: e.target.value }))}
                    />
                    <button type="button" className="input-action-btn" onClick={() => setShowKey((s) => ({ ...s, groq: !s.groq }))}>
                      {showKey.groq ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="field-label">Model</div>
                  <select
                    className="select-clean"
                    value={apiConfig.groqModel}
                    onChange={(e) => setApiConfig((c) => ({ ...c, groqModel: e.target.value }))}
                  >
                    {PROVIDERS.groq.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} ({m.note})</option>
                    ))}
                  </select>
                </div>

                <div className="test-row">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => handleTestKey('groq')}
                    disabled={testStatus.groq?.loading || !apiConfig.groqKey}
                  >
                    {testStatus.groq?.loading ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Test Groq
                  </button>
                  {testStatus.groq && !testStatus.groq.loading && (
                    <span className={`test-feedback ${testStatus.groq.ok ? 'ok' : 'err'}`}>
                      {testStatus.groq.ok ? '✓ Working!' : `✗ ${testStatus.groq.message}`}
                    </span>
                  )}
                </div>
              </div>

              {/* GEMINI */}
              <div className={`provider-card ${apiConfig.provider === 'gemini' ? 'active-target' : ''}`}>
                <div className="provider-header">
                  <div className="provider-title">
                    <span>Google Gemini</span>
                    <span className="provider-tag free">High Quality / AI Studio</span>
                  </div>
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-link" style={{ padding: 0 }}>
                    Get Gemini Key <ExternalLink size={12} />
                  </a>
                </div>

                <div>
                  <div className="field-label">API Key</div>
                  <div className="input-with-action">
                    <input
                      type={showKey.gemini ? 'text' : 'password'}
                      placeholder="AIzaSy... or AQ..."
                      value={apiConfig.geminiKey}
                      onChange={(e) => setApiConfig((c) => ({ ...c, geminiKey: e.target.value }))}
                    />
                    <button type="button" className="input-action-btn" onClick={() => setShowKey((s) => ({ ...s, gemini: !s.gemini }))}>
                      {showKey.gemini ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="field-label">Model</div>
                  <select
                    className="select-clean"
                    value={apiConfig.geminiModel}
                    onChange={(e) => setApiConfig((c) => ({ ...c, geminiModel: e.target.value }))}
                  >
                    {PROVIDERS.gemini.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} ({m.note})</option>
                    ))}
                  </select>
                </div>

                <div className="test-row">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => handleTestKey('gemini')}
                    disabled={testStatus.gemini?.loading || !apiConfig.geminiKey}
                  >
                    {testStatus.gemini?.loading ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Test Gemini
                  </button>
                  {testStatus.gemini && !testStatus.gemini.loading && (
                    <span className={`test-feedback ${testStatus.gemini.ok ? 'ok' : 'err'}`}>
                      {testStatus.gemini.ok ? '✓ Working!' : `✗ ${testStatus.gemini.message}`}
                    </span>
                  )}
                </div>
              </div>

              {/* OPENAI */}
              <div className={`provider-card ${apiConfig.provider === 'openai' ? 'active-target' : ''}`}>
                <div className="provider-header">
                  <div className="provider-title">
                    <span>OpenAI</span>
                    <span className="provider-tag paid">Paid / Requires Credit</span>
                  </div>
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-link" style={{ padding: 0 }}>
                    Get OpenAI Key <ExternalLink size={12} />
                  </a>
                </div>

                <div>
                  <div className="field-label">API Key</div>
                  <div className="input-with-action">
                    <input
                      type={showKey.openai ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={apiConfig.openaiKey}
                      onChange={(e) => setApiConfig((c) => ({ ...c, openaiKey: e.target.value }))}
                    />
                    <button type="button" className="input-action-btn" onClick={() => setShowKey((s) => ({ ...s, openai: !s.openai }))}>
                      {showKey.openai ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="field-label">Model</div>
                  <select
                    className="select-clean"
                    value={apiConfig.openaiModel}
                    onChange={(e) => setApiConfig((c) => ({ ...c, openaiModel: e.target.value }))}
                  >
                    {PROVIDERS.openai.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} ({m.note})</option>
                    ))}
                  </select>
                </div>

                <div className="test-row">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => handleTestKey('openai')}
                    disabled={testStatus.openai?.loading || !apiConfig.openaiKey}
                  >
                    {testStatus.openai?.loading ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Test OpenAI
                  </button>
                  {testStatus.openai && !testStatus.openai.loading && (
                    <span className={`test-feedback ${testStatus.openai.ok ? 'ok' : 'err'}`}>
                      {testStatus.openai.ok ? '✓ Working!' : `✗ ${testStatus.openai.message}`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn ghost small" onClick={handleResetSettings}>
                Reset to Defaults
              </button>
              <div className="row-gap">
                <button type="button" className="btn ghost small" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn primary small" onClick={handleSaveSettings}>
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
      <footer><span>ResumeMatch AI</span><span>React &middot; Groq, Gemini &amp; OpenAI Direct APIs &middot; Fully client-side</span></footer>
    </div>
  )
}
