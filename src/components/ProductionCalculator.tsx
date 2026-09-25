/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Upload, FileSpreadsheet, Calculator, AlertCircle, Filter, Settings, CheckCircle2, FileCheck, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import { format, isValid } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { LineStatus } from '../types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type RowData = Record<string, any>;

interface Mappings {
  date: string;
  order: string;
  inspector: string;
  shift: string;
}

interface Filters {
  date: string;
  order: string;
  inspector: string;
  shift: string;
  line: string;
}

interface AndonProdItem {
  lineName: string;
  productCode: string;
  productName: string;
  andonQty: number;
  isRunning: boolean;
}

const findInspectorColumn = (headers: string[]): string => {
  const match2026 = headers.find(h => {
    const lh = h.toLowerCase().trim();
    return lh.startsWith('2026') || lh.includes('2026');
  });
  if (match2026) return match2026;

  const keywords = ['kiểm tra vào ca', 'người kiểm tra', 'nguoi kiem tra', 'kỹ thuật viên', 'fqc', 'qc'];
  return headers.find(h => {
    const lh = h.toLowerCase().trim();
    return keywords.some(k => lh.includes(k));
  }) || '';
};

const findShiftColumn = (headers: string[]): string => {
  const matchNhapTay1 = headers.find(h => {
    const lh = h.toLowerCase().trim();
    return lh.includes('nhập tay (1)') || 
           lh.includes('nhập tay(1)') || 
           lh.includes('nhap tay (1)') || 
           lh.includes('nhap tay(1)') || 
           lh.includes('nhập tay 1') || 
           lh.includes('nhap tay 1') || 
           lh.includes('nhập tay_1') || 
           lh.includes('nhap tay_1');
  });
  if (matchNhapTay1) return matchNhapTay1;

  const matchNhapTayCa = headers.find(h => {
    const lh = h.toLowerCase().trim();
    return lh === 'nhập tay ca' || lh.includes('nhập tay ca') || lh.includes('nhap tay ca');
  });
  if (matchNhapTayCa) return matchNhapTayCa;

  const matchCa = headers.find(h => {
    const lh = h.toLowerCase().trim();
    return lh.includes('ca làm việc') || lh.includes('ca lam viec') || lh === 'ca' || lh.startsWith('ca ');
  });
  if (matchCa) return matchCa;

  const matchAnyNhapTay = headers.find(h => {
    const lh = h.toLowerCase().trim();
    return lh.includes('nhập tay') || lh.includes('nhap tay');
  });
  if (matchAnyNhapTay) return matchAnyNhapTay;

  return '';
};

const formatShiftName = (rawShift: string): string => {
  if (!rawShift) return '';
  const s = rawShift.trim();
  if (!s || s === 'Chưa xác định') return s;
  const lower = s.toLowerCase();
  if (lower.startsWith('ca ') || lower.startsWith('ca-') || lower.startsWith('ca_')) {
    return lower;
  }
  if (lower === 'ca') {
    return 'ca';
  }
  return `ca ${lower}`;
};

const LINE_MAPPING: Record<string, string> = {
  '06': 'Atmor 1',
  '09': 'Atmor 2',
  '05': 'ELI',
  '31': '30',
  '12': '15L',
  '22': '20SL',
  '08': 'PRO'
};

const DIRECT_LINES = ['Atmor 1', 'Atmor 2', 'ELI', 'PRO'];
const INDIRECT_LINES = ['15L', '20SL', '30'];

const getLinePriority = (lineName: string): number => {
  if (DIRECT_LINES.includes(lineName)) return 1;
  if (INDIRECT_LINES.includes(lineName)) return 2;
  return 3;
};

const getLineFromScan = (scanCode: string): { lineCode: string; lineName: string } => {
  const clean = String(scanCode || '').trim();
  if (clean.length < 7) {
    return { lineCode: '', lineName: 'Khác' };
  }
  const last7 = clean.slice(-7);
  const lineCode = last7.slice(0, 2);
  const lineName = LINE_MAPPING[lineCode] || (lineCode ? `Line ${lineCode}` : 'Khác');
  return { lineCode, lineName };
};

