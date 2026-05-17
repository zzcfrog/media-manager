import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
import os

from compressor import compress_video
from analyzer import analyze_video, CODING_BASE_URL
from formatter import save_results


def main():
    parser = argparse.ArgumentParser(description="Analyze video using GLM vision model")
    parser.add_argument("video", help="Path to the video file")
    parser.add_argument("--output-dir", default="./output", help="Output directory (default: ./output)")
    parser.add_argument("--model", default="glm-4.6v", help="GLM model name (default: glm-4.6v)")
    parser.add_argument("--keep-compressed", action="store_true", help="Keep compressed video after analysis")
    args = parser.parse_args()

    load_dotenv()
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        print("Error: ZHIPUAI_API_KEY not set. Create a .env file with your API key.", file=sys.stderr)
        sys.exit(1)

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"Error: video file not found: {video_path}", file=sys.stderr)
        sys.exit(1)

    compressed_path = None
    try:
        compressed_path, compress_time = compress_video(video_path)

        segments, analyze_time, usage = analyze_video(compressed_path, api_key, model=args.model, base_url=CODING_BASE_URL)

        save_results(segments, video_path, args.output_dir)

    finally:
        if compressed_path and not args.keep_compressed and compressed_path.exists():
            compressed_path.unlink()
            print(f"\nDeleted compressed video: {compressed_path.name}")

    print("\n=== Summary ===")
    print(f"Compress time:  {compress_time:.1f}s")
    print(f"Analyze time:   {analyze_time:.1f}s")
    if usage:
        print(f"Tokens:         prompt {usage['prompt']}, completion {usage['completion']}, total {usage['total']}")
    print("Done!")


if __name__ == "__main__":
    main()
