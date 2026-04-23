"""字段校验逻辑."""

DIFFICULTIES = {"L1", "L2", "L3", "L4"}

DOMAINS = {
    "递送系统 C1",
    "基因治疗 C2",
    "细胞工程 C3",
}

SOURCE_TYPES = {"原创", "文献改编", "教材改编", "数据库条目改编"}

STATUSES = {"pending", "approved", "needs_revision"}

PRESET_REVISION_REASONS = [
    "题目描述不清晰",
    "采分点设置违规",
    "参考答案错误/不完整",
    "溯源信息缺失",
    "领域不符",
    "其他",
]


def _err(field, message):
    return {"field": field, "message": message}


def validate_question_payload(data: dict, is_update: bool = False) -> list:
    """返回错误列表,空列表代表校验通过."""
    errors = []

    title = (data.get("title") or "").strip()
    if not title:
        errors.append(_err("title", "题目标题必填"))
    elif len(title) > 500:
        errors.append(_err("title", "题目标题不得超过 500 字"))

    difficulty = data.get("difficulty")
    if difficulty not in DIFFICULTIES:
        errors.append(_err("difficulty", f"难度等级必须为 {sorted(DIFFICULTIES)} 之一"))

    domain = data.get("domain")
    if domain not in DOMAINS:
        errors.append(_err("domain", "领域大类不合法"))

    content = (data.get("content") or "").strip()
    if not content:
        errors.append(_err("content", "题目正文必填"))

    rubric = data.get("rubric") or []
    if not isinstance(rubric, list):
        errors.append(_err("rubric", "采分点必须是列表"))
    else:
        if not (3 <= len(rubric) <= 5):
            errors.append(_err("rubric", "采分点数量必须为 3-5 个"))
        total = 0
        for idx, item in enumerate(rubric):
            desc = (item.get("desc") or "").strip() if isinstance(item, dict) else ""
            try:
                score = float(item.get("score", 0)) if isinstance(item, dict) else 0
            except (TypeError, ValueError):
                score = -1
            if not desc:
                errors.append(_err(f"rubric[{idx}].desc", "采分点描述必填"))
            if score <= 0:
                errors.append(_err(f"rubric[{idx}].score", "采分点分值必须为正数"))
            total += score
        if abs(total - 10) > 1e-6:
            errors.append(_err("rubric", f"采分点总分必须为 10(当前 {total})"))

    ref_answer = (data.get("reference_answer") or "").strip()
    if difficulty in ("L1", "L2") and not ref_answer:
        errors.append(_err("reference_answer", "L1/L2 难度题目参考答案必填"))

    source_type = data.get("source_type")
    if source_type not in SOURCE_TYPES:
        errors.append(_err("source_type", "题目来源不合法"))
    if source_type and source_type != "原创":
        if not (data.get("source_detail") or "").strip():
            errors.append(_err("source_detail", "改编类题目必须填写来源详情"))

    if not is_update:
        if not (data.get("author_name") or "").strip():
            errors.append(_err("author_name", "出题人姓名必填"))

    return errors


def validate_review_payload(data: dict) -> list:
    errors = []
    status = data.get("status")
    if status not in {"approved", "needs_revision"}:
        errors.append(_err("status", "审核状态必须为 approved 或 needs_revision"))

    if status == "needs_revision":
        if not (data.get("review_comment") or "").strip():
            errors.append(_err("review_comment", "需修改时必须填写审核意见"))
        reasons = data.get("revision_reasons") or []
        if not isinstance(reasons, list) or not reasons:
            errors.append(_err("revision_reasons", "需修改时必须勾选至少一个预设原因"))
        else:
            for r in reasons:
                if r not in PRESET_REVISION_REASONS:
                    errors.append(_err("revision_reasons", f"非法修改原因: {r}"))
                    break

    if not (data.get("reviewer_name") or "").strip():
        errors.append(_err("reviewer_name", "审核人姓名必填"))

    return errors
