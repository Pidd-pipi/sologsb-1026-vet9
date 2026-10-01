import type { ResultPackageInput } from './reconcile';

// 演示用“课堂听读小程序”导出结果包。
// 包一覆盖：缺学生编号、缺活动编号（按音素建议）、漏前置活动、未达标、冲突、重复上传。
export const demoPackageWeek3: ResultPackageInput = {
  packageId: 'listen-pkg-w3',
  label: '第三周课堂听读结果包',
  source: '课堂听读小程序',
  exportedAt: '2026-09-25T16:30:00+08:00',
  results: [
    // 已掌握链（a-3/a-4 在包三中未测，为后面的漏前置场景留出缺口）
    { sourceId: 'w3-1001-a1', studentId: 'S1001', name: '李小满', activityId: 'a-1', date: '2026-09-22', phonemes: ['/m/'], score: 92 },
    { sourceId: 'w3-1001-a2', studentId: 'S1001', name: '李小满', activityId: 'a-2', date: '2026-09-22', phonemes: ['/s/', '/m/'], score: 88 },
    { sourceId: 'w3-1001-a5', studentId: 'S1001', name: '李小满', activityId: 'a-5', date: '2026-09-24', phonemes: ['/æ/'], score: 90 },
    // 漏前置：a-7 依赖 a-3 与 a-4，该生两者都缺（a-3/a-4 尚未测评）
    { sourceId: 'w3-1001-a7', studentId: 'S1001', name: '李小满', activityId: 'a-7', date: '2026-09-25', phonemes: ['/m/', '/æ/', '/s/'], score: 74 },

    { sourceId: 'w3-1002-a1', studentId: 'S1002', name: '陈安然', activityId: 'a-1', date: '2026-09-22', phonemes: ['/m/'], score: 95 },
    { sourceId: 'w3-1002-a2', studentId: 'S1002', name: '陈安然', activityId: 'a-2', date: '2026-09-22', phonemes: ['/s/', '/m/'], score: 78 },
    { sourceId: 'w3-1002-a3', studentId: 'S1002', name: '陈安然', activityId: 'a-3', date: '2026-09-23', phonemes: ['/s/', '/æ/', '/t/'], score: 55 },
    // 冲突：包一中先记录为通过，包四会给出未通过
    { sourceId: 'w3-1002-a6', studentId: 'S1002', name: '陈安然', activityId: 'a-6', date: '2026-09-25', phonemes: ['/m/', '/æ/', '/s/', '/t/'], score: 68 },

    { sourceId: 'w3-1003-a1', studentId: 'S1003', name: '王大力', activityId: 'a-1', date: '2026-09-22', phonemes: ['/m/'], score: 70 },
    { sourceId: 'w3-1003-a2', studentId: 'S1003', name: '王大力', activityId: 'a-2', date: '2026-09-22', phonemes: ['/s/', '/m/'], score: 42 },

    // 缺学生编号：导出系统漏号，需要按姓名 + 日期 + 音素确认
    { sourceId: 'w3-noid-1', name: '赵小童', activityId: 'a-1', date: '2026-09-24', phonemes: ['/m/'], score: 83 },
    // 缺活动编号：可按音素 /s/ /m/ 建议到 a-2
    { sourceId: 'w3-noact-1', studentId: 'S1004', name: '孙一诺', date: '2026-09-24', phonemes: ['/s/', '/m/'], score: 79 },

    // 与首条完全相同的重复上传：只记一次
    { sourceId: 'w3-1001-a1', studentId: 'S1001', name: '李小满', activityId: 'a-1', date: '2026-09-22', phonemes: ['/m/'], score: 92 }
  ]
};

// 包四覆盖：分数修订（a-3 从 55 → 82，旧补练失效重算）、冲突（a-6 新结果未通过）、前置补齐。
export const demoPackageWeek4: ResultPackageInput = {
  packageId: 'listen-pkg-w4',
  label: '第四周课堂听读结果包',
  source: '课堂听读小程序',
  exportedAt: '2026-09-29T16:30:00+08:00',
  results: [
    // 同一记录编号、分数变化：触发修订链与补练重算
    { sourceId: 'w3-1002-a3', studentId: 'S1002', name: '陈安然', activityId: 'a-3', date: '2026-09-23', phonemes: ['/s/', '/æ/', '/t/'], score: 82 },
    // 冲突：与包一的 68 分通过结果矛盾
    { sourceId: 'w4-1002-a6', studentId: 'S1002', name: '陈安然', activityId: 'a-6', date: '2026-09-28', phonemes: ['/m/', '/æ/', '/s/', '/t/'], score: 47 },

    // 前置补齐：S1001 通过 a-3/a-4 后，a-7 的前置缺口自动核销
    { sourceId: 'w4-1001-a3', studentId: 'S1001', name: '李小满', activityId: 'a-3', date: '2026-09-28', phonemes: ['/s/', '/æ/', '/t/'], score: 78 },
    { sourceId: 'w4-1001-a4', studentId: 'S1001', name: '李小满', activityId: 'a-4', date: '2026-09-28', phonemes: ['/m/', '/s/'], score: 72 },

    // 王大力补练后仍需关注：a-2 仍未达标
    { sourceId: 'w4-1003-a2', studentId: 'S1003', name: '王大力', activityId: 'a-2', date: '2026-09-28', phonemes: ['/s/', '/m/'], score: 51 }
  ]
};

export const demoPackages: Array<{ key: string; label: string; data: ResultPackageInput }> = [
  { key: 'w3', label: '载入示例：第三周结果包', data: demoPackageWeek3 },
  { key: 'w4', label: '载入示例：第四周结果包（修订与冲突）', data: demoPackageWeek4 }
];
