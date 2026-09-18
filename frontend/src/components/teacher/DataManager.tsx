import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { API_CONFIG } from '../../api/config';

const API_BASE = API_CONFIG.apiUrl;
const TOKEN_KEY = 'xgpy_token';

type DomainMeta = {
  id: string;
  name: string;
  defaultOff?: boolean;
  tables: { table: string; rows: number }[];
  total_rows: number;
};

type FileMeta = {
  id: string;
  name: string;
  file_count: number;
  file_size: number;
  subdirs: string[];
};

type MetaResponse = { domains: DomainMeta[]; files: FileMeta };

type PreviewTable = { table: string; package_rows: number; current_rows: number | null };
type PreviewDomain = { id: string; name: string; tables: PreviewTable[]; total_package: number };
type PreviewData = {
  manifest: { platform_version: string; exported_at: string; file_mode: string; schema_migrations_max: number | null };
  domains: PreviewDomain[];
  files: { package_count: number; local_count: number; new_files: number; changed_files: number } | null;
  warnings: string[];
  temp_file: string;
  size: number;
};

type ImportReport = {
  snapshot: { name: string; size: number };
  tables: { table: string; mode: string; status: string; package_rows: number; deleted: number; inserted: number; skipped?: number }[];
  files: { mode?: string; added?: number; overwritten?: number; deleted?: number; note?: string } | null;
};

type Snapshot = { name: string; size: number; created_at: string };

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const MODE_LABELS: Record<string, string> = { skip: '跳过', overwrite: '覆盖', append: '追加' };

