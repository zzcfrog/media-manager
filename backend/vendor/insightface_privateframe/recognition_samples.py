"""Unmodified selections from InsightFace PrivateFrame recognition.py; see NOTICE.md."""
from __future__ import annotations
from dataclasses import dataclass
from collections.abc import Sequence
from typing import Any
import math
import cv2
import numpy as np
ARC_FACE_TEMPLATE_112 = np.asarray([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]],dtype=np.float32)
ARC_FACE_TEMPLATE_112.setflags(write=False)
RECOGNITION_LANDMARK_SOURCES = frozenset({'local_scrfd','global_scrfd'})


def _landmark_array(value: Any) -> np.ndarray:
    landmarks = np.asarray(value, dtype=np.float64)
    if landmarks.shape != (5, 2):
        raise ValueError(f"ArcFace alignment requires five 2D landmarks, received {landmarks.shape}")
    if not np.all(np.isfinite(landmarks)):
        raise ValueError("ArcFace landmarks must be finite")
    centered = landmarks - np.mean(landmarks, axis=0, keepdims=True)
    if float(np.sum(centered * centered)) <= np.finfo(np.float64).eps:
        raise ValueError("ArcFace landmarks are degenerate")
    return landmarks

def estimate_arcface_similarity(landmarks: Any) -> np.ndarray:
    """Estimate the least-squares similarity mapping into the ArcFace 112 template."""

    source = _landmark_array(landmarks)
    destination = ARC_FACE_TEMPLATE_112.astype(np.float64)
    source_mean = np.mean(source, axis=0)
    destination_mean = np.mean(destination, axis=0)
    source_centered = source - source_mean
    destination_centered = destination - destination_mean
    covariance = destination_centered.T @ source_centered / len(source)
    left, singular_values, right_transposed = np.linalg.svd(covariance)
    correction = np.eye(2, dtype=np.float64)
    if np.linalg.det(left) * np.linalg.det(right_transposed) < 0.0:
        correction[-1, -1] = -1.0
    rotation = left @ correction @ right_transposed
    variance = float(np.sum(source_centered * source_centered) / len(source))
    scale = float(np.sum(singular_values * np.diag(correction)) / variance)
    translation = destination_mean - scale * (rotation @ source_mean)
    matrix = np.column_stack((scale * rotation, translation)).astype(np.float32)
    if not np.all(np.isfinite(matrix)):
        raise ValueError("ArcFace similarity transform is not finite")
    return matrix

def recognition_candidate_quality(
    aligned_bgr: np.ndarray,
    detector_box: Any,
    landmarks: Any,
    confidence: float,
    source_shape: Sequence[int],
    *,
    scan_angle_degrees: int = 0,
) -> tuple[float, bool, dict[str, float]]:
    """Rank identity anchors and reject geometrically unreliable alignments.

    These constants are an internal recognizer profile, not user-facing
    configuration. The gate is intentionally conservative because a rejected
    candidate makes a track UNKNOWN (handled by the selected policy), while a poor crop
    can create an unsafe false exemption.
    """

    aligned = np.asarray(aligned_bgr)
    if aligned.shape != (112, 112, 3):
        raise ValueError("recognition quality requires one aligned 112x112 BGR crop")
    if len(source_shape) < 2:
        raise ValueError("recognition source shape must contain height and width")
    height, width = int(source_shape[0]), int(source_shape[1])
    if height <= 0 or width <= 0:
        raise ValueError("recognition source dimensions must be positive")
    points = _landmark_array(landmarks)
    box = np.asarray(detector_box, dtype=np.float64).reshape(4)
    if not np.all(np.isfinite(box)):
        raise ValueError("recognition detector box must be finite")
    minimum_side = max(0.0, min(float(box[2] - box[0]), float(box[3] - box[1])))
    detector_confidence = float(np.clip(confidence, 0.0, 1.0))

    left_eye, right_eye, nose, left_mouth, right_mouth = points
    eye_left = float(np.linalg.norm(nose - left_eye))
    eye_right = float(np.linalg.norm(nose - right_eye))
    mouth_left = float(np.linalg.norm(nose - left_mouth))
    mouth_right = float(np.linalg.norm(nose - right_mouth))
    if min(eye_left, eye_right, mouth_left, mouth_right) <= 1e-6:
        pose = 0.0
    else:
        pose = min(
            min(eye_left, eye_right) / max(eye_left, eye_right),
            min(mouth_left, mouth_right) / max(mouth_left, mouth_right),
        )

    matrix = estimate_arcface_similarity(points)
    projected = np.column_stack((points, np.ones(5))) @ matrix.T
    residual = float(
        np.sqrt(
            np.mean(
                np.sum(
                    (projected - ARC_FACE_TEMPLATE_112.astype(np.float64)) ** 2,
                    axis=1,
                )
            )
        )
    )
    inverse = cv2.invertAffineTransform(matrix)
    # A fixed 16x16 target grid estimates crop coverage to within far less than
    # the deliberately broad 0.55 gate, without adding a second full warp.
    axis = np.linspace(0.0, 111.0, 16, dtype=np.float32)
    grid_x, grid_y = np.meshgrid(axis, axis)
    target = np.column_stack((grid_x.reshape(-1), grid_y.reshape(-1), np.ones(grid_x.size)))
    source = target @ inverse.T
    coverage = float(
        np.mean(
            (source[:, 0] >= 0.0) & (source[:, 0] < width) & (source[:, 1] >= 0.0) & (source[:, 1] < height)
        )
    )

    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    geometry_score = math.exp(-((residual / 8.0) ** 2))
    detail_score = float(np.clip(math.log1p(laplacian_variance) / math.log1p(500.0), 0.0, 1.0))
    size_score = float(np.clip(minimum_side / 112.0, 0.0, 1.0))
    view_score = 1.0 if int(scan_angle_degrees) == 0 else 0.75
    quality = max(
        1e-6,
        detector_confidence
        * coverage
        * (0.5 + 0.5 * pose)
        * (0.5 + 0.5 * geometry_score)
        * (0.7 + 0.3 * detail_score)
        * (0.7 + 0.3 * size_score)
        * view_score,
    )
    eligible = bool(
        detector_confidence >= 0.50
        and minimum_side >= 32.0
        and coverage >= 0.55
        and pose >= 0.20
        and residual <= 10.0
        and laplacian_variance >= 20.0
        and contrast >= 12.0
    )
    return (
        quality,
        eligible,
        {
            "confidence": detector_confidence,
            "minimum_side": minimum_side,
            "pose_score": pose,
            "alignment_residual": residual,
            "source_coverage": coverage,
            "laplacian_variance": laplacian_variance,
            "contrast": contrast,
            "view_score": view_score,
        },
    )

