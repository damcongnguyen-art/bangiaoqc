import React from 'react';
import { Clock, Calendar } from 'lucide-react';

interface MasterClockProps {}

export const MasterClock: React.FC<MasterClockProps> = () => {
  const [currentTime, setCurrentTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = String(currentTime.getHours()).padStart(2, '0');
  const minutes = String(currentTime.getMinutes()).padStart(2, '0');
  const seconds = String(currentTime.getSeconds()).padStart(2, '0');
  const timeString = `${hours}:${minutes}:${seconds}`;

  const day = String(currentTime.getDate()).padStart(2, '0');
  const month = String(currentTime.getMonth() + 1).padStart(2, '0');
  const year = currentTime.getFullYear();
  const dateString = `${day}/${month}/${year}`;

  const daysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const dayName = daysOfWeek[currentTime.getDay()];

  return (
    <div
      id="master-header-clock"
      className="bg-slate-900/90 border border-slate-700/80 rounded-xl px-4 py-1 flex flex-col items-center justify-center shadow-inner text-white select-none shrink-0 backdrop-blur-sm min-w-[140px]"
      title="Đồng hồ thời gian chuẩn của hệ thống"
    >
      {/* Cụm Giờ Phút Giây - Dòng trên */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center justify-center text-emerald-400">
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
        </div>
        <div className="font-mono font-black text-lg sm:text-xl text-emerald-400 tracking-widest tabular-nums leading-none">
          {timeString}
        </div>
      </div>

      {/* Cụm Ngày Tháng Năm - Dòng dưới */}
      <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold text-slate-400 border-t border-slate-800/60 w-full justify-center mt-0.5 pt-0.5">
        <span>{dayName}</span>
        <span className="opacity-40">•</span>
        <span className="text-slate-300 tabular-nums">{dateString}</span>
      </div>
    </div>
  );
};