export function DataManager() {
  const [view, setView] = useState<'export' | 'import'>('export');
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fileMode, setFileMode] = useState<'full' | 'manifest'>('full');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMeta = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/data-io/meta`, { headers: authHeaders() });
      const json = await resp.json();
      if (json.data) {
        setMeta(json.data);
        const init = new Set<string>();
        (json.data.domains as DomainMeta[]).forEach((d: DomainMeta) => { if (!d.defaultOff) init.add(d.id); });
        init.add('files');
        setSelected(init);
      }
      const s = await fetch(`${API_BASE}/api/admin/data-io/snapshots`, { headers: authHeaders() });
      const sj = await s.json();
      if (sj.data) setSnapshots(sj.data);
    } catch (e) {
      console.error('加载数据管理元信息失败', e);
    }
  };

  useEffect(() => { loadMeta(); }, []);

  const estSize = () => {
    if (!meta) return 0;
    let est = 0;
    meta.domains.forEach((d) => {
      if (selected.has(d.id)) est += d.total_rows * 220; // 每行 JSON 粗估
    });
    if (selected.has('files') && fileMode === 'full') {
      const files = meta.files;
      est += files.file_size - [...excluded].reduce((s) => s, 0);
    }
    return est;
  };

  const handleExport = async () => {
    if (selected.size === 0) { setExportMsg('请至少选择一个数据域'); return; }
    setExporting(true);
    setExportMsg('');
    try {
      const params = new URLSearchParams({
        domains: [...selected].join(','),
        file_mode: fileMode,
        exclude: [...excluded].join(','),
      });
      const resp = await fetch(`${API_BASE}/api/admin/data-io/export?${params}`, { headers: authHeaders() });
      if (!resp.ok) {
        const errText = await resp.text();
        setExportMsg('导出失败: ' + errText.slice(0, 200));
        return;
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition') || '';
      const m = disposition.match(/filename="?([^";]+)"?/);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? m[1] : 'xgpy-backup.xgpybak';
      a.click();
      URL.revokeObjectURL(a.href);
      setExportMsg(`导出完成（${fmtSize(blob.size)}），浏览器已开始下载`);
      loadMeta();
    } catch (e: any) {
      setExportMsg('导出失败: ' + (e.message || e));
    } finally {
      setExporting(false);
    }
  };

  const toggleDomain = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUploadPreview = async (file: File) => {
    setUploading(true);
    setPreview(null);
    setReport(null);
    setImportError('');
    setConfirmed(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch(`${API_BASE}/api/admin/data-io/import/preview`, { method: 'POST', headers: authHeaders(), body: fd });
      const json = await resp.json();
      if (json.error) { setImportError(json.error); return; }
      setPreview(json.data);
      const init: Record<string, string> = {};
      (json.data as PreviewData).domains.forEach((d) => { init[d.id] = 'overwrite'; });
      if ((json.data as PreviewData).files) init.files = 'overwrite';
      setModes(init);
    } catch (e: any) {
      setImportError('上传失败: ' + (e.message || e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExecute = async () => {
    if (!preview) return;
    setImporting(true);
    setImportError('');
    try {
      // 复用预览时服务器保留的临时文件，避免二次上传大包
      const resp = await fetch(`${API_BASE}/api/admin/data-io/import/execute`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ modes, confirm: 'yes', reuse_file: preview.temp_file }),
      });
      const json = await resp.json();
      if (json.error) { setImportError(json.error); return; }
      setReport(json.data);
      setPreview(null);
      loadMeta();
    } catch (e: any) {
      setImportError('导入失败: ' + (e.message || e));
    } finally {
      setImporting(false);
    }
  };

  const hasActive = Object.values(modes).some((m) => m === 'overwrite' || m === 'append');

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <button onClick={() => setView('export')} className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'export' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          导出备份
        </button>
        <button onClick={() => setView('import')} className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'import' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          导入恢复
        </button>
      </div>

      {view === 'export' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-sm text-gray-500">勾选需要备份的数据域，导出为 .xgpybak 压缩包（含数据库与上传文件）。</p>
          {meta && (
            <>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-w-2xl">
                {meta.domains.map((d) => (
                  <label key={d.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                    <span className="flex items-center gap-3">
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDomain(d.id)} className="w-4 h-4" />
                      <span className="text-sm font-medium text-gray-700">{d.name}</span>
                    </span>
                    <span className="text-xs text-gray-400">{d.total_rows} 行</span>
                  </label>
                ))}
                <div className="px-4 py-3 bg-gray-50">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-3">
                      <input type="checkbox" checked={selected.has('files')} onChange={() => toggleDomain('files')} className="w-4 h-4" />
                      <span className="text-sm font-medium text-gray-700">{meta.files.name}</span>
                    </span>
                    <span className="text-xs text-gray-400">{meta.files.file_count} 个文件 / {fmtSize(meta.files.file_size)}</span>
                  </label>
                  {selected.has('files') && (
                    <div className="mt-3 ml-7 space-y-2">
                      <div className="flex gap-4 text-sm">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" checked={fileMode === 'full'} onChange={() => setFileMode('full')} />全量打包
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" checked={fileMode === 'manifest'} onChange={() => setFileMode('manifest')} />仅文件清单（不含本体）
                        </label>
                      </div>
                      {meta.files.subdirs.length > 0 && (
                        <div className="text-xs text-gray-500">
                          排除目录：
                          {meta.files.subdirs.map((s) => (
                            <label key={s} className="inline-flex items-center gap-1 mr-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={excluded.has(s)}
                                onChange={() => setExcluded((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
                              />
                              {s}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={handleExport} disabled={exporting} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {exporting ? '正在导出…' : '导出备份包'}
                </button>
                <span className="text-sm text-gray-500">预估体积 ≈ {fmtSize(estSize())}</span>
              </div>
              {exportMsg && <div className="text-sm text-blue-600">{exportMsg}</div>}
            </>
          )}
        </motion.div>
      )}

      {view === 'import' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-sm text-gray-500">上传 .xgpybak 备份包，逐个数据域选择导入方式。执行前系统会自动快照当前库（保留最近 5 份）。</p>
          {!preview && !report && (
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center max-w-2xl">
              <input ref={fileInputRef} type="file" accept=".xgpybak,.zip" className="hidden" onChange={(e) => e.target.files?.[0] && handleUploadPreview(e.target.files[0])} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {uploading ? '正在解析…' : '选择备份包并预览'}
              </button>
            </div>
          )}
          {importError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 max-w-2xl">{importError}</div>}

          {preview && (
            <div className="max-w-3xl space-y-4">
              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2">
                备份来自版本 {preview.manifest.platform_version}，导出于 {new Date(preview.manifest.exported_at).toLocaleString()}，包大小 {fmtSize(preview.size)}
              </div>
              {preview.warnings.map((w, i) => (
                <div key={i} className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">{w}</div>
              ))}
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {preview.domains.map((d) => (
                  <div key={d.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">{d.name}</span>
                      <select
                        value={modes[d.id] || 'skip'}
                        onChange={(e) => setModes((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="overwrite">覆盖（与包完全一致）</option>
                        <option value="append">追加（冲突跳过）</option>
                        <option value="skip">跳过</option>
                      </select>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      包内 {d.total_package} 行；{d.tables.slice(0, 4).map((t) => `${t.table}: ${t.package_rows}`).join('，')}{d.tables.length > 4 ? ` 等 ${d.tables.length} 表` : ''}
                    </div>
                  </div>
                ))}
                {preview.files && (
                  <div className="px-4 py-2.5 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">文件资源（uploads）</span>
                      <select
                        value={modes.files || 'skip'}
                        onChange={(e) => setModes((prev) => ({ ...prev, files: e.target.value }))}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="overwrite">恢复文件（增改不删）</option>
                        <option value="skip">跳过</option>
                      </select>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      包内 {preview.files.package_count} 个文件；本地 {preview.files.local_count} 个；新增 {preview.files.new_files}、有差异 {preview.files.changed_files}
                    </div>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-4 h-4" />
                我已了解覆盖模式的后果（被选域的现有数据将被替换）
              </label>
              <div className="flex gap-3">
                <button onClick={handleExecute} disabled={importing || !confirmed || !hasActive} className="px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {importing ? '正在导入…' : '执行导入'}
                </button>
                <button onClick={() => setPreview(null)} className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">取消</button>
              </div>
            </div>
          )}

          {report && (
            <div className="max-w-3xl space-y-3">
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
                导入完成。已自动快照当前库：{report.snapshot.name}（{fmtSize(report.snapshot.size)}），保留在服务器 backups 目录。
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr><th className="text-left px-3 py-2">表</th><th className="text-left px-3 py-2">模式</th><th className="text-right px-3 py-2">包内</th><th className="text-right px-3 py-2">删除</th><th className="text-right px-3 py-2">插入</th><th className="text-right px-3 py-2">跳过</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.tables.map((t) => (
                      <tr key={t.table}>
                        <td className="px-3 py-1.5 text-gray-700">{t.table}</td>
                        <td className="px-3 py-1.5 text-gray-500">{MODE_LABELS[t.mode] || t.mode}{t.status === 'missing' && '（表不存在）'}</td>
                        <td className="px-3 py-1.5 text-right">{t.package_rows}</td>
                        <td className="px-3 py-1.5 text-right">{t.deleted}</td>
                        <td className="px-3 py-1.5 text-right">{t.inserted}</td>
                        <td className="px-3 py-1.5 text-right">{t.skipped ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.files && (
                <div className="text-sm text-gray-600">
                  文件资源：{report.files.note || `新增 ${report.files.added}、覆盖 ${report.files.overwritten}（本地多出的文件未删除）`}
                </div>
              )}
              <button onClick={() => setReport(null)} className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">完成</button>
            </div>
          )}

          {snapshots.length > 0 && (
            <div className="max-w-3xl pt-4 border-t border-gray-200">
              <h4 className="text-sm font-medium text-gray-600 mb-2">服务器本地快照（导入前自动生成，保留 5 份）</h4>
              <ul className="text-sm text-gray-500 space-y-1">
                {snapshots.map((s) => (
                  <li key={s.name} className="flex justify-between">
                    <span>{s.name}</span><span>{fmtSize(s.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
