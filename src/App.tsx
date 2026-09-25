import { useState, useEffect, useCallback, useMemo, ChangeEvent, useRef } from 'react';
import { Calculator, X, Monitor } from 'lucide-react';
import type { LineStatus, LineFilterKey, AndonStatusResponse } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
import { LineBatchHistoryTable } from './components/LineBatchHistoryTable';
import { MasterClock } from './components/MasterClock';
import { ProductionCalculator } from './components/ProductionCalculator';
import { motion, AnimatePresence } from 'motion/react';

const BUTTON_TABS: { key: LineFilterKey; label: string }[] = [
  { key: 'ALL', label: 'TẤT CẢ' },
  { key: '15L', label: '15L' },
  { key: '20SL', label: '20SL' },
  { key: '30', label: '30' },
  { key: 'Atmor 1', label: 'Atmor 1' },
  { key: 'Atmor 2', label: 'Atmor 2' },
  { key: 'ELI', label: 'ELI' },
  { key: 'PRO', label: 'PRO' },
];

interface StatusVisual {
  type: 'running' | 'stopped' | 'break' | 'plan' | 'noplan';
  badgeColor: string;
  dotColor: string;
  dotClass: string;
  buttonClass: (isSelected: boolean) => string;
  tooltip: string;
  statusName: string;
}

function getLineStatusVisual(line?: LineStatus, label?: string): StatusVisual {
  const eventId = String(line?.eventDefId ?? '101');
  const eventName = line?.eventDefNameVn || line?.statusName || 'Không kế hoạch';
  const isRunning = line?.isRunning || eventId === '1';

  // EVENTDEF_ID = 1: Chạy (RUNNING)
  if (isRunning || eventId === '1') {
    return {
      type: 'running',
      badgeColor: '#10b981',
      dotColor: '#10b981',
      dotClass: 'bg-[#10b981] animate-pulse',
      statusName: eventName || 'Chạy',
      tooltip: `Chuyền ${label || line?.name}: Chạy (Đang sản xuất)`,
      buttonClass: (isSelected) =>
        isSelected
          ? 'bg-[#10b981] text-black font-black border-2 border-emerald-300 shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/40'
          : 'bg-emerald-500/20 text-[#10b981] border border-emerald-500/40 hover:bg-emerald-500/30',
    };
  }

  // EVENTDEF_ID = 2: Dừng (STOP / Sự cố)
  if (eventId === '2') {
    return {
      type: 'stopped',
      badgeColor: '#ef4444',
      dotColor: '#ef4444',
      dotClass: 'bg-[#ef4444] animate-ping',
      statusName: eventName || 'Dừng',
      tooltip: `Chuyền ${label || line?.name}: Dừng (${eventName})`,
      buttonClass: (isSelected) =>
        isSelected
          ? 'bg-[#ef4444] text-black font-black border-2 border-rose-300 shadow-lg shadow-rose-500/40 ring-2 ring-rose-400/40'
          : 'bg-rose-500/20 text-[#ef4444] border border-rose-500/40 hover:bg-rose-500/30',
    };
  }

  // EVENTDEF_ID = 100: Nghỉ (BREAK)
  if (eventId === '100') {
    return {
      type: 'break',
      badgeColor: '#3b82f6',
      dotColor: '#3b82f6',
      dotClass: 'bg-[#3b82f6] animate-pulse',
      statusName: eventName || 'Nghỉ',
      tooltip: `Chuyền ${label || line?.name}: Nghỉ (${eventName})`,
      buttonClass: (isSelected) =>
        isSelected
          ? 'bg-[#3b82f6] text-black font-black border-2 border-blue-300 shadow-lg shadow-blue-500/40 ring-2 ring-blue-400/40'
          : 'bg-blue-500/20 text-[#3b82f6] border border-blue-500/40 hover:bg-blue-500/30',
    };
  }

  // EVENTDEF_ID = 0: Kế hoạch (PLAN)
  if (eventId === '0') {
    return {
      type: 'plan',
      badgeColor: '#06b6d4',
      dotColor: '#06b6d4',
      dotClass: 'bg-[#06b6d4]',
      statusName: eventName || 'Kế hoạch',
      tooltip: `Chuyền ${label || line?.name}: Kế hoạch`,
      buttonClass: (isSelected) =>
        isSelected
          ? 'bg-[#06b6d4] text-black font-black border-2 border-cyan-300 shadow-lg shadow-cyan-500/40 ring-2 ring-cyan-400/40'
          : 'bg-cyan-500/20 text-[#06b6d4] border border-cyan-500/40 hover:bg-cyan-500/30',
    };
  }

  // EVENTDEF_ID = 101 hoặc không có kế hoạch
  return {
    type: 'noplan',
    badgeColor: '#64748b',
    dotColor: '#64748b',
    dotClass: 'hidden',
    statusName: eventName || 'Không kế hoạch',
    tooltip: `Chuyền ${label || line?.name}: Không kế hoạch`,
    buttonClass: (isSelected) =>
      isSelected
        ? 'bg-slate-200 text-black font-black border-2 border-white shadow-lg shadow-slate-900/40'
        : 'bg-slate-800/50 text-slate-400 border border-slate-700/60 hover:bg-slate-800 hover:text-slate-300',
  };
}

