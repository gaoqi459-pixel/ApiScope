"""ApiScope 图标生成器：绘制一张放大镜+雷达扫描样式的图标，输出 16/48/128 三种尺寸 PNG。"""
import math
from PIL import Image, ImageDraw

def make_icon(size):
    s = float(size)
    # 背景圆角矩形（深色）
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = s * 0.22
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(20, 26, 36, 255))

    cx, cy = s * 0.48, s * 0.46          # 镜片圆心
    lens_r = s * 0.26                    # 镜片半径
    ring_w = max(1.0, s * 0.045)         # 镜框粗细

    # 雷达圆弧（镜片内部扫描扇区）
    sweep = 100
    d.pieslice(
        [cx - lens_r, cy - lens_r, cx + lens_r, cy + lens_r],
        start=-90, end=-90 + sweep,
        fill=(79, 140, 255, 220)
    )
    # 扫描线
    d.line(
        [cx, cy, cx + lens_r * math.cos(math.radians(-90 + sweep)),
         cy + lens_r * math.sin(math.radians(-90 + sweep))],
        fill=(140, 185, 255, 255), width=max(1, int(s * 0.03))
    )
    # 目标点
    for (dx, dy, pr) in [(0.35, -0.15, 0.05), (-0.3, -0.35, 0.045), (-0.15, 0.3, 0.03)]:
        d.ellipse(
            [cx + lens_r * dx - lens_r * pr, cy + lens_r * dy - lens_r * pr,
             cx + lens_r * dx + lens_r * pr, cy + lens_r * dy + lens_r * pr],
            fill=(46, 204, 113, 255)
        )
    # 镜片外框
    d.ellipse(
        [cx - lens_r, cy - lens_r, cx + lens_r, cy + lens_r],
        outline=(140, 185, 255, 255), width=int(ring_w)
    )
    # 镜柄
    hx, hy = cx + lens_r * 0.8, cy + lens_r * 0.8
    ex, ey = hx + s * 0.22, hy + s * 0.22
    d.line([hx, hy, ex, ey], fill=(200, 215, 235, 255), width=int(s * 0.09))

    return img

if __name__ == "__main__":
    out_dir = r"E:\AI\ctf\ApiScope\icons"
    import os
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 48, 128):
        img = make_icon(size)
        path = os.path.join(out_dir, f"icon{size}.png")
        img.save(path)
        print("saved", path)
