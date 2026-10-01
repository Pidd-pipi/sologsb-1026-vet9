// 课堂听读结果包 × 自然拼读课程：跨系统对账核心逻辑
// 纯函数 + localStorage 状态结构，页面只负责渲染与调度。

export type Role = 'teacher' | 'leader';

export interface ListeningResultInput {
  studentId?: string;
  studentNo?: string;
  activityId?: string;
  activityNo?: string;
  name?: string;
  date?: string;
  phonemes?: string[] | string;
  score?: number | string;
  mastery?: boolean | string;
  sourceId?: string;
  recordId?: string;
}

export interface ResultPackageInput {
  packageId?: string;
  label?: string;
  exportedAt?: string;
  source?: string;
  results?: ListeningResultInput[];
}

export interface StoredResult {
  id: string;
  packageId: string;
  packageLabel: string;
  studentId: string;
  activityId: string;
  name: string;
  date: string;
  phonemes: string[];
  score: number;
  passed: boolean;
  sourceRecordId: string;
  importedAt: string;
  // 修订链：被后续结果包覆盖时保留旧值，用于审计“失效重算”
  supersededBy?: string;
  history: Array<{ date: string; score: number; packageId: string; packageLabel: string; at: string }>;
}

export type PendingKind = 'identity' | 'conflict' | 'prerequisite';
export type PendingStatus = 'open' | 'resolved';

export interface PendingItem {
  id: string;
  kind: PendingKind;
  status: PendingStatus;
  createdAt: string;
  updatedAt: string;
  // identity：缺学生编号或活动编号，需要用姓名/日期/音素人工确认
  resultIds: string[];
  studentId: string;
  activityId: string;
  name: string;
  date: string;
  phonemes: string[];
  // conflict：同一学生同一活动出现通过/未通过冲突结果
  conflictScores?: Array<{ resultId: string; score: number; date: string; packageLabel: string }>;
  // prerequisite：通过结果缺少通过的前置活动
  missingDependencyIds?: string[];
  decision?: 'practice' | 'waive';
  resolvedBy?: Role;
  resolution?: string;
  resolutionNote?: string;
}

export interface ConfirmationEntry {
  at: string;
  by: Role;
  action: string;
  detail: string;
}

interface ImportedPackage {
  packageId: string;
  label: string;
  source: string;
  exportedAt: string;
  importedAt: string;
  resultCount: number;
}

export interface ReconcileState {
  packages: ImportedPackage[];
  results: StoredResult[];
  pending: PendingItem[];
  waivers: Array<{ studentId: string; activityId: string; dependencyId: string; at: string; by: Role; note: string }>;
  confirmations: ConfirmationEntry[];
  role: Role;
  seeded?: boolean;
}

export interface ActivityLite {
  id: string;
  type: string;
  title: string;
  phonemes: string[];
  dependencies: string[];
}

export interface CourseLite {
  id: string;
  activities: ActivityLite[];
}

export interface RosterRow {
  studentId: string;
  name: string;
  packages: number;
  results: number;
  mastered: number;
  practicing: number;
  planCount: number;
}

export type LedgerStatus = 'mastered' | 'practicing' | 'conflict' | 'identity' | 'prerequisite';

export interface LedgerRow {
  key: string;
  studentId: string;
  activityId: string;
  name: string;
  representative: StoredResult;
  versions: StoredResult[];
  status: LedgerStatus;
  waived: boolean;
  activityMissing: boolean;
  missingDependencyIds: string[];
  pendingId?: string;
}

export interface PlanItem {
  id: string;
  studentId: string;
  name: string;
  activityId: string;
  phonemes: string[];
  reasons: string[];
  foundationActivityIds: string[];
  needsConfirmation: boolean;
}

export interface ReconcileView {
  roster: RosterRow[];
  openIdentity: PendingItem[];
  openConflict: PendingItem[];
  openPrerequisite: PendingItem[];
  resolvedPending: PendingItem[];
  ledger: LedgerRow[];
  plans: PlanItem[];
  stats: {
    packages: number;
    records: number;
    activeRecords: number;
    students: number;
    mastered: number;
    practicing: number;
    planItems: number;
    openCount: number;
  };
}

