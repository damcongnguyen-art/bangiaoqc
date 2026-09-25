import React, { useMemo } from 'react';
import { LineBatchDetail } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LineBatchHistoryTableProps {
  lineName: string;
  details?: LineBatchDetail[];
  isLoading?: boolean;
}

export const LineBatchHistoryTable: React.FC<LineBatchHistoryTableProps> = ({
  lineName,
  details = [],
  isLoading = false,
}) => {
  // Calculate summary of production by product code for this line
  const summaryData = useMemo(() => {
    const map = new Map<string, number>();
    
    details.forEach(item => {
      if (item.productCode) {
        const currentQty = map.get(item.productCode) || 0;
        map.set(item.productCode, currentQty + (item.actualQuantity || 0));
      }
    });

    return Array.from(map.entries())
      .filter(([_, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [details]);

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 overflow-hidden">
        {/* Tiêu đề bảng */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#00a359] inline-block shadow-xs shadow-emerald-500/40" />
            <h2 className="text-sm sm:text-base font-black tracking-wide text-slate-900 uppercase">
              LỊCH SỬ LÔ HÀNG CỦA DÂY CHUYỀN {lineName ? lineName.toUpperCase() : ''}
            </h2>
          </div>
          <div className="text-[10px] sm:text-xs text-slate-400 font-medium">
            Dữ liệu trực tiếp từ MES_MSG_LINE_DETAIL
          </div>
        </div>

        {/* Bảng dữ liệu theo đúng mẫu ảnh */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-white text-slate-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider select-none">
                <th scope="col" className="py-2.5 px-4 text-center w-[20%]">
                  GIỜ CHẠY
                </th>
                <th scope="col" className="py-2.5 px-4 text-center w-[25%]">
                  MÃ SP
                </th>
                <th scope="col" className="py-2.5 px-4 text-center w-[20%]">
                  CÒN LẠI
                </th>
                <th scope="col" className="py-2.5 px-4 text-center w-[20%]">
                  SẢN LƯỢNG
                </th>
                <th scope="col" className="py-2.5 px-4 text-center w-[15%]">
                  TRẠNG THÁI
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/90">
              {isLoading && details.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400 font-medium">
                    <div className="inline-flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Đang tải lịch sử lô hàng...</span>
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400 font-medium text-sm">
                    Chuyền {lineName} hiện chưa có lịch sử lô hàng nào trong ca làm việc.
                  </td>
                </tr>
              ) : (
                details.map((item, idx) => {
                  const isRunning = item.status === 2 || item.statusName?.toLowerCase() === 'running';
                  const isFinished = item.status === 3 || item.statusName?.toLowerCase() === 'finished';
                  const remaining = (item.planQuantity || 0) - (item.actualQuantity || 0);

                  return (
                    <tr
                      key={item.id || idx}
                      id={`batch-row-${idx}`}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      {/* CỘT 1: GIỜ CHẠY */}
                      <td className="py-1.5 px-4 text-center align-middle">
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="text-base sm:text-lg font-extrabold text-slate-800 tracking-tight tabular-nums">
                            {item.timeRange || '--:--'}
                          </span>
                          {item.durationHours && (
                            <span className="text-[10px] sm:text-[11px] font-medium text-slate-400">
                              {item.durationHours.toString().replace(/[()]/g, '')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CỘT 2: MÃ SP */}
                      <td className="py-1.5 px-4 text-center align-middle">
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="text-base sm:text-lg font-black text-slate-950 tracking-tight tabular-nums">
                            {item.productCode || '--'}
                          </span>
                          {item.productName && (
                            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 italic truncate max-w-[150px] sm:max-w-[200px]" title={item.productName}>
                              {item.productName}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CỘT 3: CÒN LẠI */}
                      <td className="py-1.5 px-4 text-center align-middle">
                        <div className="flex flex-col items-center gap-1 min-w-[100px]">
                          <span className={cn(
                            "text-[10px] sm:text-[11px] font-black tabular-nums leading-none",
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
                              style={{ width: `${Math.min(((item.actualQuantity || 0) / (item.planQuantity || 1)) * 100, 100)}%` }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-black">
                              {Math.round(((item.actualQuantity || 0) / (item.planQuantity || 1)) * 100)}%
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* CỘT 4: SẢN LƯỢNG */}
                      <td className="py-1.5 px-4 text-center align-middle">
                        <span className="text-base sm:text-lg font-black text-slate-950 tracking-tight tabular-nums">
                          {item.actualQuantity}/{item.planQuantity}
                        </span>
                      </td>

                      {/* CỘT 5: TRẠNG THÁI */}
                      <td className="py-1.5 px-4 text-center align-middle">
                        <div className="flex items-center justify-center">
                          {isRunning ? (
                            <span className="inline-flex items-center justify-center px-3 sm:px-4 py-0.5 rounded-full bg-[#eaf8f0] text-[#00a359] font-black text-sm sm:text-base tracking-wide shadow-xs border border-emerald-100">
                              Running
                            </span>
                          ) : isFinished ? (
                            <span className="inline-flex items-center justify-center px-3 sm:px-4 py-0.5 rounded-full bg-[#edf2f7] text-[#2d3748] font-black text-sm sm:text-base tracking-wide">
                              Finished
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center px-3 sm:px-4 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold text-xs sm:text-sm tracking-wide">
                              {item.statusName || 'Kế hoạch'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BẢNG TỔNG HỢP SẢN LƯỢNG THEO MÃ HÀNG */}
      {!isLoading && summaryData.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 overflow-hidden self-start min-w-[300px]">
          <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              <h3 className="text-xs sm:text-sm font-black tracking-wider text-slate-800 uppercase">
                TỔNG HỢP SẢN LƯỢNG THEO MÃ HÀNG
              </h3>
            </div>
          </div>
          <div className="p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <th className="py-2 px-6 text-left">MÃ SẢN PHẨM</th>
                  <th className="py-2 px-6 text-right">TỔNG SẢN LƯỢNG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {summaryData.map(([code, qty]) => (
                  <tr key={code} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-6 text-sm font-black text-indigo-700 tracking-tight">{code}</td>
                    <td className="py-3 px-6 text-right text-base font-black text-slate-900 tabular-nums">
                      {qty.toLocaleString('vi-VN')} <span className="text-[10px] text-slate-400 ml-1">pcs</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

