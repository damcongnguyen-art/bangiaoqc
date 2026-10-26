import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase Admin
let db: any = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  
  admin.initializeApp({
    projectId: config.projectId,
  });
  db = (admin as any).firestore();
  console.log('Firebase Admin initialized successfully');
} catch (err) {
  console.error('Failed to initialize Firebase Admin:', err);
}

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

// Helper to get Production Date (DD/MM/YYYY)
// If before 6 AM, it belongs to the previous calendar day
function getProductionDate() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 6) {
    now.setDate(now.getDate() - 1);
  }
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function fetchLineDataFromMes(lineId: number, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
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
      if (i < retries) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      console.error(`Error fetching line ${lineId} (final attempt):`, err.message);
      return null;
    }
  }
}

async function getFormattedStatus() {
  const lines: any[] = [];
  for (const cfg of FACTORY_LINES) {
    const raw = await fetchLineDataFromMes(cfg.id);
    const lineData = raw?.EXCEPTION_DATA?.MES_MSG_LINE?.[0];
    const details = raw?.EXCEPTION_DATA?.MES_MSG_LINE_DETAIL || [];

    const runningDetail = details.find((d: any) => d.STATUS === 2 || d.STATUS_NAME === 'Running');
    const currentDetail = runningDetail 
      || (lineData?.EVENTDEF_NAME_EN === 'RUNNING' && details.length > 0 ? details[details.length - 1] : null);

    const isRunning = lineData?.EVENTDEF_NAME_EN === 'RUNNING' || String(lineData?.EVENTDEF_ID) === '1';
    const productStatus = runningDetail ? 2 : (lineData?.STATUS === 2 ? 2 : (currentDetail?.STATUS ? Number(currentDetail.STATUS) : 0));
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
            if (diffHours > 0) durationHours = `(${diffHours.toFixed(2)}h)`;
          } catch (e) {}
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
  return {
    success: true,
    lastUpdated: new Date().toISOString(),
    lines,
  };
}

// Background sync for production history
// Golden Window: 05:58 - 05:59 AM
async function syncProductionHistory() {
  if (!db) return;
  
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  
  if (hour === 5 && (min === 58 || min === 59)) {
    console.log(`Golden Window detected (${hour}:${min}). Syncing to Firestore...`);
    try {
      const status = await getFormattedStatus();
      const prodDate = getProductionDate();
      
      const batch = db.batch();
      status.lines.forEach((line: any) => {
        // Current active product
        if (line.productCode) {
          const docId = `${prodDate}_${line.name}_${line.productCode}`.replace(/\//g, '-');
          const docRef = db!.collection('production_history').doc(docId);
          batch.set(docRef, {
            date: prodDate,
            lineName: line.name,
            productCode: line.productCode,
            productName: line.productName,
            andonQty: line.actualQuantity,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
        
        // Also sync batch history for the same day
        line.details.forEach((detail: any) => {
          if (detail.productCode && detail.actualQuantity > 0) {
            const docId = `${prodDate}_${line.name}_${detail.productCode}`.replace(/\//g, '-');
            const docRef = db!.collection('production_history').doc(docId);
            batch.set(docRef, {
              date: prodDate,
              lineName: line.name,
              productCode: detail.productCode,
              productName: detail.productName,
              andonQty: detail.actualQuantity,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        });
      });
      
      await batch.commit();
      console.log(`Successfully synced production history for ${prodDate}`);
    } catch (err) {
      console.error('Error in background sync:', err);
    }
  }
}

// Run sync check every minute
setInterval(syncProductionHistory, 60 * 1000);

app.get('/api/andon/status', async (req, res) => {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return res.json(cache.data);
  }

  try {
    const responsePayload = await getFormattedStatus();
    cache = { timestamp: now, data: responsePayload };
    return res.json(responsePayload);
  } catch (error: any) {
    console.error('Server error in /api/andon/status:', error);
    if (cache) return res.json({ ...cache.data, warning: 'Sử dụng dữ liệu đệm gần nhất' });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// History endpoint for FQC Check
app.get('/api/production-history', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  
  const date = req.query.date as string; // Expecting DD/MM/YYYY
  if (!date) return res.status(400).json({ error: 'Date is required' });
  
  try {
    const snapshot = await db.collection('production_history')
      .where('date', '==', date)
      .get();
    
    const history = snapshot.docs.map(doc => doc.data());
    return res.json({ success: true, date, history });
  } catch (err: any) {
    console.error('Error fetching history:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/andon/load_msg_line', async (req, res) => {
  const lineId = req.body.LineId || req.query.LineId || 2;
  try {
    const raw = await fetchLineDataFromMes(Number(lineId));
    if (!raw) return res.status(502).json({ error: 'Không thể kết nối đến máy chủ Ariston Andon' });
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
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
}

start();