export interface ImportSummary {
  packageId: string;
  label: string;
  added: number;
  duplicated: number;
  revised: { resultId: string; activityId: string; from: { score: number; date: string }; to: { score: number; date: string } }[];
  invalid: number;
}

export const RECONCILE_STORAGE_KEY = 'sologsb-1026-listening-reconcile-v1';
const PASS_LINE = 60;

export function emptyReconcileState(): ReconcileState {
  return { packages: [], results: [], pending: [], waivers: [], confirmations: [], role: 'teacher', seeded: false };
}

// ---------- 归一化与解析 ----------

export function normalizePhonemes(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[\s,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('/') && item.endsWith('/') ? item : `/${item.replace(/^\/+|\/+$/g, '')}/`));
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number {
  const number = Number(Array.isArray(value) ? NaN : value);
  return Number.isFinite(number) ? number : NaN;
}

function asPassed(score: number, raw?: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['true', '1', 'yes', '掌握', '通过', '达标'].includes(text)) return true;
    if (['false', '0', 'no', '未掌握', '未通过', '未达标'].includes(text)) return false;
  }
  return score >= PASS_LINE;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface NormalizedInput {
  studentId: string;
  activityId: string;
  name: string;
  date: string;
  phonemes: string[];
  score: number;
  passed: boolean;
  sourceRecordId: string;
}

function normalizeResult(raw: ListeningResultInput): NormalizedInput | null {
  const score = asNumber(raw.score);
  if (!Number.isFinite(score)) return null;
  const date = clean(raw.date) || new Date().toISOString().slice(0, 10);
  return {
    studentId: clean(raw.studentId ?? raw.studentNo),
    activityId: clean(raw.activityId ?? raw.activityNo),
    name: clean(raw.name),
    date,
    phonemes: normalizePhonemes(raw.phonemes),
    score,
    passed: asPassed(score, raw.mastery),
    sourceRecordId: clean(raw.sourceId ?? raw.recordId)
  };
}

export function parseResultPackageText(text: string): ResultPackageInput {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('结果包内容为空');
  try {
    const parsed = JSON.parse(trimmed) as ResultPackageInput | ListeningResultInput[];
    if (Array.isArray(parsed)) return { results: parsed };
    return parsed;
  } catch {
    // 降级支持 CSV：studentId,activityId,name,date,phonemes,score
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('无法解析：需要 JSON，或带表头的 CSV');
    const headers = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
    const pick = (cells: string[], ...keys: string[]) => {
      const index = headers.findIndex((header) => keys.includes(header));
      return index >= 0 ? cells[index] ?? '' : '';
    };
    const results: ListeningResultInput[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((cell) => cell.trim());
      results.push({
        studentId: pick(cells, 'studentid', 'studentno', 'sid', '学生编号'),
        activityId: pick(cells, 'activityid', 'activityno', 'aid', '活动编号'),
        name: pick(cells, 'name', '姓名'),
        date: pick(cells, 'date', '日期'),
        phonemes: pick(cells, 'phoneme', 'phonemes', '音素'),
        score: pick(cells, 'score', '分数'),
        sourceId: pick(cells, 'sourceid', 'recordid', '记录编号')
      });
    }
    return { results };
  }
}

// ---------- 缺号时的候选建议：姓名 + 日期 + 音素 ----------

