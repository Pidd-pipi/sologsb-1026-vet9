// 听读结果包的解析、配对、去重与冲突检测。
// 结果包由另一套小程序导出，字段可能缺号（缺学生编号或活动编号），
// 配对顺序：编号 → 名称 → 音素（缺号时用姓名、日期和音素确认）。

export interface ResultRecord {
  studentId: string;
  studentName: string;
  activityId: string;
  activityName: string;
  phonemes: string[];
  date: string;
  score: number;
  fullScore: number;
  mastered: boolean;
}

export interface ResultPackage {
  packageName: string;
  exportedAt: string;
  records: ResultRecord[];
}

export type MatchMethod = 'id' | 'name' | 'phoneme' | 'unmatched';
export type ResultStatus = 'active' | 'superseded' | 'held';

export interface ListeningResult extends ResultRecord {
  id: string;
  packageName: string;
  uploadedAt: string;
  fingerprint: string;
  studentKey: string;
  activityKey: string;
  matchedActivityId: string;
  matchMethod: MatchMethod;
  status: ResultStatus;
  supersededBy: string;
}

export type PendingKind = 'unmatched-activity' | 'missing-prerequisite' | 'conflict' | 'missing-student';

export interface PendingItem {
  id: string;
  kind: PendingKind;
  resultId: string;
  studentKey: string;
  studentName: string;
  activityKey: string;
  activityTitle: string;
  date: string;
  title: string;
  detail: string;
  candidateActivityIds: string[];
  conflictResultId: string;
  createdAt: string;
  resolved: boolean;
  resolution: 'confirmed' | 'rejected' | null;
  resolvedBy: string;
  resolvedAt: string | null;
  writeback: Writeback | null;
}

export interface Writeback {
  studentKey: string;
  studentName: string;
  activityId: string;
  activityTitle: string;
  phonemes: string[];
  mastered: boolean;
  score: number;
  fullScore: number;
  date: string;
}

export interface LearningRecord {
  id: string;
  studentKey: string;
  studentName: string;
  activityId: string;
  activityTitle: string;
  phonemes: string[];
  mastered: boolean;
  score: number;
  fullScore: number;
  date: string;
  confirmedAt: string;
  confirmedBy: string;
  source: string;
}

export interface PackageLogEntry {
  packageName: string;
  exportedAt: string;
  uploadedAt: string;
  total: number;
  inserted: number;
  duplicates: number;
  updated: number;
  pending: number;
}

export interface IngestReport {
  total: number;
  inserted: number;
  duplicates: number;
  updated: number;
  conflicts: number;
  pending: number;
}

export interface ActivityLike {
  id: string;
  title: string;
  content: string;
  phonemes: string[];
  dependencies: string[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[（）()【】\[\]]/g, '').toLowerCase();
}

export function studentKeyOf(rec: Pick<ResultRecord, 'studentId' | 'studentName'>): string {
  if ((rec.studentId ?? '').trim()) return `id:${rec.studentId.trim()}`;
  if ((rec.studentName ?? '').trim()) return `name:${rec.studentName.trim()}`;
  return '';
}

export function activityKeyOf(rec: Pick<ResultRecord, 'activityId' | 'activityName'>): string {
  if ((rec.activityId ?? '').trim()) return `aid:${rec.activityId.trim()}`;
  if ((rec.activityName ?? '').trim()) return `aname:${rec.activityName.trim()}`;
  return '';
}

// 缺号时的配对：活动编号 → 活动名称 → 音素（唯一候选直接命中，多候选列待确认）。
export function matchActivity(
  rec: Pick<ResultRecord, 'activityId' | 'activityName' | 'phonemes'>,
  activities: ActivityLike[]
): { activity: ActivityLike | null; method: MatchMethod; candidates: ActivityLike[] } {
  if ((rec.activityId ?? '').trim()) {
    const hit = activities.find((a) => a.id === rec.activityId.trim());
    if (hit) return { activity: hit, method: 'id', candidates: [] };
  }
  if ((rec.activityName ?? '').trim()) {
    const norm = normalizeText(rec.activityName);
    const hit = activities.find((a) => normalizeText(a.title) === norm || normalizeText(a.content) === norm);
    if (hit) return { activity: hit, method: 'name', candidates: [] };
  }
  if (rec.phonemes?.length) {
    const candidates = activities.filter((a) => a.phonemes.some((p) => rec.phonemes.includes(p)));
    if (candidates.length === 1) return { activity: candidates[0], method: 'phoneme', candidates: [] };
    if (candidates.length > 1) return { activity: null, method: 'phoneme', candidates };
  }
  return { activity: null, method: 'unmatched', candidates: [] };
}

