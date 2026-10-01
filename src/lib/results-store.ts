// 听读对账数据的本地持久化：结果、待确认项、学情、补练清单与角色。
// 关掉页面再回来仍保留确认与冲突状态。

import type { LearningRecord, ListeningResult, PackageLogEntry, PendingItem } from './results';
import type { RemedialPlan } from './remedial';

const STORAGE_KEY = 'sologsb-1026-results-v1';

export interface ResultsPersistShape {
  version: number;
  role: 'teacher' | 'leader';
  results: ListeningResult[];
  pending: PendingItem[];
  learning: LearningRecord[];
  packages: PackageLogEntry[];
  plans: RemedialPlan[];
}

export const emptyResultsState: ResultsPersistShape = {
  version: 1,
  role: 'teacher',
  results: [],
  pending: [],
  learning: [],
  packages: [],
  plans: []
};

export function loadResultsState(): ResultsPersistShape {
  if (typeof localStorage === 'undefined') return { ...emptyResultsState };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyResultsState };
    const parsed = JSON.parse(raw) as Partial<ResultsPersistShape>;
    return {
      version: 1,
      role: parsed.role === 'leader' ? 'leader' : 'teacher',
      results: Array.isArray(parsed.results) ? parsed.results : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      learning: Array.isArray(parsed.learning) ? parsed.learning : [],
      packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans : []
    };
  } catch {
    return { ...emptyResultsState };
  }
}

export function saveResultsState(state: ResultsPersistShape): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearResultsState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
