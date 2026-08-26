import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { parseDelimitedText, parseSpreadsheetFile } from '@/lib/excel'
import { normalizeCode } from '@/lib/codeNormalize'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useTranslation } from '@/i18n/I18nProvider'
import { useContainers } from './useContainers'
import {
  containerRequiredFields,
  fieldTargetI18nKey,
  guessContainerField,
  guessHeaderRowIndex,
  type ContainerFieldTarget,
} from './containerColumnMapping'
import type { Container } from './types'

type Step = 'form' | 'input' | 'header-select' | 'mapping' | 'preview' | 'importing' | 'done'

interface PreviewRow {
  code: string
  product_name: string
  calidad: string
  expected_qty: string
  unit: string
  cost_usd_per_kilo: string
  notes: string
}

function emptyRow(): PreviewRow {
  return { code: '', product_name: '', calidad: '', expected_qty: '', unit: '', cost_usd_per_kilo: '', notes: '' }
}

export function NewContainerPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const { createContainer } = useContainers(activeBranchId)

  const [step, setStep] = useState<Step>('form')
  const [container, setContainer] = useState<Container | null>(null)

  // container creation form
  const [code, setCode] = useState('')
  const [supplier, setSupplier] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [notes, setNotes] = useState('')
  const [branchId, setBranchId] = useState(activeBranchId)
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // excel import wizard
  const [allRows, setAllRows] = useState<string[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ContainerFieldTarget[]>([])
  const [pasteText, setPasteText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ inserted: number; merged: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleCreateContainer() {
    setFormError(null)
    if (!code.trim()) {
      setFormError(t('newContainer.form.errorCode'))
      return
    }
    if (!branchId) {
      setFormError(t('newContainer.form.errorBranch'))
      return
    }
    setCreating(true)
    const { container: created, error } = await createContainer({
      code: code.trim(),
      branch_id: branchId,
      supplier: supplier.trim() || null,
      arrival_date: arrivalDate || null,
      notes: notes.trim() || null,
    })
    setCreating(false)
    if (error) {
      setFormError(error)
      return
    }
    setContainer(created)
    setStep('input')
  }

  function loadRows(rows: string[][]) {
    if (rows.length < 2) {
      setLoadError(t('newContainer.input.errorMinRows'))
      return
    }
    setLoadError(null)
    setAllRows(rows)
    setHeaderRowIndex(guessHeaderRowIndex(rows))
    setStep('header-select')
  }

  async function handleFile(file: File) {
    try {
      const rows = await parseSpreadsheetFile(file)
      loadRows(rows)
    } catch {
      setLoadError(t('newContainer.input.errorFileRead'))
    }
  }

  function handlePasteImport() {
    loadRows(parseDelimitedText(pasteText))
  }

  function confirmHeaderRow() {
    const headerRow = allRows[headerRowIndex]
    const dataRows = allRows.slice(headerRowIndex + 1)
    setHeaders(headerRow)
    setRawRows(dataRows)
    setMapping(headerRow.map((h) => guessContainerField(h)))
    setStep('mapping')
  }

  const mappingComplete = containerRequiredFields.every((f) => mapping.includes(f))

  function buildPreviewFromMapping() {
    const get = (row: string[], field: ContainerFieldTarget) => {
      const colIndex = mapping.indexOf(field)
      return colIndex === -1 ? '' : (row[colIndex] ?? '').trim()
    }
    const rows: PreviewRow[] = rawRows
      .filter((row) => row.some((cell) => cell.trim() !== ''))
      .map((row) => ({
        code: get(row, 'code'),
        product_name: get(row, 'product_name'),
        calidad: get(row, 'calidad'),
        expected_qty: get(row, 'expected_qty'),
        unit: get(row, 'unit'),
        cost_usd_per_kilo: get(row, 'cost_usd_per_kilo'),
        notes: get(row, 'notes'),
      }))
    setPreviewRows(rows)
    setStep('preview')
  }

  function updatePreviewRow(index: number, field: keyof PreviewRow, value: string) {
    setPreviewRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function deletePreviewRow(index: number) {
    setPreviewRows((rows) => rows.filter((_, i) => i !== index))
  }

  function addPreviewRow() {
    setPreviewRows((rows) => [...rows, emptyRow()])
  }

  const rowErrors = useMemo(() => {
    const conflictKeys = new Map<string, Set<string>>()
    previewRows.forEach((row) => {
      if (!row.code.trim()) return
      const norm = normalizeCode(row.code)
      const productKey = `${row.product_name.trim().toLowerCase()}|${row.calidad.trim().toLowerCase()}`
      if (!conflictKeys.has(norm)) conflictKeys.set(norm, new Set())
      conflictKeys.get(norm)!.add(productKey)
    })

    return previewRows.map((row) => {
      const errors: string[] = []
      if (!row.product_name.trim()) errors.push(t('rowError.emptyProduct'))
      const qty = Number(row.expected_qty)
      if (row.expected_qty.trim() === '' || Number.isNaN(qty) || qty < 0) errors.push(t('rowError.invalidQty'))

      if (row.cost_usd_per_kilo.trim()) {
        const cost = Number(row.cost_usd_per_kilo)
        if (Number.isNaN(cost) || cost < 0) errors.push(t('rowError.invalidCost'))
      }

      if (row.code.trim()) {
        const norm = normalizeCode(row.code)
        const variants = conflictKeys.get(norm)
        if (variants && variants.size > 1) {
          errors.push(t('rowError.duplicateCode'))
        }
      }
      return errors
    })
  }, [previewRows, t])

  const validCount = rowErrors.filter((e) => e.length === 0).length
  const invalidCount = rowErrors.length - validCount

  async function handleImport() {
    if (!container) return
    setStep('importing')
    setImportError(null)

    const items = previewRows
      .map((row, i) => ({ row, i }))
      .filter(({ i }) => rowErrors[i].length === 0)
      .map(({ row }) => ({
        code: row.code.trim() || null,
        product_name: row.product_name.trim(),
        calidad: row.calidad.trim() || null,
        expected_qty: Number(row.expected_qty),
        unit: row.unit.trim() || null,
        cost_usd_per_kilo: row.cost_usd_per_kilo.trim() ? Number(row.cost_usd_per_kilo) : null,
        notes: row.notes.trim() || null,
      }))

    const { data, error } = await supabase.rpc('import_container_items', {
      p_container_id: container.id,
      p_items: items,
    })

    if (error) {
      setImportError(error.message)
      setStep('preview')
      return
    }
    setImportResult(data as unknown as { inserted: number; merged: number })
    setStep('done')
  }

  function resetImportWizard() {
    setStep('input')
    setAllRows([])
    setHeaderRowIndex(0)
    setRawRows([])
    setHeaders([])
    setMapping([])
    setPasteText('')
    setLoadError(null)
    setPreviewRows([])
    setImportError(null)
    setImportResult(null)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{t('newContainer.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('newContainer.subtitle')}</p>

      {step === 'form' && (
        <div className="mt-6 max-w-lg space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <Input
            label={t('newContainer.form.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('newContainer.form.codePlaceholder')}
          />
          <Select label={t('newContainer.form.branch')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('newContainer.form.branchPlaceholder')}</option>
            {branches
              .filter((b) => b.branch_type === 'importadora')
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
          <Input label={t('newContainer.form.supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <Input
            label={t('newContainer.form.arrival')}
            type="date"
            value={arrivalDate}
            onChange={(e) => setArrivalDate(e.target.value)}
          />
          <Textarea label={t('newContainer.form.notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <Button onClick={handleCreateContainer} disabled={creating}>
            {creating ? t('newContainer.form.submitting') : t('newContainer.form.submit')}
          </Button>
        </div>
      )}

      {step === 'input' && (
        <div className="mt-6 space-y-6">
          <p className="text-sm text-slate-600">
            {t('newContainer.input.created', { number: container?.internal_number ?? '', code: container?.code ?? '' })}
          </p>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <Upload className="text-slate-400" size={28} />
            <p className="text-sm text-slate-600">{t('newContainer.input.dropzone')}</p>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              {t('newContainer.input.selectFile')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t('newContainer.input.pasteLabel')}</p>
            <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Codigo	Producto	Calidad	Cantidad..." />
            <Button className="mt-2" onClick={handlePasteImport} disabled={!pasteText.trim()}>
              {t('newContainer.input.continue')}
            </Button>
          </div>
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        </div>
      )}

      {step === 'header-select' && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-700">{t('newContainer.headerSelect.instructions')}</p>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {allRows.slice(0, 15).map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setHeaderRowIndex(i)}
                    className={`cursor-pointer ${i === headerRowIndex ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-3 py-1.5 text-xs">
                      <input type="radio" checked={i === headerRowIndex} onChange={() => setHeaderRowIndex(i)} className="mr-2" />
                      {i + 1}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.filter(Boolean).join(' | ') || <span className="italic opacity-50">{t('newContainer.headerSelect.empty')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportWizard}>
              {t('newContainer.headerSelect.cancel')}
            </Button>
            <Button onClick={confirmHeaderRow}>{t('newContainer.headerSelect.continue')}</Button>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="mt-6 space-y-4">
          <p className="mb-2 text-sm font-medium text-slate-700">{t('newContainer.mapping.instructions', { count: rawRows.length })}</p>
          <p className="text-xs text-slate-500">{t('newContainer.mapping.codeOptionalHint')}</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t('newContainer.mapping.colFile')}</th>
                  <th className="px-4 py-2">{t('newContainer.mapping.colExample')}</th>
                  <th className="px-4 py-2">{t('newContainer.mapping.colTarget')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {headers.map((header, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium text-slate-900">{header || t('newContainer.mapping.column', { n: i + 1 })}</td>
                    <td className="px-4 py-2 text-slate-500">{rawRows[0]?.[i] ?? ''}</td>
                    <td className="px-4 py-2">
                      <select
                        value={mapping[i]}
                        onChange={(e) => {
                          const next = [...mapping]
                          next[i] = e.target.value as ContainerFieldTarget
                          setMapping(next)
                        }}
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      >
                        {Object.entries(fieldTargetI18nKey).map(([value, key]) => (
                          <option key={value} value={value}>
                            {t(key)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mappingComplete && (
            <p className="text-sm text-amber-600">
              {t('newContainer.mapping.missing', {
                fields: containerRequiredFields
                  .filter((f) => !mapping.includes(f))
                  .map((f) => t(fieldTargetI18nKey[f]))
                  .join(', '),
              })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportWizard}>
              {t('newContainer.headerSelect.cancel')}
            </Button>
            <Button onClick={buildPreviewFromMapping} disabled={!mappingComplete}>
              {t('newContainer.mapping.preview')}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 size={16} /> {t('newContainer.preview.valid', { count: validCount })}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle size={16} /> {t('newContainer.preview.invalid', { count: invalidCount })}
            </span>
            <Button variant="secondary" onClick={addPreviewRow}>
              <Plus size={14} /> {t('newContainer.preview.addRow')}
            </Button>
          </div>

          {importError && <p className="text-sm text-red-600">{importError}</p>}

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('newContainer.preview.col.num')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.code')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.product')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.quality')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.expectedQty')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.unit')}</th>
                  <th className="px-3 py-2">{t('newContainer.preview.col.costUsdKilo')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((row, i) => (
                  <tr key={i} className={rowErrors[i].length > 0 ? 'bg-red-50' : ''}>
                    <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1">
                      <input
                        value={row.code}
                        onChange={(e) => updatePreviewRow(i, 'code', e.target.value)}
                        className="w-32 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={row.product_name}
                        onChange={(e) => updatePreviewRow(i, 'product_name', e.target.value)}
                        className="w-48 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={row.calidad}
                        onChange={(e) => updatePreviewRow(i, 'calidad', e.target.value)}
                        className="w-28 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={row.expected_qty}
                        onChange={(e) => updatePreviewRow(i, 'expected_qty', e.target.value)}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={row.unit}
                        onChange={(e) => updatePreviewRow(i, 'unit', e.target.value)}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={row.cost_usd_per_kilo}
                        onChange={(e) => updatePreviewRow(i, 'cost_usd_per_kilo', e.target.value)}
                        placeholder="0.00"
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button onClick={() => deletePreviewRow(i)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                      {rowErrors[i].length > 0 && <p className="mt-0.5 text-xs text-red-600">{rowErrors[i].join(', ')}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('mapping')}>
              {t('newContainer.preview.back')}
            </Button>
            <Button onClick={handleImport} disabled={validCount === 0}>
              {t('newContainer.preview.import', { count: validCount })}
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && <p className="mt-10 text-center text-sm text-slate-600">{t('newContainer.importing')}</p>}

      {step === 'done' && importResult && container && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <p className="flex items-center gap-2 text-base font-semibold text-green-700">
            <CheckCircle2 size={20} /> {t('newContainer.done.title')}
          </p>
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            <li>{t('newContainer.done.newProducts', { count: importResult.inserted })}</li>
            <li>{t('newContainer.done.mergedRows', { count: importResult.merged })}</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={resetImportWizard}>
              {t('newContainer.done.loadAnother')}
            </Button>
            <Button onClick={() => navigate(`/contenedores/activo/${container.id}`)}>{t('newContainer.done.goToContainer')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
