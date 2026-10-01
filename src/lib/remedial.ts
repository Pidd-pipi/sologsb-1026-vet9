// 补练安排：依据当前课程顺序、音素与依赖，从未掌握的听读结果生成补练建议。
// 课程顺序、音素或依赖一旦变化，已有补练清单立即按新课程重算（标记 stale 待重新确认）。

import type { ActivityLike, LearningRecord, ListeningResult } from './results';

export interface RemedialPlan {
  id: string;
  studentKey: string;
  studentName: string;
  activityId: string;
  activityTitle: string;
  phonemes: string[];
  resultIds: string[];
  suggestedIds: string[];
  reason: string;
  status: 'pending' | 'confirmed' | 'stale';
  courseSignature: string;
  updatedAt: string;
}

// 课程签名：活动顺序、音素或依赖任一变化都会改变签名，触发补练清单重算。
export function courseSignature(activities: ActivityLike[]): string {
  return JSON.stringify(activities.map((a) => [a.id, a.phonemes.join(','), a.dependencies.join(',')]));
}

function activityIndex(activities: ActivityLike[], id: string): number {
  return activities.findIndex((a) => a.id === id);
}

// 建议补练活动：先复习当前活动之前的同音素活动，再当前活动本身，最后之后的预学活动。
export function suggestActivities(
  failed: ActivityLike,
  activities: ActivityLike[],
  masteredIds: Set<string>
): string[] {
  const idx = activityIndex(activities, failed.id);
  const related = activities
    .filter((a) => a.id !== failed.id)
    .filter((a) => a.phonemes.some((p) => failed.phonemes.includes(p)))
    .filter((a) => !masteredIds.has(a.id))
    .sort((a, b) => activityIndex(activities, a.id) - activityIndex(activities, b.id));
  const before = related.filter((a) => activityIndex(activities, a.id) < idx);
  const after = related.filter((a) => activityIndex(activities, a.id) > idx);
  return [failed.id, ...before.map((a) => a.id), ...after.map((a) => a.id)].slice(0, 4);
}

export interface PlanState {
  plans: RemedialPlan[];
}

// 依据有效结果与已确认学情重算补练清单。
// existing 中已确认的计划若课程签名变化 → stale；新需求 → pending；已掌握的计划移除。
export function recomputePlans(
  existing: RemedialPlan[],
  results: ListeningResult[],
  learning: LearningRecord[],
  activities: ActivityLike[]
): RemedialPlan[] {
  const signature = courseSignature(activities);
  const byId = new Map(activities.map((a) => [a.id, a]));

  // 每个学生在每个活动上的掌握情况：取有效结果与已确认学情中的最新状态。
  const mastery = new Map<string, { mastered: boolean; studentName: string; resultIds: string[] }>();
  const consider = (studentKey: string, studentName: string, activityId: string, mastered: boolean, resultId: string) => {
    if (!activityId || !byId.has(activityId)) return;
    const key = `${studentKey}|${activityId}`;
    const prev = mastery.get(key);
    if (prev) {
      prev.mastered = mastered;
      if (resultId) prev.resultIds.push(resultId);
    } else {
      mastery.set(key, { mastered, studentName, resultIds: resultId ? [resultId] : [] });
    }
  };
  results
    .filter((r) => r.status === 'active' && r.matchedActivityId)
    .forEach((r) => consider(r.studentKey, r.studentName, r.matchedActivityId, r.mastered, r.id));
  learning.forEach((l) => consider(l.studentKey, l.studentName, l.activityId, l.mastered, ''));

  const masteredIds = new Set<string>();
  const needed: Array<{ key: string; studentKey: string; studentName: string; activityId: string; phonemes: string[]; resultIds: string[] }> = [];
  mastery.forEach((value, key) => {
    const [studentKey, activityId] = key.split('|');
    if (value.mastered) {
      masteredIds.add(activityId);
      return;
    }
    const activity = byId.get(activityId);
    if (!activity) return;
    needed.push({
      key,
      studentKey,
      studentName: value.studentName,
      activityId,
      phonemes: activity.phonemes,
      resultIds: value.resultIds
    });
  });

  const existingMap = new Map(existing.map((p) => [p.id, p]));
  const next: RemedialPlan[] = needed.map((item) => {
    const activity = byId.get(item.activityId)!;
    const suggestedIds = suggestActivities(activity, activities, masteredIds);
    const old = existingMap.get(item.key);
    if (old) {
      const stale = old.courseSignature !== signature;
      return {
        ...old,
        studentName: item.studentName,
        activityTitle: activity.title,
        phonemes: item.phonemes,
        resultIds: item.resultIds,
        suggestedIds,
        status: stale ? 'stale' : old.status,
        courseSignature: signature,
        updatedAt: new Date().toISOString()
      };
    }
    return {
      id: item.key,
      studentKey: item.studentKey,
      studentName: item.studentName,
      activityId: item.activityId,
      activityTitle: activity.title,
      phonemes: item.phonemes,
      resultIds: item.resultIds,
      suggestedIds,
      reason: `听读结果显示该生在「${activity.title}」上未掌握，涉及音素 ${activity.phonemes.join('、')}，建议补练。`,
      status: 'pending',
      courseSignature: signature,
      updatedAt: new Date().toISOString()
    };
  });

  return next.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh') || a.activityId.localeCompare(b.activityId));
}

// 组长确认补练安排（写回学情后的补练清单即生效）。
export function confirmPlan(plans: RemedialPlan[], planId: string): RemedialPlan[] {
  return plans.map((p) => (p.id === planId ? { ...p, status: 'confirmed' as const, updatedAt: new Date().toISOString() } : p));
}