@dataclass(frozen=True)
class RecognitionCandidate:
    """A bounded, aligned crop retained by Streaming for later inference."""

    frame_index: int
    quality: float
    aligned_face: np.ndarray
    landmark_source: str = "local_scrfd"

    def __post_init__(self) -> None:
        if self.frame_index < 0:
            raise ValueError("recognition candidate frame_index must be non-negative")
        if not math.isfinite(float(self.quality)) or float(self.quality) <= 0.0:
            raise ValueError("recognition candidate quality must be finite and positive")
        if np.asarray(self.aligned_face).shape != (112, 112, 3):
            raise ValueError("recognition candidate must contain a 112x112 BGR crop")
        if self.landmark_source not in RECOGNITION_LANDMARK_SOURCES:
            raise ValueError(
                "recognition candidate landmark_source must be local_scrfd or global_scrfd"
            )

def select_temporally_distributed(
    candidates: Sequence[RecognitionCandidate],
    max_frames: int,
) -> list[RecognitionCandidate]:
    """Choose one landmark proposal per time, distributed over the track.

    Local-SCRFD proposals take precedence inside a temporal bucket. A global
    SCRFD proposal is used when the bucket has no local proposal; quality then
    breaks ties within the preferred source. Collapsing same-frame proposals
    before bucketing prevents two crops from one instant from being counted as
    independent temporal evidence.
    """

    maximum = int(max_frames)
    if maximum <= 0:
        raise ValueError("max_frames must be positive")
    source_rank = {"local_scrfd": 0, "global_scrfd": 1}
    ordered_all = sorted(
        candidates,
        key=lambda item: (
            item.frame_index,
            source_rank[item.landmark_source],
            -item.quality,
        ),
    )
    ordered: list[RecognitionCandidate] = []
    for candidate in ordered_all:
        if ordered and candidate.frame_index == ordered[-1].frame_index:
            continue
        ordered.append(candidate)
    if len(ordered) <= maximum:
        return ordered
    first = ordered[0].frame_index
    last = ordered[-1].frame_index
    if first == last:
        return sorted(
            ordered,
            key=lambda item: (
                source_rank[item.landmark_source],
                -item.quality,
                item.frame_index,
            ),
        )[:maximum]
    buckets: list[list[RecognitionCandidate]] = [[] for _ in range(maximum)]
    span = last - first
    for candidate in ordered:
        bucket = min(
            maximum - 1,
            int((candidate.frame_index - first) * maximum / (span + 1)),
        )
        buckets[bucket].append(candidate)
    selected = [
        min(
            bucket,
            key=lambda item: (
                source_rank[item.landmark_source],
                -item.quality,
                item.frame_index,
            ),
        )
        for bucket in buckets
        if bucket
    ]
    selected_ids = {id(value) for value in selected}
    while len(selected) < maximum:
        remaining = [value for value in ordered if id(value) not in selected_ids]
        value = max(
            remaining,
            key=lambda item: (
                min(abs(item.frame_index - chosen.frame_index) for chosen in selected),
                -source_rank[item.landmark_source],
                item.quality,
                -item.frame_index,
            ),
        )
        selected.append(value)
        selected_ids.add(id(value))
    return sorted(selected, key=lambda item: item.frame_index)
