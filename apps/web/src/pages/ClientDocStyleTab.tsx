import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'

const FONTS = ['Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Garamond', 'Verdana', 'Helvetica']

interface DocStyle {
  logoStorageKey: string | null
  primaryColor: string | null
  secondaryColor: string | null
  headingFont: string | null
  bodyFont: string | null
  agencyName: string | null
  coverPage: boolean | null
  pageNumbers: boolean | null
  footerText: string | null
  applyToGtm: boolean | null
  applyToDemandGen: boolean | null
  applyToBranding: boolean | null
}

interface MergedDocStyle {
  logoStorageKey: string | null
  primaryColor: string
  secondaryColor: string
  headingFont: string
  bodyFont: string
  agencyName: string | null
  coverPage: boolean
  pageNumbers: boolean
  footerText: string | null
  applyToGtm: boolean
  applyToDemandGen: boolean
  applyToBranding: boolean
}

interface Form {
  primaryColor: string
  secondaryColor: string
  headingFont: string
  bodyFont: string
  agencyName: string
  coverPage: boolean
  pageNumbers: boolean
  footerText: string
  applyToGtm: boolean
  applyToDemandGen: boolean
  applyToBranding: boolean
  // nulls mean "use agency default" — tracked separately
  overridePrimary: boolean
  overrideSecondary: boolean
  overrideHeadingFont: boolean
  overrideBodyFont: boolean
  overrideCoverPage: boolean
  overridePageNumbers: boolean
}

