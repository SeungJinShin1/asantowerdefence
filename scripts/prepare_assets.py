"""이미지 자산 정리 — assets/raw/*.png → frontend/public/assets/{towers,enemies,base}/ (docs: assets/prompts/gemini_image_prompts.md §1·§3).

처리: RGBA 변환 → (배경이 불투명하면) 가장자리에서 이어진 흰 배경을 flood-fill 로 투명화 + 1px 테두리 다듬기
      → 투명 여백 트림 → 정사각 패딩(여백 4%) → 표의 크기로 리사이즈(LANCZOS) → 최적화 PNG 저장.
Gemini 가 준 "순백 배경 + 진한 외곽선" 이미지에 맞춘 가벼운 방법이다. 결과가 거칠면 rembg 로 다시 만들어 --no-fill 로 실행한다.

사용:  backend/.venv/Scripts/python.exe scripts/prepare_assets.py [--raw assets/raw] [--out frontend/public/assets] [--no-fill]
의존성: Pillow (backend venv 에 설치)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SIZES: dict[str, tuple[str, int]] = {
    # 파일명 접두 → (출력 하위 폴더, 한 변 px)
    "tower_": ("towers", 256),
    "enemy_": ("enemies", 192),
    "boss_": ("enemies", 320),
    "base_": ("base", 320),
}
MARGIN_RATIO = 0.04
ALPHA_THRESHOLD = 8
WORK_SIZE = 1024  # 배경 제거는 이 크기에서(속도), 출력은 192~320px 이라 품질 손실 없음
FILL_TOLERANCE = 48  # 흰색으로 볼 RGB 거리(0~255·3채널 합산 기준의 PIL thresh)
SENTINEL = (255, 0, 255, 255)
TOTAL_BUDGET_BYTES = 3 * 1024 * 1024


def target_for(name: str) -> tuple[str, int] | None:
    for prefix, spec in SIZES.items():
        if name.startswith(prefix):
            return spec
    return None


def is_transparent(img: Image.Image) -> bool:
    lo, _hi = img.getchannel("A").getextrema()
    return lo < 255


def remove_white_background(img: Image.Image) -> Image.Image:
    """네 변·네 모서리에서 이어진 흰색 영역을 투명하게 만든다(안쪽의 흰색은 보존). 테두리 1px 을 깎아 흰 halo 를 줄인다."""
    work = img.convert("RGBA")
    if max(work.size) > WORK_SIZE:
        work = work.resize((WORK_SIZE, WORK_SIZE), Image.LANCZOS)
    w, h = work.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for seed in seeds:
        r, g, b, _a = work.getpixel(seed)
        if min(r, g, b) < 255 - FILL_TOLERANCE:
            continue  # 시작점이 흰색이 아니면(피사체가 가장자리에 닿음) 건너뜀
        ImageDraw.floodfill(work, seed, SENTINEL, thresh=FILL_TOLERANCE)
    # 센티널 픽셀 → 알파 0
    mask = work.point(lambda _v: 0)  # placeholder, 아래에서 채널별 계산
    r, g, b, _ = work.split()
    sentinel_mask = Image.eval(
        Image.merge("RGB", (r, g, b)).convert("L", (1, 0, 0, 0)),  # R 채널만
        lambda v: 255 if v == 255 else 0,
    )
    # R==255 이면서 G==0, B==255 인 곳만 센티널 — G 채널로 한 번 더 거른다
    g_mask = Image.eval(g, lambda v: 255 if v == 0 else 0)
    b_mask = Image.eval(b, lambda v: 255 if v == 255 else 0)
    from PIL import ImageChops

    background = ImageChops.multiply(ImageChops.multiply(sentinel_mask, g_mask), b_mask)
    alpha = ImageChops.invert(background)
    # 테두리 1px 깎기(흰 halo 완화) 후 살짝 부드럽게
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    del mask
    result = img.convert("RGBA").resize(work.size, Image.LANCZOS)
    result.putalpha(alpha)
    return result


def trim_and_square(img: Image.Image) -> Image.Image:
    """투명 여백을 잘라내고 정사각형(여백 포함)으로 맞춘다."""
    img = img.convert("RGBA")
    alpha = img.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > ALPHA_THRESHOLD else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    side = int(max(img.size) * (1 + MARGIN_RATIO * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas


def process(raw_dir: Path, out_dir: Path, *, fill: bool) -> int:
    files = sorted(raw_dir.glob("*.png"))
    if not files:
        print(f"원본이 없어요: {raw_dir}")
        return 2
    total = 0
    problems: list[str] = []
    for path in files:
        spec = target_for(path.name)
        if spec is None:
            problems.append(f"{path.name}: 이름 규칙(tower_/enemy_/boss_/base_)에 맞지 않아 건너뜀")
            continue
        folder, size = spec
        with Image.open(path) as opened:
            img = opened.convert("RGBA")
            note = ""
            if not is_transparent(img):
                if fill:
                    img = remove_white_background(img)
                    note = " (흰 배경 제거)"
                else:
                    problems.append(f"{path.name}: 배경이 투명하지 않음 — rembg 로 배경 제거 필요")
            squared = trim_and_square(img)
        resized = squared.resize((size, size), Image.LANCZOS)
        dest = out_dir / folder / path.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        resized.save(dest, format="PNG", optimize=True)
        bytes_ = dest.stat().st_size
        total += bytes_
        print(f"{path.name:26} → {folder}/{dest.name:26} {size}x{size} {bytes_ / 1024:6.1f}KB{note}")
    print(f"\n총 {total / 1024 / 1024:.2f}MB (목표 {TOTAL_BUDGET_BYTES / 1024 / 1024:.0f}MB 이하)")
    for p in problems:
        print("경고:", p)
    if total > TOTAL_BUDGET_BYTES:
        print("경고: 총합이 목표를 넘었어요. pngquant 로 더 줄이거나 크기를 낮추세요.")
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", default=str(ROOT / "assets" / "raw"))
    parser.add_argument("--out", default=str(ROOT / "frontend" / "public" / "assets"))
    parser.add_argument("--no-fill", action="store_true", help="흰 배경 flood-fill 제거를 하지 않는다")
    args = parser.parse_args()
    return process(Path(args.raw), Path(args.out), fill=not args.no_fill)


if __name__ == "__main__":
    sys.exit(main())
