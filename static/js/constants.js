// 常量定义
export const DIFFICULTIES = [
    { value: "L1", label: "L1 精准事实检索", desc: "围绕 CGT 基础事实、定义与已知信息检索" },
    { value: "L2", label: "L2 生物逻辑推演", desc: "围绕机制、因果关系与路径进行生物逻辑分析" },
    { value: "L3", label: "L3 实验方案设计", desc: "围绕载体构建、验证流程与实验设计展开" },
    { value: "L4", label: "L4 转化决策与创新", desc: "围绕临床转化、工艺取舍与创新策略判断" },
];

export const DOMAINS = [
    "递送系统 C1",
    "基因治疗 C2",
    "细胞工程 C3",
];

export const SOURCE_TYPES = ["原创", "文献改编", "教材改编", "数据库条目改编"];

export const STATUS_META = {
    pending: { label: "待审核", cls: "badge-pending", emoji: "⏳" },
    approved: { label: "已审核", cls: "badge-approved", emoji: "✅" },
    needs_revision: { label: "需修改", cls: "badge-needs_revision", emoji: "⚠️" },
};

export const PRESET_REVISION_REASONS = [
    "题目描述不清晰",
    "采分点设置违规",
    "参考答案错误/不完整",
    "溯源信息缺失",
    "领域不符",
    "其他",
];