export function suggestActivity(input: { phonemes: string[] }, course: CourseLite): ActivityLite | undefined {
  const wanted = new Set(input.phonemes);
  if (!wanted.size) return undefined;
  const scored = course.activities
    .map((activity) => {
      const own = new Set(activity.phonemes);
      let overlap = 0;
      wanted.forEach((phoneme) => { if (own.has(phoneme)) overlap += 1; });
      return { activity, overlap, exact: own.size === wanted.size && overlap === wanted.size };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.overlap - a.overlap);
  return scored[0]?.activity;
}

export function suggestStudent(name: string, state: ReconcileState): string | undefined {
  if (!name) return undefined;
  const match = state.results.find((result) => result.name === name && !result.supersededBy && result.studentId);
  return match?.studentId;
}

// ---------- 结果包导入 ----------

function cloneState(state: ReconcileState): ReconcileState {
  return structuredClone({
    ...state,
    packages: [...state.packages],
    results: [...state.results],
    pending: [...state.pending],
    waivers: [...state.waivers],
    confirmations: [...state.confirmations]
  });
}

export function importResultPackage(state: ReconcileState, input: ResultPackageInput, courses: CourseLite[]): { state: ReconcileState; summary: ImportSummary } {
  const next = cloneState(state);
  const packageId = clean(input.packageId) || nextId('pkg');
  const label = clean(input.label) || `结果包 ${next.packages.length + 1}`;
  const source = clean(input.source) || '课堂听读小程序';
  const importedAt = new Date().toISOString();

  const summary: ImportSummary = {
    packageId, label, added: 0, duplicated: 0,
    revised: [], invalid: 0
  };
  const primaryCourse = courses[0];

  for (const raw of input.results ?? []) {
    const normalized = normalizeResult(raw);
    if (!normalized) { summary.invalid += 1; continue; }
    const { studentId, activityId, name, date, phonemes, score, passed, sourceRecordId } = normalized;

    // 同一结果重复上传：有源记录编号按编号判重，否则按 学生×活动×日期×分数 判重，只记一次
    const duplicate = next.results.find((existing) => {
      if (existing.supersededBy) return false;
      if (sourceRecordId) {
        return existing.sourceRecordId === sourceRecordId && existing.score === score && existing.date === date;
      }
      return !existing.sourceRecordId &&
        existing.studentId === studentId && existing.activityId === activityId &&
        existing.date === date && existing.score === score && existing.name === name;
    });
    if (duplicate) { summary.duplicated += 1; continue; }

    // 分数或日期变化：旧结果进入修订链，对应补练安排随后失效重算
    const sameSource = sourceRecordId
      ? next.results.find((existing) => !existing.supersededBy && existing.sourceRecordId === sourceRecordId)
      : next.results.find((existing) => !existing.supersededBy && !existing.sourceRecordId &&
          existing.studentId === studentId && existing.activityId === activityId && existing.date === date);
    if (sameSource && (sameSource.score !== score || sameSource.date !== date)) {
      const revisionId = nextId('r');
      sameSource.supersededBy = revisionId;
      const oldPending = next.pending.find((item) => item.status === 'open' && item.resultIds.includes(sameSource.id));
      if (oldPending) {
        oldPending.status = 'resolved';
        oldPending.updatedAt = importedAt;
        oldPending.resolution = '结果被新结果包修订，待确认随旧结果关闭';
      }
      next.results.push({
        id: revisionId, packageId, packageLabel: label,
        studentId, activityId, name, date, phonemes, score, passed,
        sourceRecordId, importedAt,
        history: [...sameSource.history, { date: sameSource.date, score: sameSource.score, packageId: sameSource.packageId, packageLabel: sameSource.packageLabel, at: sameSource.importedAt }]
      });
      summary.revised.push({ resultId: revisionId, activityId, from: { score: sameSource.score, date: sameSource.date }, to: { score, date } });
      continue;
    }

    const stored: StoredResult = {
      id: nextId('r'), packageId, packageLabel: label,
      studentId, activityId, name, date, phonemes, score, passed,
      sourceRecordId, importedAt, history: []
    };
    next.results.push(stored);
    summary.added += 1;

    // 缺号不直接写学情：先用姓名、日期、音素形成待确认
    if (!studentId || !activityId) {
      const suggestedActivity = !activityId && primaryCourse ? suggestActivity({ phonemes }, primaryCourse) : undefined;
      const suggestedStudent = !studentId ? suggestStudent(name, next) : undefined;
      next.pending.push({
        id: nextId('p'), kind: 'identity', status: 'open', createdAt: importedAt, updatedAt: importedAt,
        resultIds: [stored.id], studentId: suggestedStudent ?? studentId, activityId: suggestedActivity?.id ?? activityId,
        name, date, phonemes
      });
    }
  }

  next.packages.push({ packageId, label, source, exportedAt: clean(input.exportedAt) || importedAt, importedAt, resultCount: input.results?.length ?? 0 });
  refreshDerivations(next, courses);
  next.confirmations.push({
    at: importedAt, by: next.role, action: '导入结果包',
    detail: `《${label}》新增 ${summary.added} 条，重复跳过 ${summary.duplicated} 条，分数/日期修订 ${summary.revised.length} 条，无法解析 ${summary.invalid} 条。`
  });
  return { state: next, summary };
}

// ---------- 组长确认动作（普通教师越权会被拒绝） ----------

function requireLeader(state: ReconcileState): void {
  if (state.role !== 'leader') throw new Error('普通教师不能处理待确认项，请切换到教研组长身份');
}

export function confirmIdentity(state: ReconcileState, pendingId: string, studentId: string, activityId: string, note: string, courses: CourseLite[]): ReconcileState {
  requireLeader(state);
  if (!studentId.trim() || !activityId.trim()) throw new Error('学生编号与活动编号都必须确认');
  const next = cloneState(state);
  const item = next.pending.find((pending) => pending.id === pendingId);
  if (!item || item.kind !== 'identity' || item.status !== 'open') throw new Error('待确认项不存在或已处理');
  const at = new Date().toISOString();
  item.status = 'resolved';
  item.updatedAt = at;
  item.resolvedBy = 'leader';
  item.resolution = '编号已确认，写回学情';
  item.resolutionNote = note.trim();
  item.studentId = studentId.trim();
  item.activityId = activityId.trim();
  for (const resultId of item.resultIds) {
    const result = next.results.find((candidate) => candidate.id === resultId);
    if (result) { result.studentId = item.studentId; result.activityId = item.activityId; }
  }
  next.confirmations.push({ at, by: 'leader', action: '确认缺号结果', detail: `${item.name || '未知学生'} / ${item.date} / 音素 ${item.phonemes.join(' ') || '—'} → ${item.studentId} × ${item.activityId}${note.trim() ? `（${note.trim()}）` : ''}` });
  refreshDerivations(next, courses);
  return next;
}

export function resolveConflict(state: ReconcileState, pendingId: string, winningResultId: string, note: string, courses: CourseLite[]): ReconcileState {
  requireLeader(state);
  const next = cloneState(state);
  const item = next.pending.find((pending) => pending.id === pendingId);
  if (!item || item.kind !== 'conflict' || item.status !== 'open') throw new Error('冲突项不存在或已处理');
  const winner = next.results.find((result) => result.id === winningResultId && !result.supersededBy);
  if (!winner) throw new Error('选中的结果不存在');
  for (const resultId of item.resultIds) {
    const result = next.results.find((candidate) => candidate.id === resultId);
    if (result && result.id !== winningResultId) result.supersededBy = winningResultId;
  }
  const at = new Date().toISOString();
  item.status = 'resolved';
  item.updatedAt = at;
  item.resolvedBy = 'leader';
  item.decision = 'practice';
  item.resolution = `以 ${winner.score} 分（${winner.date}，${winner.packageLabel}）为准`;
  item.resolutionNote = note.trim();
  next.confirmations.push({ at, by: 'leader', action: '裁决冲突结果', detail: `${item.studentId} × ${item.activityId}：${item.resolution}${note.trim() ? `（${note.trim()}）` : ''}` });
  refreshDerivations(next, courses);
  return next;
}

export function resolvePrerequisite(state: ReconcileState, pendingId: string, decision: 'practice' | 'waive', note: string, courses: CourseLite[]): ReconcileState {
  requireLeader(state);
  const next = cloneState(state);
  const item = next.pending.find((pending) => pending.id === pendingId);
  if (!item || item.kind !== 'prerequisite' || item.status !== 'open') throw new Error('前置缺口不存在或已处理');
  const at = new Date().toISOString();
  item.status = 'resolved';
  item.decision = decision;
  item.updatedAt = at;
  item.resolvedBy = 'leader';
  item.resolution = decision === 'waive' ? '组长批准前置豁免' : '已确认并生成前置补练';
  item.resolutionNote = note.trim();
  if (decision === 'waive') {
    for (const dependencyId of item.missingDependencyIds ?? []) {
      if (!next.waivers.some((waiver) => waiver.studentId === item.studentId && waiver.activityId === item.activityId && waiver.dependencyId === dependencyId)) {
        next.waivers.push({ studentId: item.studentId, activityId: item.activityId, dependencyId, at, by: 'leader', note: note.trim() });
      }
    }
  }
  next.confirmations.push({ at, by: 'leader', action: decision === 'waive' ? '批准前置豁免' : '确认前置补练', detail: `${item.studentId} × ${item.activityId} 缺前置 ${(item.missingDependencyIds ?? []).join('、')}：${item.resolution}${note.trim() ? `（${note.trim()}）` : ''}` });
  refreshDerivations(next, courses);
  return next;
}

// ---------- 分组与派生：冲突、前置缺口、学情、补练清单 ----------

function groupResults(results: StoredResult[]): Map<string, StoredResult[]> {
  const groups = new Map<string, StoredResult[]>();
  for (const result of results) {
    if (result.supersededBy) continue;
    // 身份未确认（缺号）的不参与学情分组
    if (!result.studentId || !result.activityId) continue;
    const key = `${result.studentId}::${result.activityId}`;
    const list = groups.get(key) ?? [];
    list.push(result);
    groups.set(key, list);
  }
  return groups;
}

function missingPassedDependencies(student: string, activity: ActivityLite, course: CourseLite, passedKeys: Set<string>, waivers: ReconcileState['waivers']): string[] {
  const byId = new Map(course.activities.map((item) => [item.id, item]));
  return activity.dependencies.filter((dependencyId) => {
    if (!byId.has(dependencyId)) return false; // 失效依赖由课程体检负责
    if (waivers.some((waiver) => waiver.studentId === student && waiver.activityId === activity.id && waiver.dependencyId === dependencyId)) return false;
    return !passedKeys.has(`${student}::${dependencyId}`);
  });
}

/** 依据结果包重建开放待确认；已处理记录保留为审计轨迹。 */
export function refreshDerivations(state: ReconcileState, courses: CourseLite[]): void {
  const course = courses[0];
  const groups = groupResults(state.results);
  const now = new Date().toISOString();

  // 1) 清理已失效的开放待确认：结果被修订或删除
  state.pending = state.pending.filter((item) => {
    if (item.status === 'resolved') return true;
    if (item.kind === 'identity') {
      return item.resultIds.some((resultId) => {
        const result = state.results.find((candidate) => candidate.id === resultId);
        return Boolean(result && !result.supersededBy && (!result.studentId || !result.activityId));
      });
    }
    return item.resultIds.some((resultId) => state.results.some((result) => result.id === resultId && !result.supersededBy));
  });

  // 2) 冲突：同一学生同一活动同时存在通过与未通过的有效结果
  for (const [key, versions] of groups) {
    const [studentId, activityId] = key.split('::');
    const hasPass = versions.some((result) => result.passed);
    const hasFail = versions.some((result) => !result.passed);
    const openConflict = state.pending.find((item) => item.kind === 'conflict' && item.status === 'open' && item.studentId === studentId && item.activityId === activityId);
    if (hasPass && hasFail) {
      const latest = [...versions].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))[0];
      const payload = {
        resultIds: versions.map((result) => result.id),
        conflictScores: versions.map((result) => ({ resultId: result.id, score: result.score, date: result.date, packageLabel: result.packageLabel })),
        name: latest?.name ?? '', date: latest?.date ?? '', phonemes: latest?.phonemes ?? []
      };
      if (openConflict) Object.assign(openConflict, payload, { updatedAt: now });
      else state.pending.push({ id: nextId('p'), kind: 'conflict', status: 'open', createdAt: now, updatedAt: now, studentId, activityId, ...payload });
    } else if (openConflict) {
      openConflict.status = 'resolved';
      openConflict.updatedAt = now;
      openConflict.resolution = '冲突结果已消失（被新结果包修订或覆盖）';
    }
  }

  if (!course) return;

  // 当前确定通过（无冲突）的 学生×活动 集合
  const passedKeys = new Set<string>();
  groups.forEach((versions, key) => {
    if (versions.some((result) => result.passed) && !versions.some((result) => !result.passed)) passedKeys.add(key);
  });

  // 3) 漏掉前置活动：通过的结果缺少通过的前置（冲突未裁决前不检查）
  for (const [key, versions] of groups) {
    const [studentId, activityId] = key.split('::');
    const hasPass = versions.some((result) => result.passed);
    const hasFail = versions.some((result) => !result.passed);
    if (!hasPass || hasFail) continue;
    const activity = course.activities.find((candidate) => candidate.id === activityId);
    if (!activity) continue;
    const missing = missingPassedDependencies(studentId, activity, course, passedKeys, state.waivers);
    // 已被任一条前置待确认（开放或已处理）覆盖的依赖不再重复列出；
    // 课程新增依赖时，未被报告过的新缺口会立即重新出现
    const reported = new Set<string>();
    state.pending.forEach((item) => {
      if (item.kind === 'prerequisite' && item.studentId === studentId && item.activityId === activityId) {
        (item.missingDependencyIds ?? []).forEach((dependencyId) => reported.add(dependencyId));
      }
    });
    const open = state.pending.find((item) => item.kind === 'prerequisite' && item.status === 'open' && item.studentId === studentId && item.activityId === activityId);
    if (open) {
      const stillMissing = (open.missingDependencyIds ?? []).filter((dependencyId) => missing.includes(dependencyId));
      const fresh = missing.filter((dependencyId) => !reported.has(dependencyId));
      const merged = [...new Set([...stillMissing, ...fresh])];
      if (merged.length === 0) {
        open.status = 'resolved';
        open.decision = 'practice';
        open.updatedAt = now;
        open.resolution = '前置活动已在后续结果包补齐，自动核销';
      } else {
        open.missingDependencyIds = merged;
        open.updatedAt = now;
      }
      continue;
    }
    if (missing.length === 0) continue;
    const fresh = missing.filter((dependencyId) => !reported.has(dependencyId));
    if (fresh.length === 0) continue;
    const latest = [...versions].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))[0];
    state.pending.push({
      id: nextId('p'), kind: 'prerequisite', status: 'open', createdAt: now, updatedAt: now,
      resultIds: versions.map((result) => result.id), studentId, activityId,
      name: latest?.name ?? '', date: latest?.date ?? '', phonemes: activity.phonemes,
      missingDependencyIds: fresh
    });
  }
}

