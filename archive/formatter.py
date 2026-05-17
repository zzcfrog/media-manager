import json
from pathlib import Path


def format_as_markdown(segments: list[dict]) -> str:
    if not segments:
        return "No analysis results."

    if "raw_response" in segments[0]:
        return f"## Raw Response\n\n{segments[0]['raw_response']}"

    lines = [
        "# Video Analysis Report",
        "",
        "| Time Start | Time End | Visual | ASR | Subtitle | Dominant Colors | Main Subjects | Shot Type | Focal Length | Camera Angle | Camera Movement | Perspective | Scene Type | Mood | Lighting | Weather |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]

    for seg in segments:
        colors = ", ".join(seg.get("dominant_colors", [])) or "N/A"
        subjects = ", ".join(seg.get("main_subjects", [])) or "N/A"
        lines.append(
            f"| {seg.get('time_start', 'N/A')} "
            f"| {seg.get('time_end', 'N/A')} "
            f"| {seg.get('visual', 'N/A')} "
            f"| {seg.get('asr', 'N/A')} "
            f"| {seg.get('subtitle', 'N/A')} "
            f"| {colors} "
            f"| {subjects} "
            f"| {seg.get('shot_type', 'N/A')} "
            f"| {seg.get('focal_length', 'N/A')} "
            f"| {seg.get('camera_angle', 'N/A')} "
            f"| {seg.get('camera_movement', 'N/A')} "
            f"| {seg.get('perspective', 'N/A')} "
            f"| {seg.get('scene_type', 'N/A')} "
            f"| {seg.get('mood', 'N/A')} "
            f"| {seg.get('lighting', 'N/A')} "
            f"| {seg.get('weather', 'N/A')} |"
        )

    return "\n".join(lines)


def save_results(
    segments: list[dict],
    video_path: str | Path,
    output_dir: str | Path = "./output",
) -> tuple[Path, Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    video_path = Path(video_path)
    base_name = video_path.stem

    md_path = output_dir / f"{base_name}_analysis.md"
    md_path.write_text(format_as_markdown(segments), encoding="utf-8")
    print(f"Markdown saved: {md_path}")

    data = {
        "source_video": str(video_path.resolve()),
        "segments": segments,
    }
    json_path = output_dir / f"{base_name}_analysis.json"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"JSON saved: {json_path}")

    return md_path, json_path
