import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export interface FactoryLineConfig {
  id: number;
  key: string;
  name: string;
}

const FACTORY_LINES: FactoryLineConfig[] = [
  { id: 1, key: '15L', name: '15L' },
  { id: 2, key: '20SL', name: '20SL' },
  { id: 4, key: '30L', name: '30L' },
  { id: 7, key: 'Atmor 1', name: 'Atmor 1' },
  { id: 8, key: 'Atmor 2', name: 'Atmor 2' },
  { id: 11, key: 'ELI', name: 'ELI' },
  { id: 9, key: 'PRO', name: 'PRO' },
];

interface CachedState {
  timestamp: number;
  data: any;
}

let cache: CachedState | null = null;
const CACHE_TTL_MS = 1500; // 1.5 second cache to ensure fast 3s polling without hammering upstream

async function fetchLineDataFromMes(lineId: number, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    // Tăng timeout lên 10s để ổn định hơn
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch('https://andon-vn.aristongroup.com/Mes_Msg_Statistic/Load_Msg_Line', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: `LineId=${lineId}`,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      return json;
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
      
      if (i < retries) {
        // Chờ một chút trước khi thử lại (exponential backoff nhẹ)
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      
      console.error(`Error fetching line ${lineId} (final attempt):`, err.message);
      return null;
    }
  }
}

// API endpoint to get all running and registered lines for the dashboard
app.get('/api/andon/status', async (req, res) => {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return res.json(cache.data);
  }

  try {
    const lines: any[] = [];
    
    // Chuyển sang chạy tuần tự (Sequential) để tránh làm nghẽn máy chủ Ariston
    // và giảm tỷ lệ bị "Aborted" khi gửi quá nhiều request cùng lúc
    for (const cfg of FACTORY_LINES) {
      const raw = await fetchLineDataFromMes(cfg.id);
      const lineData = raw?.EXCEPTION_DATA?.MES_MSG_LINE?.[0];
      const details = raw?.EXCEPTION_DATA?.MES_MSG_LINE_DETAIL || [];

      // Find active running batch with STATUS === 2
      const runningDetail = details.find((d: any) => d.STATUS === 2 || d.STATUS_NAME === 'Running');
      const currentDetail = runningDetail 
        || (lineData?.EVENTDEF_NAME_EN === 'RUNNING' && details.length > 0 ? details[details.length - 1] : null);

      const isRunning = lineData?.EVENTDEF_NAME_EN === 'RUNNING' || String(lineData?.EVENTDEF_ID) === '1';

      // Status of the current product batch: 2 means currently running
      const productStatus = runningDetail 
        ? 2 
        : (lineData?.STATUS === 2 ? 2 : (currentDetail?.STATUS ? Number(currentDetail.STATUS) : 0));

      const activeDetail = runningDetail || currentDetail;

      let timeRange = '--:--';
      if (activeDetail?.STARTED) {
        const start = activeDetail.STARTED.substring(11, 16);
        const finish = activeDetail.FINISHED ? activeDetail.FINISHED.substring(11, 16) : '--:--';
        timeRange = `${start}-${finish}`;
      }

      const productCode = activeDetail?.PRODUCT_CODE || lineData?.PRODUCT_CODE || '';
      const productName = activeDetail?.PRODUCT_NAME || lineData?.PRODUCT_NAME || '';
      const actual = activeDetail?.ACTUAL_QUANTITY ?? lineData?.ACTUAL_QUANTITY ?? 0;
      const plan = activeDetail?.PLAN_QUANTITY ?? lineData?.PLAN_QUANTITY ?? 0;

      const eventDefId = String(lineData?.EVENTDEF_ID ?? (isRunning ? '1' : '101'));
      const eventDefNameVn = lineData?.EVENTDEF_NAME_VN || (isRunning ? 'Chạy' : 'Không kế hoạch');
      const statusColor = lineData?.EVENTDEF_COLOR || (isRunning ? '#22b23c' : '#64748b');

      // Process batch history details (MES_MSG_LINE_DETAIL)
      const formattedDetails = details.map((d: any) => {
        let batchTimeRange = '--:--';
        let durationHours = '';

        if (d.STARTED) {
          const start = d.STARTED.substring(11, 16);
          const finish = d.FINISHED ? d.FINISHED.substring(11, 16) : '--:--';
          batchTimeRange = `${start}-${finish}`;

          if (d.FINISHED) {
            try {
              const startMs = new Date(d.STARTED).getTime();
              const finishMs = new Date(d.FINISHED).getTime();
              const diffHours = (finishMs - startMs) / (1000 * 60 * 60);
              if (diffHours > 0) {
                const rounded = Number(diffHours.toFixed(2));
                durationHours = `(${rounded}h)`;
              }
            } catch (e) {
              // ignore
            }
          }
        }

        return {
          id: d.REPORT_LINE_DETAIL_ID || String(Math.random()),
          lineId: String(d.LINE_ID || cfg.id),
          started: d.STARTED || '',
          finished: d.FINISHED || '',
          timeRange: batchTimeRange,
          durationHours,
          productCode: d.PRODUCT_CODE || '',
          productName: d.PRODUCT_NAME || '',
          planQuantity: d.PLAN_QUANTITY || 0,
          actualQuantity: d.ACTUAL_QUANTITY || 0,
          status: d.STATUS || 0,
          statusName: d.STATUS_NAME || (d.STATUS === 2 ? 'Running' : d.STATUS === 3 ? 'Finished' : 'Waiting'),
        };
      });

      lines.push({
        id: cfg.id,
        key: cfg.key,
        name: cfg.name,
        isRunning,
        eventDefId,
        eventDefNameVn,
        statusName: eventDefNameVn,
        statusColor,
        productCode,
        productName,
        actualQuantity: actual,
        planQuantity: plan,
        timeRange,
        status: productStatus,
        uph: lineData?.UPH ?? 0,
        oee: lineData?.OEE ?? 0,
        updatedAt: lineData?.TIME_UPDATED || new Date().toISOString(),
        details: formattedDetails,
      });
    }
    const responsePayload = {
      success: true,
      lastUpdated: new Date().toISOString(),
      lines,
    };

    cache = {
      timestamp: now,
      data: responsePayload,
    };

    return res.json(responsePayload);
  } catch (error: any) {
    console.error('Server error in /api/andon/status:', error);
    if (cache) {
      // Return previous valid cache on error
      return res.json({ ...cache.data, warning: 'Sử dụng dữ liệu đệm gần nhất' });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Direct single line proxy endpoint
app.post('/api/andon/load_msg_line', async (req, res) => {
  const lineId = req.body.LineId || req.query.LineId || 2;
  try {
    const raw = await fetchLineDataFromMes(Number(lineId));
    if (!raw) {
      return res.status(502).json({ error: 'Không thể kết nối đến máy chủ Ariston Andon' });
    }
    return res.json(raw);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