// ---------- 补练清单：完全由当前课程 + 已写回学情即时派生 ----------

export function buildPlans(state: ReconcileState, courses: CourseLite[]): PlanItem[] {
  const course = courses[0];
  if (!course) return [];
  const groups = groupResults(state.results);
  const plans: PlanItem[] = [];
  const activityIndex = new Map(course.activities.map((activity, index) => [activity.id, index]));

  // 音素教学活动位置
  const phonemeActivity = new Map<string, ActivityLite>();
  course.activities.forEach((activity) => {
    if (activity.type === '音素') {
      for (const phoneme of activity.phonemes) {
        if (!phonemeActivity.has(phoneme)) phonemeActivity.set(phoneme, activity);
      }
    }
  });

  const passedKeys = new Set<string>();
  groups.forEach((versions, key) => {
    if (versions.some((result) => result.passed) && !versions.some((result) => !result.passed)) passedKeys.add(key);
  });

  const pushItem = (studentId: string, name: string, activity: ActivityLite, reason: string, phonemes: string[], needsConfirmation = false) => {
    const id = `${studentId}::${activity.id}`;
    const existing = plans.find((item) => item.id === id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      phonemes.forEach((phoneme) => { if (!existing.phonemes.includes(phoneme)) existing.phonemes.push(phoneme); });
      existing.needsConfirmation = existing.needsConfirmation || needsConfirmation;
      return;
    }
    const foundationActivityIds = [...new Set(phonemes.map((phoneme) => phonemeActivity.get(phoneme)?.id).filter(Boolean) as string[])];
    plans.push({ id, studentId, name, activityId: activity.id, reasons: [reason], phonemes: [...new Set(phonemes)], foundationActivityIds, needsConfirmation });
  };

  for (const [key, versions] of groups) {
    const [studentId, activityId] = key.split('::');
    const activity = course.activities.find((candidate) => candidate.id === activityId);
    if (!activity) continue; // 活动已从课程删除：旧补练项自动消失，旧结果仍在台账中核对
    const name = versions[0]?.name ?? studentId;
    const hasPass = versions.some((result) => result.passed);
    const hasFail = versions.some((result) => !result.passed);
    if (hasPass && hasFail) continue; // 冲突未裁决，不生成补练
    if (!hasPass) {
      pushItem(studentId, name, activity, '活动未达标，安排补练', activity.phonemes);
      continue;
    }
    const missing = missingPassedDependencies(studentId, activity, course, passedKeys, state.waivers);
    if (!missing.length) continue;
    const openPrerequisite = state.pending.some((item) => item.kind === 'prerequisite' && item.status === 'open' && item.studentId === studentId && item.activityId === activityId);
    for (const dependencyId of missing) {
      const dependency = course.activities.find((candidate) => candidate.id === dependencyId);
      if (dependency) pushItem(studentId, name, dependency, `前置活动缺失（${activity.title} 需要先完成）`, dependency.phonemes, openPrerequisite);
    }
  }

  return plans.sort((a, b) =>
    a.studentId.localeCompare(b.studentId) ||
    (activityIndex.get(a.activityId) ?? 0) - (activityIndex.get(b.activityId) ?? 0)
  );
}

