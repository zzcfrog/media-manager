"""情绪标签单一事实源：32 标签词表 + 效价/唤醒锚点 + 派生计算。

模型：Russell 效价×唤醒二维骨架 + 分类标签表层（Plutchik/Parrott 式）。
- valence（效价）：-1(很坏) ~ +1(很好)，0 = 中性。情绪的"好坏/趋避"倾向。
- arousal（唤醒）：0(极静) ~ 1(极动)。情绪的"激活强度"。
两根轴独立：兴奋(正+高) vs 焦虑(负+高) 唤醒相近但效价相反；满足(正+低) vs 消沉(负+低) 都静但感觉相反。
"""

# 32 标签 → (valence, arousal, 象限, 典型场景)
# 象限: "+高" 正效价高唤醒 / "+低" 正效价低唤醒 / "中" 中性 / "-高" 负效价高唤醒 / "-低" 负效价低唤醒
EMOTION_LABELS = {
    # ── 正效价·高唤醒（又好又激动）──
    "欢快": (0.80, 0.75, "+高", "笑闹、庆祝、活泼日常"),
    "兴奋": (0.75, 0.95, "+高", "刺激、玩闹高潮、心跳"),
    "激情": (0.60, 0.90, "+高", "热血、拼搏、全力投入"),
    "壮丽": (0.70, 0.80, "+高", "大山大河、日落云海、震撼的美"),
    "震撼": (0.45, 0.95, "+高", "巨物、爆裂、压倒性场面"),
    "自由": (0.70, 0.70, "+高", "辽阔、飞翔、公路、冒险"),
    "热闹": (0.60, 0.70, "+高", "集市、节日、人群、烟火"),
    "期待": (0.55, 0.60, "+高", "展望、将要发生的好事"),
    # ── 正效价·低唤醒（舒服但平静）──
    "温馨": (0.75, 0.30, "+低", "家庭、亲密、柔软时刻"),
    "浪漫": (0.65, 0.35, "+低", "情侣、暧昧、柔光"),
    "治愈": (0.65, 0.22, "+低", "可爱、柔和、被抚慰"),
    "宁静": (0.50, 0.18, "+低", "空灵、禅意、静止的美"),
    "惬意": (0.55, 0.28, "+低", "慵懒、午后、闲适"),
    "怀旧": (0.30, 0.30, "+低", "回忆、旧时光、泛黄"),
    "梦幻": (0.40, 0.30, "+低", "朦胧、童话、超现实"),
    "唯美": (0.55, 0.22, "+低", "纯粹的美、构图精致"),
    # ── 中性 ──
    "平静": (0.00, 0.25, "中", "客观记录、日常、无明显倾向"),
    "神秘": (-0.10, 0.45, "中", "未知、迷雾、科幻/悬疑未明"),
    "庄重": (0.00, 0.40, "中", "仪式、肃穆、企业/正式"),
    "惊讶": (0.00, 0.85, "中", "突发、意外、反转（正负皆可）"),
    # ── 负效价·高唤醒（难受且激动）──
    "紧张": (-0.55, 0.80, "-高", "危险将至、压迫、竞技"),
    "悬疑": (-0.45, 0.70, "-高", "不安、未知将发生、探案"),
    "恐怖": (-0.80, 0.90, "-高", "阴森、惊吓、灵异"),
    "惊悚": (-0.30, 0.85, "-高", "又怕又爽（娱乐向惊吓）"),
    "愤怒": (-0.70, 0.85, "-高", "冲突、对抗、激烈"),
    # ── 负效价·低唤醒（难受且低落）──
    "忧伤": (-0.55, 0.30, "-低", "失落、悲、雨景"),
    "孤独": (-0.45, 0.22, "-低", "空旷、独处、冷清"),
    "压抑": (-0.60, 0.35, "-低", "沉重、窒息、灰暗"),
    "凄美": (-0.30, 0.30, "-低", "哀而不伤、唯美之悲"),
    "迷茫": (-0.35, 0.30, "-低", "不确定、成长/内省"),
    "落寞": (-0.40, 0.20, "-低", "凄凉、人走茶凉"),
    "绝望": (-0.75, 0.45, "-低", "彻底失去、无路"),
}

_QUADRANT_ORDER = ["+高", "+低", "中", "-高", "-低"]
_QUADRANT_TITLE = {
    "+高": "正效价·高唤醒（又好又激动）",
    "+低": "正效价·低唤醒（舒服但平静）",
    "中": "中性",
    "-高": "负效价·高唤醒（难受且激动）",
    "-低": "负效价·低唤醒（难受且低落）",
}


def render_label_table():
    """渲染词表为可注入 prompt 的文本块。"""
    lines = [
        "情绪标签词表（只能从以下 32 个中选取，效价 -1~+1 / 0=中性，唤醒 0~1）：",
    ]
    for q in _QUADRANT_ORDER:
        lines.append(f"【{_QUADRANT_TITLE[q]}】")
        for label, (va, ar, quad, desc) in EMOTION_LABELS.items():
            if quad != q:
                continue
            lines.append(f"  - {label}（效价{va:+.2f}/唤醒{ar:.2f}）：{desc}")
    lines += [
        "",
        "维度说明：效价=情绪的好坏/趋避倾向（正=愉悦吸引，负=难受回避）；唤醒=激活强度（越高越激动、越低越静）。",
        "同一分片的情绪常由多种成分按权重交织，请输出 2-3 个成分的分布，而非单一标签。",
    ]
    return "\n".join(lines)


def _to_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def aggregate_emotions(emotions):
    """输入情绪分布 [{mood, weight, intensity}, ...]，派生 {arousal, valence, dominant}。

    - 无效/未知 mood 成分被丢弃；权重按比例归一化
    - intensity 缺省回落到该标签锚点 arousal
    - arousal = Σ(weight × intensity) / Σweight，值域 0~1，与情绪曲线同轴
    - valence = Σ(weight × 锚点valence) / Σweight，值域 -1~+1
    - dominant = weight 最大的成分 mood（并列取靠前者）
    - 空分布或全无效 → 各字段 None
    """
    if not emotions:
        return {"arousal": None, "valence": None, "dominant": None}
    comps = []
    for e in emotions or []:
        if not isinstance(e, dict):
            continue
        mood = e.get("mood")
        if not mood or mood not in EMOTION_LABELS:
            continue
        w = _to_float(e.get("weight", 0), 0) or 0
        if w <= 0:
            continue
        anchor_va, anchor_ar, _, _ = EMOTION_LABELS[mood]
        intensity = _to_float(e.get("intensity"), None)
        if intensity is None:
            intensity = anchor_ar
        intensity = max(0.0, min(1.0, intensity))
        comps.append((mood, w, intensity, anchor_va))
    if not comps:
        return {"arousal": None, "valence": None, "dominant": None}
    total_w = sum(w for _, w, _, _ in comps)
    if total_w <= 0:
        return {"arousal": None, "valence": None, "dominant": None}
    arousal = sum(w * intensity for _, w, intensity, _ in comps) / total_w
    valence = sum(w * va for _, w, _, va in comps) / total_w
    dominant = max(comps, key=lambda c: c[1])[0]
    return {"arousal": round(arousal, 3), "valence": round(valence, 3), "dominant": dominant}


def dominant_mood(emotions):
    """返回分布的主导标签，供回填老 mood 列；无有效成分返回 None。"""
    return aggregate_emotions(emotions)["dominant"]