export function ClientDocStyleTab({ clientId }: { clientId: string }) {
  const [merged, setMerged] = useState<MergedDocStyle | null>(null)
  const [form, setForm] = useState<Form>({
    primaryColor: '#1B1F3B',
    secondaryColor: '#4A90D9',
    headingFont: 'Calibri',
    bodyFont: 'Calibri',
    agencyName: '',
    coverPage: true,
    pageNumbers: true,
    footerText: '',
    applyToGtm: true,
    applyToDemandGen: false,
    applyToBranding: false,
    overridePrimary: false,
    overrideSecondary: false,
    overrideHeadingFont: false,
    overrideBodyFont: false,
    overrideCoverPage: false,
    overridePageNumbers: false,
  })
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [overrideLogo, setOverrideLogo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/v1/clients/${clientId}/doc-style`).then((r) => r.json()),
      apiFetch(`/api/v1/clients/${clientId}/doc-style/merged`).then((r) => r.json()),
    ]).then(([clientRes, mergedRes]) => {
      const clientStyle: DocStyle | null = clientRes.data
      const mergedStyle: MergedDocStyle = mergedRes.data
      setMerged(mergedStyle)

      if (clientStyle) {
        setForm({
          primaryColor: clientStyle.primaryColor ?? mergedStyle.primaryColor,
          secondaryColor: clientStyle.secondaryColor ?? mergedStyle.secondaryColor,
          headingFont: clientStyle.headingFont ?? mergedStyle.headingFont,
          bodyFont: clientStyle.bodyFont ?? mergedStyle.bodyFont,
          agencyName: clientStyle.agencyName ?? mergedStyle.agencyName ?? '',
          coverPage: clientStyle.coverPage ?? mergedStyle.coverPage,
          pageNumbers: clientStyle.pageNumbers ?? mergedStyle.pageNumbers,
          footerText: clientStyle.footerText ?? mergedStyle.footerText ?? '',
          applyToGtm: clientStyle.applyToGtm ?? mergedStyle.applyToGtm,
          applyToDemandGen: clientStyle.applyToDemandGen ?? mergedStyle.applyToDemandGen,
          applyToBranding: clientStyle.applyToBranding ?? mergedStyle.applyToBranding,
          overridePrimary: clientStyle.primaryColor !== null,
          overrideSecondary: clientStyle.secondaryColor !== null,
          overrideHeadingFont: clientStyle.headingFont !== null,
          overrideBodyFont: clientStyle.bodyFont !== null,
          overrideCoverPage: clientStyle.coverPage !== null,
          overridePageNumbers: clientStyle.pageNumbers !== null,
        })
        if (clientStyle.logoStorageKey) {
          setLogoPreview(clientStyle.logoStorageKey)
          setOverrideLogo(true)
        }
      } else {
        // no override yet — pre-fill from merged as display values
        setForm((f) => ({
          ...f,
          primaryColor: mergedStyle.primaryColor,
          secondaryColor: mergedStyle.secondaryColor,
          headingFont: mergedStyle.headingFont,
          bodyFont: mergedStyle.bodyFont,
          agencyName: mergedStyle.agencyName ?? '',
          coverPage: mergedStyle.coverPage,
          pageNumbers: mergedStyle.pageNumbers,
          footerText: mergedStyle.footerText ?? '',
          applyToGtm: mergedStyle.applyToGtm,
          applyToDemandGen: mergedStyle.applyToDemandGen,
          applyToBranding: mergedStyle.applyToBranding,
        }))
        if (mergedStyle.logoStorageKey) setLogoPreview(mergedStyle.logoStorageKey)
      }
    }).catch(() => {})
  }, [clientId])

  const set = (key: keyof Form, val: unknown) => setForm((f) => ({ ...f, [key]: val }))

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        // applyTo always saved (no override toggle for these)
        applyToGtm: form.applyToGtm,
        applyToDemandGen: form.applyToDemandGen,
        applyToBranding: form.applyToBranding,
        agencyName: form.agencyName || null,
        footerText: form.footerText || null,
        // Fields with override toggles: send value if override is on, null to clear override
        primaryColor: form.overridePrimary ? form.primaryColor : null,
        secondaryColor: form.overrideSecondary ? form.secondaryColor : null,
        headingFont: form.overrideHeadingFont ? form.headingFont : null,
        bodyFont: form.overrideBodyFont ? form.bodyFont : null,
        coverPage: form.overrideCoverPage ? form.coverPage : null,
        pageNumbers: form.overridePageNumbers ? form.pageNumbers : null,
      }
      await apiFetch(`/api/v1/clients/${clientId}/doc-style`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }, [clientId, form])

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch(`/api/v1/clients/${clientId}/doc-style/logo`, { method: 'POST', body: fd })
      if (res.ok) {
        const reader = new FileReader()
        reader.onload = (e) => {
          setLogoPreview(e.target?.result as string)
          setOverrideLogo(true)
        }
        reader.readAsDataURL(file)
      }
    } finally { setUploadingLogo(false) }
  }

  const removeLogo = async () => {
    await apiFetch(`/api/v1/clients/${clientId}/doc-style/logo`, { method: 'DELETE' })
    setLogoPreview(merged?.logoStorageKey ?? null)
    setOverrideLogo(false)
  }

  const OverrideToggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-1.5 text-[11px] mb-1.5 transition-colors"
      style={{ color: checked ? '#a200ee' : '#b4b2a9' }}
    >
      <span className="relative inline-flex h-4 w-7 rounded-full transition-colors" style={{ backgroundColor: checked ? '#a200ee' : '#d1d5db' }}>
        <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(13px)' : 'translateX(2px)' }} />
      </span>
      {label}
    </button>
  )

  return (
    <div className="p-6 space-y-6" style={{ maxWidth: 580 }}>
      <div>
        <h2 className="text-[15px] font-semibold mb-1" style={{ color: '#1a1a14' }}>Doc Style Override</h2>
        <p className="text-[13px]" style={{ color: '#b4b2a9' }}>
          Override the agency-wide DOCX template for this client. Fields left on "use default" will inherit the agency settings.
        </p>
      </div>

      <div className="rounded-xl p-5 space-y-5" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>

        {/* Header with save */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>GTM Framework Template</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#a200ee' }}
          >
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Icons.Check className="h-3 w-3" /> : <Icons.Save className="h-3 w-3" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* Apply to */}
        <div>
          <p className="text-[12px] font-medium mb-2" style={{ color: '#6b7280' }}>Apply template to</p>
          <div className="flex flex-wrap gap-2">
            {([
              ['applyToGtm', 'GTM Framework'],
              ['applyToDemandGen', 'Demand Gen'],
              ['applyToBranding', 'Branding'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => set(key, !form[key])}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
                style={form[key]
                  ? { backgroundColor: '#fdf5ff', border: '1px solid #a200ee', color: '#7a00b4' }
                  : { backgroundColor: '#fafaf8', border: '1px solid #e8e7e1', color: '#6b7280' }}
              >
                {form[key] && <Icons.Check className="h-3 w-3" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Logo */}
        <div>
          <p className="text-[12px] font-medium mb-1" style={{ color: '#6b7280' }}>Logo</p>
          {overrideLogo && logoPreview ? (
            <div className="flex items-center gap-3">
              <img src={logoPreview} alt="Client doc logo" className="h-10 object-contain rounded border border-border" style={{ maxWidth: 160 }} />
              <button onClick={removeLogo} className="text-[11px] text-red-500 hover:text-red-700">Remove override</button>
            </div>
          ) : (
            <div className="space-y-1">
              {logoPreview && (
                <div className="flex items-center gap-2 mb-2">
                  <img src={logoPreview} alt="Agency logo (default)" className="h-8 object-contain rounded border border-border opacity-50" style={{ maxWidth: 120 }} />
                  <span className="text-[11px]" style={{ color: '#b4b2a9' }}>Agency default</span>
                </div>
              )}
              <button
                onClick={() => logoRef.current?.click()}
                disabled={uploadingLogo}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors"
                style={{ border: '1px dashed #d1d5db', color: '#6b7280', backgroundColor: '#fafaf8' }}
              >
                {uploadingLogo ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Upload className="h-3.5 w-3.5" />}
                Upload client logo override (JPG, PNG, SVG — max 5 MB)
              </button>
            </div>
          )}
          <input ref={logoRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.svg"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = '' }} />
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-4">
          {([
            ['primaryColor', 'overridePrimary', 'Primary color'],
            ['secondaryColor', 'overrideSecondary', 'Secondary color'],
          ] as const).map(([key, overrideKey, label]) => (
            <div key={key}>
              <OverrideToggle
                checked={form[overrideKey]}
                onChange={(v) => set(overrideKey, v)}
                label={form[overrideKey] ? `Override: ${label}` : `Use default ${label.toLowerCase()}`}
              />
              <div className={`flex items-center gap-2 transition-opacity ${form[overrideKey] ? '' : 'opacity-40 pointer-events-none'}`}>
                <input type="color" value={form[key]} onChange={(e) => set(key, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-border" />
                <input type="text" value={form[key]} maxLength={7}
                  onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set(key, e.target.value) }}
                  className="flex-1 rounded border border-border px-2 py-1.5 text-[12px] font-mono" />
              </div>
            </div>
          ))}
        </div>

        {/* Fonts */}
        <div className="grid grid-cols-2 gap-4">
          {([
            ['headingFont', 'overrideHeadingFont', 'Heading font'],
            ['bodyFont', 'overrideBodyFont', 'Body font'],
          ] as const).map(([key, overrideKey, label]) => (
            <div key={key}>
              <OverrideToggle
                checked={form[overrideKey]}
                onChange={(v) => set(overrideKey, v)}
                label={form[overrideKey] ? `Override: ${label}` : `Use default ${label.toLowerCase()}`}
              />
              <select value={form[key]} onChange={(e) => set(key, e.target.value)}
                disabled={!form[overrideKey]}
                className="w-full rounded border border-border px-2 py-1.5 text-[13px] disabled:opacity-40"
                style={{ backgroundColor: '#fafaf8' }}>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
        </div>

        {/* Agency name override */}
        <div>
          <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>Agency name <span style={{ color: '#b4b2a9' }}>(shown in footer — leave blank to use agency default)</span></p>
          <input type="text" value={form.agencyName} onChange={(e) => set('agencyName', e.target.value)}
            placeholder={merged?.agencyName ?? 'e.g. Acme Agency (agency default)'}
            className="w-full rounded border border-border px-3 py-2 text-[13px]" />
        </div>

        {/* Footer text override */}
        <div>
          <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>Footer text <span style={{ color: '#b4b2a9' }}>(leave blank to use agency default)</span></p>
          <input type="text" value={form.footerText} onChange={(e) => set('footerText', e.target.value)}
            placeholder={merged?.footerText ?? 'e.g. Confidential — Do not distribute'}
            className="w-full rounded border border-border px-3 py-2 text-[13px]" />
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3">
          {([
            ['coverPage', 'overrideCoverPage', 'Include cover page'],
            ['pageNumbers', 'overridePageNumbers', 'Include page numbers'],
          ] as const).map(([key, overrideKey, label]) => (
            <div key={key}>
              <OverrideToggle
                checked={form[overrideKey]}
                onChange={(v) => set(overrideKey, v)}
                label={form[overrideKey] ? `Override: ${label.toLowerCase()}` : `Use default (${label.toLowerCase()})`}
              />
              <label className={`flex items-center gap-3 cursor-pointer select-none transition-opacity ${form[overrideKey] ? '' : 'opacity-40 pointer-events-none'}`}>
                <button
                  role="switch" aria-checked={form[key]}
                  onClick={() => set(key, !form[key])}
                  className="relative h-5 w-9 rounded-full transition-colors"
                  style={{ backgroundColor: form[key] ? '#a200ee' : '#d1d5db' }}
                >
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                    style={{ transform: form[key] ? 'translateX(16px)' : 'translateX(2px)' }} />
                </button>
                <span className="text-[13px]" style={{ color: '#374151' }}>{label}</span>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