// ---------- 视图派生 ----------

export function buildView(state: ReconcileState, courses: CourseLite[]): ReconcileView {
  const course = courses[0];
  // 视图永远以当前课程为准：顺序/音素/依赖变化后，先按新课程重算待确认与缺口
  refreshDerivations(state, courses);
  const activityById = new Map(course?.activities.map((activity) => [activity.id, activity]) ?? []);
  const groups = groupResults(state.results);

  const openIdentity = state.pending.filter((item) => item.kind === 'identity' && item.status === 'open');
  const openConflict = state.pending.filter((item) => item.kind === 'conflict' && item.status === 'open');
  const openPrerequisite = state.pending.filter((item) => item.kind === 'prerequisite' && item.status === 'open');
  const resolvedPending = state.pending.filter((item) => item.status === 'resolved');

  const passedKeys = new Set<string>();
  groups.forEach((versions, key) => {
    if (versions.some((result) => result.passed) && !versions.some((result) => !result.passed)) passedKeys.add(key);
  });

  const ledger: LedgerRow[] = [];
  const openByKey = new Map<string, PendingItem>();
  for (const item of [...openConflict, ...openPrerequisite]) {
    openByKey.set(`${item.studentId}::${item.activityId}`, item);
  }

  for (const [key, versions] of [...groups.entries()].sort()) {
    const [studentId, activityId] = key.split('::');
    const sorted = [...versions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.importedAt < b.importedAt ? 1 : -1)));
    const representative = sorted[0];
    const hasPass = versions.some((result) => result.passed);
    const hasFail = versions.some((result) => !result.passed);
    const currentActivity = activityById.get(activityId);
    let status: LedgerStatus;
    let missingDependencyIds: string[] = [];
    if (hasPass && hasFail) status = 'conflict';
    else if (!hasPass) status = 'practicing';
    else {
      missingDependencyIds = currentActivity && course ? missingPassedDependencies(studentId, currentActivity, course, passedKeys, state.waivers) : [];
      status = missingDependencyIds.length ? 'prerequisite' : 'mastered';
    }
    const openItem = openByKey.get(key);
    if (openItem?.kind === 'prerequisite') missingDependencyIds = openItem.missingDependencyIds ?? [];
    const waived = state.waivers.some((waiver) => waiver.studentId === studentId && waiver.activityId === activityId);
    ledger.push({ key, studentId, activityId, name: representative.name, representative, versions: sorted, status, waived, activityMissing: !currentActivity, missingDependencyIds, pendingId: openItem?.id });
  }

  // 缺号结果单列在台账末尾
  for (const item of openIdentity) {
    const result = state.results.find((candidate) => candidate.id === item.resultIds[0]);
    if (result) {
      ledger.push({ key: `identity:${item.id}`, studentId: '', activityId: '', name: item.name, representative: result, versions: [result], status: 'identity', waived: false, activityMissing: false, missingDependencyIds: [], pendingId: item.id });
    }
  }

  const plans = buildPlans(state, courses);

  // 名册
  const rosterMap = new Map<string, RosterRow & { packageSet: Set<string> }>();
  const ensureRoster = (studentId: string, name: string) => {
    let row = rosterMap.get(studentId);
    if (!row) {
      row = { studentId, name: name || `学生 ${studentId}`, packages: 0, results: 0, mastered: 0, practicing: 0, planCount: 0, packageSet: new Set() };
      rosterMap.set(studentId, row);
    }
    if (name) row.name = name;
    return row;
  };
  for (const result of state.results) {
    if (result.supersededBy || !result.studentId) continue;
    ensureRoster(result.studentId, result.name).packageSet.add(result.packageId);
  }
  for (const row of ledger) {
    if (!row.studentId) continue;
    const rosterRow = ensureRoster(row.studentId, row.name);
    rosterRow.results += 1;
    if (row.activityMissing) continue; // 活动已不在当前课程，旧结果仍可核对，但不计入当前学情
    if (row.status === 'mastered') rosterRow.mastered += 1;
    if (row.status === 'practicing' || row.status === 'prerequisite') rosterRow.practicing += 1;
  }
  for (const item of plans) {
    const row = rosterMap.get(item.studentId);
    if (row) row.planCount += 1;
  }
  const roster = [...rosterMap.values()]
    .map(({ packageSet, ...row }) => ({ ...row, packages: packageSet.size }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  const activeRecords = state.results.filter((result) => !result.supersededBy).length;
  return {
    roster,
    openIdentity,
    openConflict,
    openPrerequisite,
    resolvedPending,
    ledger: ledger.sort((a, b) => (a.studentId || '￿').localeCompare(b.studentId || '￿') || a.activityId.localeCompare(b.activityId)),
    plans,
    stats: {
      packages: state.packages.length,
      records: state.results.length,
      activeRecords,
      students: roster.length,
      mastered: ledger.filter((row) => row.status === 'mastered' && !row.activityMissing).length,
      practicing: ledger.filter((row) => (row.status === 'practicing' || row.status === 'prerequisite') && !row.activityMissing).length,
      planItems: plans.length,
      openCount: openIdentity.length + openConflict.length + openPrerequisite.length
    }
  };
}

// ---------- 课程结构指纹：课程一改，补练清单立即按新课程重算 ----------

export function courseSignature(course: CourseLite): string {
  const lite = course.activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    phonemes: [...activity.phonemes].sort(),
    dependencies: [...activity.dependencies].sort()
  }));
  return hashString(JSON.stringify(lite));
}

export function planSignature(plans: PlanItem[]): string {
  return hashString(JSON.stringify(plans.map((item) => ({ id: item.id, reasons: item.reasons, foundations: item.foundationActivityIds, needsConfirmation: item.needsConfirmation }))));
}

export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function loadReconcileState(): ReconcileState {
  if (typeof localStorage === 'undefined') return emptyReconcileState();
  const raw = localStorage.getItem(RECONCILE_STORAGE_KEY);
  if (!raw) return emptyReconcileState();
  try {
    const parsed = JSON.parse(raw) as Partial<ReconcileState>;
    return {
      packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      waivers: Array.isArray(parsed.waivers) ? parsed.waivers : [],
      confirmations: Array.isArray(parsed.confirmations) ? parsed.confirmations : [],
      role: parsed.role === 'leader' ? 'leader' : 'teacher',
      seeded: Boolean(parsed.seeded)
    };
  } catch {
    return emptyReconcileState();
  }
}