const guessMapping = (headers: string[], type: 'date' | 'order') => {
  const keywords = {
    date: ['ngày', 'date', 'thời gian', 'ngay'],
    order: ['scan', 'quẹt', 'mã vạch', 'barcode', 'đơn hàng', 'mã đơn', 'po', 'lsx', 'lệnh sản xuất', 'order', 'don hang']
  };
  const targets = keywords[type];
  for (const header of headers) {
    const lower = header.toLowerCase();
    if (targets.some(k => lower.includes(k))) return header;
  }
  return '';
};

const guessMappingsByData = (headers: string[], rows: RowData[]): Mappings => {
  let dateCol = '';
  let orderCol = '';
  const sampleRows = rows.slice(0, 50);

  const scores = headers.map(header => {
    let dateScore = 0;
    let scanScore = 0;
    const lowerHeader = header.toLowerCase();

    if (['ngày', 'date', 'thời gian', 'ngay'].some(k => lowerHeader.includes(k))) dateScore += 20;
    if (['scan', 'quẹt', 'mã vạch', 'barcode', 'đơn hàng', 'mã đơn', 'po', 'lsx', 'lệnh sản xuất', 'order', 'don hang'].some(k => lowerHeader.includes(k))) scanScore += 15;

    let dateMatchCount = 0;
    let scanMatchCount = 0;
    let totalValidCells = 0;

    sampleRows.forEach(row => {
      const val = row[header];
      if (val !== undefined && val !== null && val !== '') {
        totalValidCells++;
        const strVal = String(val).trim();
        const cleanDigitsOnly = strVal.replace(/\D/g, '');
        
        if (/^\d{21}$/.test(strVal)) {
          scanScore += 15;
          scanMatchCount++;
        } else if (cleanDigitsOnly.length === 21) {
          scanScore += 12;
          scanMatchCount++;
        } else if (strVal.length === 21) {
          scanScore += 8;
          scanMatchCount += 0.5;
        }

        if (val instanceof Date) dateMatchCount++;
        else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(strVal)) dateMatchCount++;
        else if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(strVal)) dateMatchCount++;
      }
    });

    if (totalValidCells > 0) {
      dateScore += (dateMatchCount / totalValidCells) * 150;
      scanScore += (scanMatchCount / totalValidCells) * 200;
    }

    return { header, dateScore, scanScore };
  });

  let bestDate = scores.reduce((best, curr) => curr.dateScore > best.dateScore ? curr : best, { header: '', dateScore: -1 });
  if (bestDate.dateScore > 10) dateCol = bestDate.header;

  let bestScan = scores.reduce((best, curr) => {
    if (curr.header === dateCol) return best;
    return curr.scanScore > best.scanScore ? curr : best;
  }, { header: '', scanScore: -1 });
  if (bestScan.scanScore > 10) orderCol = bestScan.header;

  if (!dateCol) dateCol = guessMapping(headers, 'date');
  if (!orderCol) orderCol = guessMapping(headers, 'order');

  return {
    date: dateCol,
    order: orderCol,
    inspector: findInspectorColumn(headers),
    shift: findShiftColumn(headers)
  };
};

const parseDateToTime = (dateStr: string): number => {
  if (!dateStr) return 0;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (isValid(d)) return d.getTime();
  }
  const parsed = new Date(dateStr);
  return isValid(parsed) ? parsed.getTime() : 0;
};

const getNewestDate = (data: RowData[], dateCol: string): string => {
  if (!dateCol || !data.length) return '';
  const dates = Array.from(new Set(data.map(r => String(r[dateCol] || '')).filter(Boolean)));
  if (dates.length === 0) return '';
  dates.sort((a: string, b: string) => parseDateToTime(b) - parseDateToTime(a));
  return dates[0] || '';
};

