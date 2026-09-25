export interface LineBatchDetail {
  id: string;
  lineId: string;
  started: string;
  finished: string;
  timeRange: string;
  durationHours: string;
  productCode: string;
  productName: string;
  planQuantity: number;
  actualQuantity: number;
  status: number;
  statusName: string;
}

export interface LineStatus {
  id: number;
  key: string;
  name: string;
  isRunning: boolean;
  eventDefId: string;
  eventDefNameVn: string;
  statusName: string;
  statusColor: string;
  productCode: string;
  productName: string;
  actualQuantity: number;
  planQuantity: number;
  timeRange: string;
  uph?: number;
  oee?: number;
  updatedAt?: string;
  status?: number;
  details?: LineBatchDetail[];
}

export interface AndonStatusResponse {
  success: boolean;
  lastUpdated: string;
  lines: LineStatus[];
  warning?: string;
}

export type LineFilterKey = 'ALL' | '15L' | '20SL' | '30L' | 'Atmor 1' | 'Atmor 2' | 'ELI' | 'PRO';