export default function App() {
  const [selectedTab, setSelectedTab] = useState<LineFilterKey>('ALL');
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [showCalculator, setShowCalculator] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const headerFileInputRef = useRef<HTMLInputElement>(null);

  const closeCalculator = useCallback(() => {
    setShowCalculator(false);
    setSelectedFile(null);
    if (headerFileInputRef.current) {
      headerFileInputRef.current.value = '';
    }
  }, []);

  const getCleanOrderCode = useCallback((val: string | undefined | null) => {
    if (!val) return '';
    const str = val.trim();
    return str.length >= 7 ? str.substring(0, 7) : str;
  }, []);

  const andonTotalsByProduct = useMemo(() => {
    // 1. Group by Line + ProductCode to get accurate per-line totals first (to avoid overcounting)
    const lineProductMap = new Map<string, number>();
    
    lines.forEach(l => {
      const lineName = l.name;
      
      // Process historical details
      if (l.details && Array.isArray(l.details)) {
        l.details.forEach(batch => {
          const code = getCleanOrderCode(batch.productCode);
          if (code) {
            const key = `${lineName}|||${code}`;
            lineProductMap.set(key, (lineProductMap.get(key) || 0) + (batch.actualQuantity || 0));
          }
        });
      }
      
      // Process current active batch (only if not already fully accounted for in details for this specific line)
      const activeCode = getCleanOrderCode(l.productCode);
      if (activeCode) {
        const key = `${lineName}|||${activeCode}`;
        if (!lineProductMap.has(key)) {
          lineProductMap.set(key, l.actualQuantity || 0);
        }
      }
    });

    // 2. Sum up the per-line totals by ProductCode
    const finalMap = new Map<string, number>();
    lineProductMap.forEach((qty, key) => {
      const productCode = key.split('|||')[1];
      finalMap.set(productCode, (finalMap.get(productCode) || 0) + qty);
    });

    return Array.from(finalMap.entries())
      .filter(([_, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [lines, getCleanOrderCode]);

  const handleHeaderFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setSelectedFile(e.target.files[0]);
      setShowCalculator(true);
      // Reset input value so the same file can be selected again later
    }
  };

  const formatTimeHMSS = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/andon/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AndonStatusResponse = await res.json();
      if (data?.lines) {
        setLines(data.lines);
        // Cập nhật mốc thời gian đồng bộ
        setLastSyncTime(formatTimeHMSS(new Date()));
      }
    } catch (err) {
      console.error('Lỗi khi cập nhật dữ liệu Andon:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Chu kỳ làm mới 3 giây tự động, không tải lại trang
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Lọc dữ liệu hiển thị cho trang TẤT CẢ: CHỈ HIỂN THỊ CÁC DÒNG PRODUCT_CODE CÓ STATUS = 2
  const onlineLines = useMemo(() => {
    return lines.filter((l) => {
      return Boolean(l.productCode) && (l.status === 2 || l.details?.some((d) => d.status === 2));
    });
  }, [lines]);

  // Chuyền được chọn khi ở các trang chuyền riêng lẻ
  const selectedLine = useMemo(() => {
    return lines.find((l) => l.key === selectedTab);
  }, [lines, selectedTab]);

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-slate-800 font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {/* Thanh nút lọc trên cùng nền tối theo chuẩn thiết kế kèm Đồng hồ thời gian chuẩn */}
      <header className="bg-[#0b1120] border-b border-slate-900 px-4 py-2.5 sm:px-6 shadow-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto flex flex-row items-center justify-between gap-2">
          {/* Danh sách nút chọn chuyền */}
          <div className="flex-1 flex items-center gap-1.5 min-w-0 mx-4">
            {BUTTON_TABS.map((tab) => {
              const isAll = tab.key === 'ALL';
              const isSelected = selectedTab === tab.key;
              const lineInfo = lines.find((l) => l.key === tab.key);
              const visual = isAll ? null : getLineStatusVisual(lineInfo, tab.label);

              if (isAll) {
                const activeClass = isSelected
                  ? 'bg-[#818cf8] text-black font-black border-2 border-indigo-200 shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-400/40'
                  : 'bg-indigo-500/20 text-[#a5b4fc] border border-indigo-500/40 hover:bg-indigo-500/30';

                return (
                  <button
                    key={tab.key}
                    id={`tab-${tab.key}`}
                    onClick={() => setSelectedTab(tab.key)}
                    title="Hiển thị tất cả các chuyền đang chạy trực tuyến"
                    className={`flex-1 relative flex items-center justify-center h-10 rounded-lg font-black text-xs sm:text-sm tracking-wide transition-all duration-200 cursor-pointer whitespace-nowrap select-none ${activeClass}`}
                  >
                    {tab.label}
                    {isSelected && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-black rounded-full ring-2 ring-[#0b1120] animate-pulse" />
                    )}
                  </button>
                );
              }

              const buttonStyle = visual ? visual.buttonClass(isSelected) : '';
              const showDot = visual && visual.type !== 'noplan';

              return (
                <button
                  key={tab.key}
                  id={`tab-${tab.key.replace(/\s+/g, '-')}`}
                  onClick={() => setSelectedTab(tab.key)}
                  title={visual?.tooltip}
                  className={`flex-1 relative flex items-center justify-center h-10 rounded-lg font-black text-xs sm:text-sm tracking-tight transition-all duration-200 cursor-pointer whitespace-nowrap select-none ${buttonStyle}`}
                >
                  {tab.label}
                  {showDot && (
                    <span
                      className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full ring-2 ring-[#0b1120] ${
                        isSelected ? 'bg-black animate-pulse' : visual.dotClass
                      }`}
                      title={visual.tooltip}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Đồng hồ thời gian chuẩn tuyệt đối của hệ thống */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              type="file"
              ref={headerFileInputRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleHeaderFileSelect}
            />
            <button
              onClick={() => {
                if (!showCalculator) {
                  headerFileInputRef.current?.click();
                } else {
                  closeCalculator();
                }
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all duration-200 border ${
                showCalculator 
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/40' 
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {showCalculator ? <Monitor className="w-4 h-4" /> : <Calculator className="w-4 h-4" />}
              <span className="hidden xl:inline">{showCalculator ? 'Đóng Công Cụ' : 'Tính Sản Lượng Excel'}</span>
              <span className="hidden sm:inline xl:hidden">{showCalculator ? 'Đóng' : 'Excel'}</span>
            </button>
            <MasterClock />
          </div>
        </div>
      </header>

      {/* Vùng nội dung chính */}
      <div className="flex-1 flex overflow-hidden">
        <main className={`flex-1 transition-all duration-500 ease-in-out overflow-y-auto ${showCalculator ? 'w-full lg:w-3/4' : 'w-full'}`}>
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6">
            {selectedTab === 'ALL' ? (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Bảng chuyền đang chạy trực tuyến */}
                <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200/90 overflow-hidden">
                  {/* Tiêu đề danh sách */}
                  <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full bg-[#10b981] inline-block shadow-sm shadow-emerald-500/50 animate-pulse" />
                      <h1 className="text-sm sm:text-base font-extrabold tracking-wider text-slate-800 uppercase">
                        DANH SÁCH CHUYỀN ĐANG CHẠY TRỰC TUYẾN
                      </h1>
                    </div>

                    {/* Thông báo chu kỳ cập nhật ngầm 3s */}
                    <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping" />
                      <span>Cập nhật ngầm 3s {lastSyncTime ? `• ${lastSyncTime}` : ''}</span>
                    </div>
                  </div>

                  {/* Bảng dữ liệu sản lượng */}
                  <div className="overflow-x-auto px-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-white text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider select-none">
                          <th scope="col" className="py-2.5 pl-6 sm:pl-8 pr-3 w-16 sm:w-20">
                            STT
                          </th>
                          <th scope="col" className="py-2.5 px-3 w-44 sm:w-56">
                            DÂY CHUYỀN
                          </th>
                          <th scope="col" className="py-2.5 px-3 text-center w-52 sm:w-64">
                            KHUNG GIỜ
                          </th>
                          <th scope="col" className="py-2.5 px-3 text-center w-52 sm:w-64">
                            MÃ SẢN PHẨM
                          </th>
                          <th scope="col" className="py-2.5 px-3 text-center w-40 sm:w-48">
                            CÒN LẠI
                          </th>
                          <th scope="col" className="py-2.5 pl-3 pr-6 sm:pr-8 text-right w-44 sm:w-56">
                            SẢN LƯỢNG
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {isLoading && lines.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-slate-400 font-medium">
                              <div className="inline-flex items-center gap-3">
                                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm">Đang tải dữ liệu trực tiếp từ máy chủ Andon...</span>
                              </div>
                            </td>
                          </tr>
                        ) : onlineLines.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-slate-400 font-medium text-sm">
                              Hiện tại không có mã sản phẩm nào đang chạy (STATUS = 2).
                            </td>
                          </tr>
                        ) : (
                          onlineLines.map((line, idx) => {
                            const rowVisual = getLineStatusVisual(line);
                            const remaining = (line.planQuantity || 0) - (line.actualQuantity || 0);
                            
                            return (
                              <tr
                                key={line.id}
                                id={`line-row-${line.key.replace(/\s+/g, '-')}`}
                                onClick={() => setSelectedTab(line.key as LineFilterKey)}
                                className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                                title={`Bấm để xem lịch sử lô hàng của chuyền ${line.name}`}
                              >
                                {/* STT */}
                                <td className="py-2.5 pl-6 sm:pl-8 pr-3 font-bold text-lg sm:text-xl text-slate-400 align-middle">
                                  {idx + 1}
                                </td>

                                {/* DÂY CHUYỀN */}
                                <td className="py-2.5 px-3 align-middle">
                                  <div className="flex items-center gap-3">
                                    <span
                                      className={`w-3 h-3 rounded-full shrink-0 ${
                                        rowVisual.type === 'running'
                                          ? 'bg-[#10b981] shadow-sm shadow-emerald-400'
                                          : rowVisual.type === 'stopped'
                                          ? 'bg-[#ef4444] shadow-sm shadow-red-400 animate-ping'
                                          : rowVisual.type === 'break'
                                          ? 'bg-[#3b82f6]'
                                          : 'bg-slate-300'
                                      }`}
                                      title={rowVisual.statusName}
                                    />
                                    <span className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                                      {line.name}
                                    </span>
                                  </div>
                                </td>

                                {/* KHUNG GIỜ */}
                                <td className="py-2.5 px-3 text-center align-middle">
                                  <span className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight tabular-nums">
                                    {line.timeRange || '--:--'}
                                  </span>
                                </td>

                                {/* MÃ SẢN PHẨM */}
                                <td className="py-2.5 px-3 text-center align-middle">
                                  <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-xl sm:text-2xl font-black text-[#4338ca] tracking-tight tabular-nums">
                                      {line.productCode || '--'}
                                    </span>
                                    {line.productName && (
                                      <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 italic truncate max-w-[150px] sm:max-w-[200px]" title={line.productName}>
                                        {line.productName}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* CÒN LẠI */}
                                <td className="py-2.5 px-3 text-center align-middle">
                                  <div className="flex flex-col items-center gap-1 min-w-[100px]">
                                    <span className={cn(
                                      "text-xs font-black tabular-nums leading-none",
                                      remaining > 0 ? 'text-orange-600' : remaining === 0 ? 'text-slate-400' : 'text-emerald-600'
                                    )}>
                                      {remaining.toLocaleString('vi-VN')}
                                    </span>
                                    <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200 relative">
                                      <div 
                                        className={cn(
                                          "h-full transition-all duration-500",
                                          remaining > 0 ? 'bg-orange-500' : 'bg-emerald-500'
                                        )}
                                        style={{ width: `${Math.min(((line.actualQuantity || 0) / (line.planQuantity || 1)) * 100, 100)}%` }}
                                      />
                                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-black">
                                        {Math.round(((line.actualQuantity || 0) / (line.planQuantity || 1)) * 100)}%
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* SẢN LƯỢNG (Thực tế / Kế hoạch) */}
                                <td className="py-2.5 pl-3 pr-6 sm:pr-8 text-right align-middle">
                                  <span className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight tabular-nums">
                                    {line.actualQuantity}/{line.planQuantity}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Danh sách tổng sản lượng tinh gọn (bên phải) */}
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 flex flex-col h-fit">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                    <h2 className="text-xs sm:text-sm font-black tracking-wider text-slate-800 uppercase">
                      Tổng sản lượng Andon
                    </h2>
                  </div>

                  {andonTotalsByProduct.length === 0 ? (
                    <p className="text-xs text-slate-400 font-medium py-6 text-center">Chưa ghi nhận sản lượng</p>
                  ) : (
                    <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                      {andonTotalsByProduct.map(([code, qty]) => (
                        <div key={code} className="flex items-center justify-between py-2 px-3 bg-slate-50 hover:bg-indigo-50/50 rounded-xl transition-all border border-slate-100">
                          <span className="text-sm font-black text-indigo-700 tracking-tight">{code}</span>
                          <span className="text-xs font-black text-slate-800 bg-slate-200/60 px-2 py-1 rounded-lg tabular-nums">
                            {qty.toLocaleString('vi-VN')} pcs
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
          /* TRANG DÂY CHUYỀN: CHỈ HIỂN THỊ BẢNG LỊCH SỬ LÔ HÀNG CỦA CHUYỀN ĐÓ */
          <LineBatchHistoryTable
            lineName={selectedLine?.name || String(selectedTab)}
            details={selectedLine?.details || []}
            isLoading={isLoading}
          />
        )}
          </div>
        </main>

        <AnimatePresence>
          {showCalculator && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed lg:relative inset-y-0 right-0 w-full lg:w-1/4 z-40 bg-white shadow-2xl lg:shadow-none"
            >
              <ProductionCalculator 
                initialFile={selectedFile} 
                andonLines={lines}
                onClose={closeCalculator} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