interface ProductionCalculatorProps {
  onClose?: () => void;
  initialFile?: File | null;
  andonLines?: LineStatus[];
}
export const ProductionCalculator: React.FC<ProductionCalculatorProps> = ({ onClose, initialFile, andonLines = [] }) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [persistedFileName, setPersistedFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<RowData[]>([]);
  const [mappings, setMappings] = useState<Mappings>({ date: '', order: '', inspector: '', shift: '' });
  const [filters, setFilters] = useState<Filters>({ date: '', order: '', inspector: '', shift: '', line: '' });
  const [extractFirst7, setExtractFirst7] = useState<boolean>(true);
  const [selectedSummaryItem, setSelectedSummaryItem] = useState<{
    date: string;
    orderCode: string;
    qty: number;
    lineCounts?: Record<string, number>;
  } | null>(null);
  const [viewMode, setViewMode] = useState<'combined' | 'standard'>('combined');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialFile) {
      processFile(initialFile);
    }
  }, [initialFile]);

  const getOrderCode = useCallback((val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (!str) return '';
    return extractFirst7 ? str.substring(0, 7) : str;
  }, [extractFirst7]);

  const processFile = async (selectedFile: File) => {
    try {
      setIsLoading(true);
      setError(null);
      setFile(selectedFile);

      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await selectedFile.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error('File không chứa worksheet nào.');

      const rawRows: any[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
        const cleanedRow = rowValues.map(cell => {
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'object') {
            if (cell instanceof Date) return cell;
            if ('richText' in cell && Array.isArray(cell.richText)) return cell.richText.map((t: any) => t.text).join('');
            if ('result' in cell) return (cell as any).result;
            return String(cell);
          }
          return cell;
        });
        rawRows.push(cleanedRow);
      });

      if (rawRows.length < 2) throw new Error('File Excel không có đủ dữ liệu.');

      const rawHeaders = rawRows[0].map(h => String(h || '').trim());
      const uniqueHeaders: string[] = [];
      rawHeaders.forEach((h, i) => {
        let finalHeader = h || `Column ${i + 1}`;
        let counter = 1;
        while (uniqueHeaders.includes(finalHeader)) finalHeader = `${h} (${counter++})`;
        uniqueHeaders.push(finalHeader);
      });

      const parsedData: RowData[] = rawRows.slice(1).map((row) => {
        const obj: RowData = {};
        row.forEach((cell, i) => { if (uniqueHeaders[i]) obj[uniqueHeaders[i]] = cell; });
        return obj;
      });

      const cleanedData = parsedData.map(row => {
        const newRow = { ...row };
        uniqueHeaders.forEach(h => {
          const val = row[h];
          if (val instanceof Date) {
            newRow[h] = isValid(val) ? format(val, 'dd/MM/yyyy') : '';
          }
        });
        return newRow;
      });

      setHeaders(uniqueHeaders);
      setData(cleanedData);
      setPersistedFileName(selectedFile.name);

      const initialMappings = guessMappingsByData(uniqueHeaders, cleanedData);
      setMappings(initialMappings);
      setFilters({ date: getNewestDate(cleanedData, initialMappings.date), order: '', inspector: '', shift: '', line: '' });
    } catch (err: any) {
      setError(err.message || 'Lỗi khi đọc file.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      processFile(e.target.files[0]);
      // Reset input value so the same file can be selected again
      e.target.value = '';
    }
  };

  const getRowInspectorAndShift = useCallback((row: RowData) => {
    const rawScan = mappings.order ? String(row[mappings.order] || '').trim() : '';
    const { lineName } = getLineFromScan(rawScan);
    return {
      inspector: String(row[mappings.inspector] || 'Chưa xác định').trim(),
      shift: formatShiftName(String(row[mappings.shift] || 'Chưa xác định')),
      line: lineName
    };
  }, [mappings]);

  const uniqueDates = useMemo(() => {
    if (!mappings.date || !data.length) return [];
    return Array.from(new Set(data.map(r => String(r[mappings.date] || '')).filter(Boolean)))
      .sort((a, b) => parseDateToTime(b as string) - parseDateToTime(a as string));
  }, [data, mappings.date]);

  const filteredData = useMemo(() => {
    if (!mappings.date || !mappings.order) return [];
    return data.filter(r => {
      const orderCode = getOrderCode(r[mappings.order]);
      if (!orderCode) return false;
      const matchDate = filters.date ? String(r[mappings.date]) === filters.date : true;
      const matchOrder = filters.order ? orderCode === filters.order : true;
      const { inspector, shift, line } = getRowInspectorAndShift(r);
      const matchInspector = filters.inspector ? inspector === filters.inspector : true;
      const matchShift = filters.shift ? shift === filters.shift : true;
      const matchLine = filters.line ? line === filters.line : true;
      return matchDate && matchOrder && matchInspector && matchShift && matchLine;
    });
  }, [data, mappings, filters, getOrderCode, getRowInspectorAndShift]);

  const orderSummaryList = useMemo(() => {
    if (!mappings.date || !mappings.order || !data.length) return [];
    const map = new Map<string, any>();
    data.filter(r => !filters.date || String(r[mappings.date]) === filters.date).forEach(row => {
      const rowDate = String(row[mappings.date] || 'N/A');
      const orderCode = getOrderCode(row[mappings.order]);
      if (!orderCode) return;
      const key = `${rowDate}|||${orderCode}`;
      const { inspector, shift, line } = getRowInspectorAndShift(row);
      if (map.has(key)) {
        const existing = map.get(key);
        existing.qty++;
        existing.lineCounts[line] = (existing.lineCounts[line] || 0) + 1;
        existing.inspectors[inspector] = (existing.inspectors[inspector] || 0) + 1;
      } else {
        map.set(key, { 
          date: rowDate, 
          orderCode, 
          qty: 1, 
          lineCounts: { [line]: 1 },
          inspectors: { [inspector]: 1 }
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => parseDateToTime(b.date) - parseDateToTime(a.date) || b.qty - a.qty);
  }, [data, mappings, filters.date, getOrderCode, getRowInspectorAndShift]);

  // Group all Andon production by Line + Product (normalized)
  const andonProductionMap = useMemo<Map<string, AndonProdItem>>(() => {
    const map = new Map<string, AndonProdItem>();

    andonLines.forEach(l => {
      // Process details (historical)
      if (l.details && Array.isArray(l.details)) {
        l.details.forEach(batch => {
          const rawCode = (batch.productCode || '').trim();
          const normCode = getOrderCode(rawCode);
          if (!normCode) return;
          
          const lineName = l.name;
          const key = `${lineName}|||${normCode}`;
          const isThisBatchRunning = batch.status === 2 || batch.statusName?.toLowerCase() === 'running';
          
          if (!map.has(key)) {
            map.set(key, {
              lineName,
              productCode: normCode,
              productName: batch.productName || l.productName || '',
              andonQty: batch.actualQuantity || 0,
              isRunning: isThisBatchRunning
            });
          } else {
            const existing = map.get(key)!;
            existing.andonQty += (batch.actualQuantity || 0);
            if (!existing.productName && batch.productName) existing.productName = batch.productName;
            if (isThisBatchRunning) existing.isRunning = true;
          }
        });
      }

      // Process current active if not accounted for or needs updating
      const rawActiveCode = (l.productCode || '').trim();
      const normActiveCode = getOrderCode(rawActiveCode);
      if (normActiveCode) {
        const lineName = l.name;
        const key = `${lineName}|||${normActiveCode}`;
        const isCurrentlyRunning = l.status === 2 || l.statusName?.toLowerCase() === 'running';
        if (!map.has(key)) {
          map.set(key, {
            lineName,
            productCode: normActiveCode,
            productName: l.productName || '',
            andonQty: l.actualQuantity || 0,
            isRunning: isCurrentlyRunning
          });
        } else {
          const existing = map.get(key)!;
          if (isCurrentlyRunning) existing.isRunning = true;
        }
      }
    });
    return map;
  }, [andonLines, getOrderCode]);

  // New Combined Report Logic: All Andon production is the base
  const combinedReport = useMemo(() => {
    // 2. Map Excel data by Line + productCode (normalized)
    const excelLineMap = new Map<string, {
      inspectors: Record<string, number>;
      totalChecked: number;
    }>();

    data.filter(r => !filters.date || String(r[mappings.date]) === filters.date).forEach(row => {
      const orderCode = getOrderCode(row[mappings.order]);
      if (!orderCode) return;
      
      const { inspector, line } = getRowInspectorAndShift(row);
      const key = `${line}|||${orderCode}`;
      
      if (!excelLineMap.has(key)) {
        excelLineMap.set(key, {
          inspectors: { [inspector]: 1 },
          totalChecked: 1
        });
      } else {
        const existing = excelLineMap.get(key)!;
        existing.totalChecked++;
        existing.inspectors[inspector] = (existing.inspectors[inspector] || 0) + 1;
      }
    });

    // 3. Build combined rows based on Production Map
    const results = (Array.from(andonProductionMap.values()) as AndonProdItem[]).map(prod => {
      const key = `${prod.lineName}|||${prod.productCode}`;
      const excelInfo = excelLineMap.get(key);
      return {
        ...prod,
        inspectors: excelInfo?.inspectors || {},
        totalChecked: excelInfo?.totalChecked || 0
      };
    });

    return results.sort((a, b) => {
      const priorityA = getLinePriority(a.lineName);
      const priorityB = getLinePriority(b.lineName);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      const lineCmp = a.lineName.localeCompare(b.lineName);
      if (lineCmp !== 0) return lineCmp;

      // Rule: Within the same line, active batches (isRunning) go to the top
      if (a.isRunning !== b.isRunning) {
        return a.isRunning ? -1 : 1;
      }

      return b.andonQty - a.andonQty;
    });
  }, [andonProductionMap, data, mappings, filters.date, getOrderCode, getRowInspectorAndShift]);

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden border-l border-slate-200">
      {/* Header */}
      <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Tính Sản Lượng Excel</h2>
            {data.length > 0 && (
              <p className="text-xs text-slate-500">
                {file?.name || persistedFileName} • {data.length.toLocaleString('vi-VN')} dòng
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileChange} />
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200">
            <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <FileSpreadsheet className="w-8 h-8 text-indigo-500" />
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
            >
              Chọn file báo cáo FQC
            </button>
            <p className="mt-4 text-slate-400 text-xs font-medium">Chọn file Excel từ máy tính để xem báo cáo đối chiếu</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Quẹt FQC hôm nay</p>
                <p className="text-2xl font-black text-indigo-600">{filteredData.length.toLocaleString('vi-VN')}</p>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase">File đang dùng</p>
                <div className="flex items-center gap-1.5 mt-1 overflow-hidden">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <p className="text-xs font-black text-slate-700 truncate">{file?.name || persistedFileName}</p>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select 
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none min-w-[120px]"
                  value={filters.date}
                  onChange={(e) => setFilters(f => ({ ...f, date: e.target.value }))}
                >
                  <option value="">Tất cả ngày</option>
                  {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-xs font-bold shadow-md shadow-indigo-100 transition-all flex items-center gap-1.5"
                  title="Chọn file Excel mới từ máy tính"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Đổi file khác
                </button>
              </div>
            </div>

            {/* Tabs for switching reports */}
            <div className="flex bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
              <button 
                onClick={() => setViewMode('combined')}
                className={cn(
                  "flex-1 py-2 text-[10px] font-bold rounded-lg transition-all",
                  viewMode === 'combined' ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                BÁO CÁO ĐỐI CHIẾU (ANDON GỐC)
              </button>
              <button 
                onClick={() => setViewMode('standard')}
                className={cn(
                  "flex-1 py-2 text-[10px] font-bold rounded-lg transition-all",
                  viewMode === 'standard' ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                DANH SÁCH QUẸT FQC
              </button>
            </div>

            {viewMode === 'combined' ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left table-fixed">
                  <thead className="bg-slate-900 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-3 w-[22%]">Chuyền</th>
                      <th className="px-3 py-3 w-[28%]">Mã hàng</th>
                      <th className="px-3 py-3 text-right w-[20%]">Máy làm</th>
                      <th className="px-3 py-3 text-center w-[30%]">QUẸT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {combinedReport.map((item, idx) => {
                      const percentage = item.andonQty > 0 ? (item.totalChecked / item.andonQty) * 100 : 0;
                      
                      // Rule: 
                      // 1% for lines 15L, 20SL, 30
                      // 10% for "aures easy"
                      // 5% for others
                      const isSpecialLine = ['15L', '20SL', '30'].includes(item.lineName);
                      const isAuresEasy = item.productName.toLowerCase().includes('aures easy');
                      
                      let targetPercent = 5;
                      if (isSpecialLine) {
                        targetPercent = 1;
                      } else if (isAuresEasy) {
                        targetPercent = 5;
                      }

                      const isSufficient = percentage >= targetPercent;
                      
                      // Calculate remaining quantity
                      const requiredQty = Math.ceil((item.andonQty * targetPercent) / 100);
                      const remainingQty = Math.max(0, requiredQty - item.totalChecked);
                      
                      return (
                        <tr 
                          key={`${item.lineName}-${item.productCode}`} 
                          className={cn(
                            "hover:bg-slate-50 transition-colors",
                            item.isRunning && "bg-emerald-50/70 border-l-4 border-emerald-500"
                          )}
                        >
                          <td className="px-3 py-4 align-top">
                            <div className="flex items-center gap-2">
                              {item.isRunning && (
                                <span className="flex h-2 w-2 relative">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                              )}
                              <span className="text-lg font-black text-slate-900">{item.lineName}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(item.inspectors).map(([name, count]) => (
                                <span key={name} className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md font-bold flex items-center">
                                  {name} <span className="bg-emerald-600 text-white px-1 rounded-sm ml-1 text-[8px]">{count}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top">
                            <span className="text-base font-black text-indigo-700 block truncate" title={item.productName}>
                              {item.productCode}
                            </span>
                            <span className="text-[9px] text-slate-400 font-bold truncate block">
                              {item.productName || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-right align-top">
                            <span className="text-xl font-black text-slate-900 block">
                              {item.andonQty.toLocaleString('vi-VN')}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center align-top">
                            <div className="flex flex-col items-center gap-0">
                              <span className={cn(
                                "text-xl font-black transition-colors",
                                isSufficient ? "text-emerald-600" : "text-rose-600"
                              )}>
                                {item.totalChecked}
                              </span>
                              <span className={cn(
                                "text-[10px] font-black flex items-center gap-1",
                                isSufficient ? "text-emerald-500/70" : "text-rose-500/70"
                              )}>
                                {percentage.toFixed(1)}%
                                {!isSufficient && remainingQty > 0 && (
                                  <span className="text-rose-600 animate-pulse">(-{remainingQty})</span>
                                )}
                              </span>
                              
                              <div className="flex flex-col items-center mt-1">
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Y/C: {targetPercent}%</span>
                                  {!isSufficient && (
                                    <AlertCircle className="w-3 h-3 text-rose-500" />
                                  )}
                                  {isSufficient && (
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {combinedReport.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-slate-400 italic">
                          Không tìm thấy dữ liệu sản xuất trong ngày
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Mã Đơn</th>
                      <th className="px-4 py-3">Ngày</th>
                      <th className="px-4 py-3 text-right">Andon</th>
                      <th className="px-4 py-3 text-right">SL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orderSummaryList.map((item, idx) => {
                      // Sum all andon production for this specific order code across all lines
                      const totalAndon = (Array.from(andonProductionMap.values()) as AndonProdItem[])
                        .filter(p => p.productCode === item.orderCode)
                        .reduce((sum, p) => sum + p.andonQty, 0);

                      return (
                        <tr 
                          key={idx} 
                          className={cn(
                            "hover:bg-indigo-50/50 cursor-pointer transition-colors",
                            selectedSummaryItem?.orderCode === item.orderCode && selectedSummaryItem?.date === item.date ? "bg-indigo-50" : ""
                          )}
                          onClick={() => {
                            if (selectedSummaryItem?.orderCode === item.orderCode && selectedSummaryItem?.date === item.date) {
                              setSelectedSummaryItem(null);
                            } else {
                              setSelectedSummaryItem(item);
                            }
                          }}
                        >
                          <td className="px-4 py-3 font-black text-indigo-700 text-sm">{item.orderCode}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">{item.date}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-400 text-xs">
                            {totalAndon > 0 ? totalAndon.toLocaleString('vi-VN') : '-'}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">{item.qty}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Detail View for selected item */}
            {selectedSummaryItem && (
              <div className="bg-indigo-600 rounded-xl p-4 text-white shadow-lg space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold text-indigo-100 opacity-80">Chi tiết đơn hàng</p>
                    <h3 className="text-2xl font-black">{selectedSummaryItem.orderCode}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-indigo-100 opacity-80">Số lượng</p>
                    <p className="text-3xl font-black">{selectedSummaryItem.qty}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedSummaryItem.lineCounts || {}).map(([line, count]) => (
                    <div key={line} className="bg-white/10 rounded-lg p-2 flex justify-between items-center border border-white/10">
                      <span className="text-xs font-bold">{line}</span>
                      <span className="text-sm font-black">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};