// 去重指纹：同一学生、同一活动、同一日期、同一分数与掌握状态视为同一结果。
export function fingerprintOf(rec: ResultRecord, studentKey: string, activityKey: string): string {
  return [
    studentKey,
    activityKey,
    (rec.date ?? '').trim(),
    Number(rec.score) || 0,
    Number(rec.fullScore) || 0,
    rec.mastered ? '1' : '0'
  ].join('|');
}

function normalizeRecord(raw: Partial<ResultRecord>): ResultRecord {
  const fullScore = Number(raw.fullScore) || 10;
  const score = Math.max(0, Math.min(fullScore, Number(raw.score) || 0));
  return {
    studentId: String(raw.studentId ?? '').trim(),
    studentName: String(raw.studentName ?? '').trim(),
    activityId: String(raw.activityId ?? '').trim(),
    activityName: String(raw.activityName ?? '').trim(),
    phonemes: Array.isArray(raw.phonemes) ? raw.phonemes.map((p) => String(p).trim()).filter(Boolean) : [],
    date: String(raw.date ?? '').trim(),
    score,
    fullScore,
    mastered: typeof raw.mastered === 'boolean' ? raw.mastered : score >= fullScore * 0.6
  };
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function hasResultFor(result: ListeningResult[], learning: LearningRecord[], studentKey: string, activityId: string): boolean {
  return (
    result.some((r) => r.studentKey === studentKey && r.matchedActivityId === activityId && r.status === 'active') ||
    learning.some((l) => l.studentKey === studentKey && l.activityId === activityId)
  );
}

export interface IngestState {
  results: ListeningResult[];
  pending: PendingItem[];
  learning: LearningRecord[];
  packages: PackageLogEntry[];
}

// 把一个结果包核对进当前状态：去重、更新顶替、冲突与漏前置检测。
export function ingestPackage<T extends IngestState>(
  state: T,
  pkg: ResultPackage,
  activities: ActivityLike[]
): { state: T; report: IngestReport } {
  const next: T = {
    ...state,
    results: [...state.results],
    pending: [...state.pending],
    learning: [...state.learning],
    packages: [...state.packages]
  };
  const report: IngestReport = { total: pkg.records.length, inserted: 0, duplicates: 0, updated: 0, conflicts: 0, pending: 0 };
  const now = new Date().toISOString();
  const uploadedAt = now;

  for (const raw of pkg.records) {
    const rec = normalizeRecord(raw);
    const studentKey = studentKeyOf(rec);
    const activityKey = activityKeyOf(rec);

    if (!studentKey) {
      report.pending += 1;
      next.pending.push({
        id: nextId('pend'), kind: 'missing-student', resultId: '', studentKey: '', studentName: rec.studentName || '（未署名）',
        activityKey, activityTitle: rec.activityName || rec.activityId || '—', date: rec.date,
        title: '缺少学生编号与姓名',
        detail: `结果包中有一条记录无法确认学生（${rec.date} · ${rec.activityName || rec.activityId || '活动未知'}），请补录学生信息后再核对。`,
        candidateActivityIds: [], conflictResultId: '', createdAt: now,
        resolved: false, resolution: null, resolvedBy: '', resolvedAt: null, writeback: null
      });
      continue;
    }

    const match = matchActivity(rec, activities);
    const matchedActivityId = match.activity?.id ?? '';
    const fp = fingerprintOf(rec, studentKey, matchedActivityId || activityKey);

    // 同一结果重复上传：只记一次（含已失效或挂起的历史结果，避免旧包重传把成绩翻回去）。
    const duplicate = next.results.some((r) => r.fingerprint === fp);
    if (duplicate) {
      report.duplicates += 1;
      continue;
    }

    const result: ListeningResult = {
      ...rec,
      id: nextId('res'),
      packageName: pkg.packageName,
      uploadedAt,
      fingerprint: fp,
      studentKey,
      activityKey,
      matchedActivityId,
      matchMethod: match.method,
      status: 'active',
      supersededBy: ''
    };

    // 同一学生同一活动已有有效结果：日期或分数变化 → 旧结果失效被顶替（补练安排随之重算）；
    // 同一日期分数却不一致 → 冲突，先列待确认。
    const sameIdentity = next.results.find(
      (r) => r.studentKey === studentKey && (r.matchedActivityId || r.activityKey) === (matchedActivityId || activityKey) && r.status === 'active'
    );
    if (sameIdentity) {
      if (sameIdentity.date === rec.date && sameIdentity.mastered !== rec.mastered) {
        result.status = 'held';
        report.conflicts += 1;
        report.pending += 1;
        next.pending.push({
          id: nextId('pend'), kind: 'conflict', resultId: result.id,
          studentKey, studentName: rec.studentName, activityKey,
          activityTitle: match.activity?.title || rec.activityName || rec.activityId || '—',
          date: rec.date,
          title: `同一活动出现冲突结果：${rec.studentName} · ${match.activity?.title || rec.activityName}`,
          detail: `${rec.date} 当天有两条听读结果掌握状态不一致（${sameIdentity.score}/${sameIdentity.fullScore} → ${rec.score}/${rec.fullScore}）。在组长确认前，两条结果都不写回学情。`,
          candidateActivityIds: [], conflictResultId: sameIdentity.id, createdAt: now,
          resolved: false, resolution: null, resolvedBy: '', resolvedAt: null, writeback: null
        });
      } else {
        sameIdentity.status = 'superseded';
        sameIdentity.supersededBy = result.id;
        // 旧成绩已失效：移除其名下待确认项与学情记录，由新结果重新核对写回。
        next.pending = next.pending.filter((p) => p.resultId !== sameIdentity.id);
        const staleId = `${studentKey}|${matchedActivityId || activityKey}`;
        const staleIdx = next.learning.findIndex((l) => l.id === staleId);
        if (staleIdx >= 0) next.learning.splice(staleIdx, 1);
        report.updated += 1;
      }
    }

    // 缺号且音素多候选：无法确定活动，列待确认。
    if (!matchedActivityId && match.method === 'phoneme') {
      report.pending += 1;
      next.pending.push({
        id: nextId('pend'), kind: 'unmatched-activity', resultId: result.id,
        studentKey, studentName: rec.studentName, activityKey,
        activityTitle: rec.activityName || rec.activityId || '—', date: rec.date,
        title: `活动编号缺失，需确认活动：${rec.studentName} · ${rec.date}`,
        detail: `结果缺少活动编号与名称，按音素 ${rec.phonemes.join('、')} 匹配到多个活动，请确认这条听读结果对应哪个活动。`,
        candidateActivityIds: match.candidates.map((a) => a.id), createdAt: now,
        resolved: false, resolution: null, resolvedBy: '', resolvedAt: null,
        writeback: null, conflictResultId: ''
      });
    }

    // 漏前置活动：该活动的前置依赖没有任何听读结果或学情记录。
    // 挂起待裁决的冲突结果不再重复报漏前置；同一学生同一活动只列一次。
    if (matchedActivityId && match.activity && result.status !== 'held') {
      const already = next.pending.some(
        (p) => !p.resolved && p.kind === 'missing-prerequisite' && p.studentKey === studentKey && p.activityTitle === match.activity!.title
      );
      const missingDeps = match.activity.dependencies.filter((depId) => !hasResultFor(next.results, next.learning, studentKey, depId));
      if (missingDeps.length && !already) {
        report.pending += 1;
        next.pending.push({
          id: nextId('pend'), kind: 'missing-prerequisite', resultId: result.id,
          studentKey, studentName: rec.studentName, activityKey,
          activityTitle: match.activity.title, date: rec.date,
          title: `漏掉前置活动：${rec.studentName} · ${match.activity.title}`,
          detail: `该生在“${match.activity.title}”的前置活动（${missingDeps.map((id) => activities.find((a) => a.id === id)?.title ?? id).join('、')}）上没有听读结果，无法判断是否具备学习本活动的前提，请组长确认是否采信。`,
          candidateActivityIds: [], conflictResultId: '', createdAt: now,
          resolved: false, resolution: null, resolvedBy: '', resolvedAt: null, writeback: null
        });
      }
    }

    next.results.push(result);
    report.inserted += 1;
  }

  // 正常核对通过的结果（没有未裁决的待确认项指向它）自动写回学情；
  // 漏前置、冲突、缺号等待确认项必须由组长确认后才写回。
  const pendingResultIds = new Set(next.pending.filter((p) => !p.resolved).map((p) => p.resultId));
  for (const r of next.results) {
    if (r.status !== 'active' || !r.matchedActivityId || pendingResultIds.has(r.id)) continue;
    const activity = activities.find((a) => a.id === r.matchedActivityId);
    if (!activity) continue;
    const id = `${r.studentKey}|${r.matchedActivityId}`;
    if (next.learning.some((l) => l.id === id)) continue;
    next.learning.push({
      id,
      studentKey: r.studentKey,
      studentName: r.studentName,
      activityId: r.matchedActivityId,
      activityTitle: activity.title,
      phonemes: activity.phonemes,
      mastered: r.mastered,
      score: r.score,
      fullScore: r.fullScore,
      date: r.date,
      confirmedAt: uploadedAt,
      confirmedBy: '自动核对',
      source: `结果包 ${pkg.packageName}`
    });
  }

  // 报告中的待确认数以本批新增且未裁决的事项为准（被顶替结果名下的已清理）。
  report.pending = next.pending.filter((p) => !p.resolved && p.createdAt === now).length;

  next.packages.push({
    packageName: pkg.packageName,
    exportedAt: pkg.exportedAt,
    uploadedAt,
    total: report.total,
    inserted: report.inserted,
    duplicates: report.duplicates,
    updated: report.updated,
    pending: report.pending
  });

  return { state: next, report };
}

// 组长确认待确认项：确认后写回学情；驳回则作废对应结果。
export function resolvePending<T extends IngestState>(
  state: T,
  pendingId: string,
  resolution: 'confirmed' | 'rejected',
  leaderName: string,
  activities: ActivityLike[],
  chosenActivityId?: string
): T {
  const next: T = {
    ...state,
    results: [...state.results],
    pending: state.pending.map((p) => ({ ...p })),
    learning: [...state.learning],
    packages: [...state.packages]
  };
  const item = next.pending.find((p) => p.id === pendingId);
  if (!item || item.resolved) return state;
  item.resolved = true;
  item.resolution = resolution;
  item.resolvedBy = leaderName;
  item.resolvedAt = new Date().toISOString();

  if (resolution === 'rejected') {
    const target = next.results.find((r) => r.id === item.resultId);
    if (target) target.status = 'superseded';
    return next;
  }

  // 确认：补选活动（缺号多候选场景）或直接采信，写回学情。
  const result = next.results.find((r) => r.id === item.resultId);
  let activity: ActivityLike | null = null;
  if (item.kind === 'unmatched-activity' && chosenActivityId) {
    activity = activities.find((a) => a.id === chosenActivityId) ?? null;
    if (result && activity) {
      result.matchedActivityId = activity.id;
      result.matchMethod = 'phoneme';
      result.status = 'active';
    }
  } else if (item.kind === 'conflict') {
    // 冲突确认：采信新结果，旧结果作废。
    if (result) result.status = 'active';
    const rival = next.results.find((r) => r.id === item.conflictResultId);
    if (rival) rival.status = 'superseded';
    activity = activities.find((a) => a.id === (result?.matchedActivityId ?? '')) ?? null;
  } else {
    activity = activities.find((a) => a.id === (result?.matchedActivityId ?? '')) ?? null;
  }

  if (result && activity) {
    const record: LearningRecord = {
      id: `${result.studentKey}|${activity.id}`,
      studentKey: result.studentKey,
      studentName: result.studentName,
      activityId: activity.id,
      activityTitle: activity.title,
      phonemes: activity.phonemes,
      mastered: result.mastered,
      score: result.score,
      fullScore: result.fullScore,
      date: result.date,
      confirmedAt: item.resolvedAt ?? new Date().toISOString(),
      confirmedBy: leaderName,
      source: `待确认项 ${item.id}`
    };
    const idx = next.learning.findIndex((l) => l.id === record.id);
    if (idx >= 0) next.learning[idx] = record;
    else next.learning.push(record);
    item.writeback = {
      studentKey: record.studentKey,
      studentName: record.studentName,
      activityId: record.activityId,
      activityTitle: record.activityTitle,
      phonemes: record.phonemes,
      mastered: record.mastered,
      score: record.score,
      fullScore: record.fullScore,
      date: record.date
    };
  }
  return next;
}

// 示例结果包：覆盖通过、未掌握补练、漏前置、同活动冲突、姓名回退、音素缺号、
// 编号缺失按名称命中、分数与日期变化触发重算、重复上传等情形。
export function samplePackage(): ResultPackage {
  return {
    packageName: '课堂听读结果 · 2026-09 批',
    exportedAt: '2026-09-28T09:00:00+08:00',
    records: [
      { studentId: 's-01', studentName: '王小明', activityId: 'a-1', activityName: '听音游戏：认识 /m/', phonemes: ['/m/'], date: '2026-09-25', score: 9, fullScore: 10, mastered: true },
      { studentId: 's-01', studentName: '王小明', activityId: 'a-2', activityName: '首音识别：/s/ 与 /m/', phonemes: ['/s/', '/m/'], date: '2026-09-25', score: 8, fullScore: 10, mastered: true },
      { studentId: 's-01', studentName: '王小明', activityId: 'a-3', activityName: '拼读短词：sat', phonemes: ['/s/', '/æ/', '/t/'], date: '2026-09-25', score: 4, fullScore: 10, mastered: false },
      { studentId: 's-02', studentName: '李小红', activityId: 'a-3', activityName: '拼读短词：sat', phonemes: ['/s/', '/æ/', '/t/'], date: '2026-09-25', score: 4, fullScore: 10, mastered: false },
      { studentId: 's-02', studentName: '李小红', activityId: 'a-3', activityName: '拼读短词：sat', phonemes: ['/s/', '/æ/', '/t/'], date: '2026-09-25', score: 7, fullScore: 10, mastered: true },
      { studentId: '', studentName: '赵小刚', activityId: 'a-4', activityName: '听音选图：m / s 开头', phonemes: ['/m/', '/s/'], date: '2026-09-26', score: 6, fullScore: 10, mastered: false },
      { studentId: '', studentName: '赵小刚', activityId: 'a-4', activityName: '听音选图：m / s 开头', phonemes: ['/m/', '/s/'], date: '2026-09-28', score: 9, fullScore: 10, mastered: true },
      { studentId: 's-04', studentName: '钱小丽', activityId: 'a-9', activityName: '听音选图：m / s 开头', phonemes: ['/m/', '/s/'], date: '2026-09-26', score: 9, fullScore: 10, mastered: true },
      { studentId: 's-05', studentName: '孙小磊', activityId: '', activityName: '', phonemes: ['/æ/'], date: '2026-09-26', score: 5, fullScore: 10, mastered: false },
      { studentId: 's-06', studentName: '周小彤', activityId: 'a-8', activityName: '迁移朗读：A man sat.', phonemes: ['/m/', '/æ/', '/n/'], date: '2026-09-27', score: 3, fullScore: 10, mastered: false }
    ]
  };
}
