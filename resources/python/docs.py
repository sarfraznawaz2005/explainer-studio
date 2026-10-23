"""
Document helper for Explainer Studio. One-shot: each run does one command and
prints JSON lines on stdout (progress and results). Library output goes to stderr.

  docs.py pdf  --file F.pdf --pages 1,2,3 --out DIR [--scale 2] [--render auto|all|none]
      per page: {"type":"page","page":n,"chars":k,"coverage":0.97,"render":".../p0001.png"|null,
                 "figures":[{"path","width","height","bbox":[x0,y0,x1,y1]}]}   (bbox in 0..1000, top-left origin)
  docs.py ocr  --images a.png b.png
      per image: {"type":"ocr","image":path,"width","height","lines":[{"text","box":[x0,y0,x1,y1],"score"}]}
  docs.py crop --jobs JOBS.json
      JOBS.json = [{"image","box":[x0,y0,x1,y1] (0..1000),"out"}] → {"type":"crop","out","width","height"}
  docs.py info --file F.pdf → {"type":"info","pages":n}

Paths come from the app, never from the network. Outputs are written only under the
given out folder / out paths.
"""

import argparse
import hashlib
import json
import os
import sys

PROTOCOL = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

# Image objects smaller than this share of the page are icons or bullets, not figures.
MIN_FIGURE_AREA = 0.02
MIN_FIGURE_PX = 64
# An image covering most of the page is the scan itself.
SCAN_COVERAGE = 0.6
SCANNED_MAX_CHARS = 80
# Page borders, headers and corner art touch the page edge (in 0..1000 units).
EDGE = 15


def touches_edge(box):
    x0, y0, x1, y1 = box
    return x0 <= EDGE or y0 <= EDGE or x1 >= 1000 - EDGE or y1 >= 1000 - EDGE


def send(obj):
    PROTOCOL.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PROTOCOL.flush()


def page_images(page, pw, ph):
    """Image objects on a page with their box in 0..1000 page units (top-left origin)."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    out = []
    for obj in page.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE], max_depth=3):
        try:
            l, b, r, t = obj.get_bounds()
        except Exception:  # noqa: BLE001
            continue
        x0, x1 = max(0.0, min(l, r)), min(pw, max(l, r))
        y0, y1 = max(0.0, ph - max(b, t)), min(ph, ph - min(b, t))
        if x1 <= x0 or y1 <= y0:
            continue
        out.append((obj, [x0 / pw * 1000, y0 / ph * 1000, x1 / pw * 1000, y1 / ph * 1000], (x1 - x0) * (y1 - y0) / (pw * ph)))
    return out


def cmd_info(args):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(args.file)
    send({"type": "info", "pages": len(pdf)})


def cmd_pdf(args):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(args.file)
    n = len(pdf)
    pages = [int(p) for p in args.pages.split(",") if p] if args.pages else list(range(1, n + 1))
    figdir = os.path.join(args.out, "figures")
    rdir = os.path.join(args.out, "pages")
    os.makedirs(figdir, exist_ok=True)
    os.makedirs(rdir, exist_ok=True)

    # First pass: hash every candidate figure so logos repeated on many pages are skipped.
    seen_count = {}
    plan = {}
    for p in pages:
        if p < 1 or p > n:
            continue
        page = pdf[p - 1]
        pw, ph = page.get_size()
        items = []
        for obj, box, area in page_images(page, pw, ph):
            if area >= SCAN_COVERAGE or area < MIN_FIGURE_AREA or touches_edge(box):
                items.append((obj, box, area, None))
                continue
            try:
                bmp = obj.get_bitmap(render=False)
                pil = bmp.to_pil()
            except Exception:  # noqa: BLE001
                continue
            if pil.width < MIN_FIGURE_PX or pil.height < MIN_FIGURE_PX:
                continue
            digest = hashlib.sha1(pil.tobytes()).hexdigest()
            seen_count[digest] = seen_count.get(digest, 0) + 1
            items.append((obj, box, area, (pil, digest)))
        plan[p] = items

    saved = {}
    for i, p in enumerate(pages):
        if p not in plan:
            send({"type": "page", "page": p, "error": "Page out of range"})
            continue
        page = pdf[p - 1]
        pw, ph = page.get_size()
        tp = page.get_textpage()
        chars = len("".join(tp.get_text_range().split()))
        coverage = max((a for _, _, a, _ in plan[p]), default=0.0)
        scanned = coverage >= SCAN_COVERAGE and chars < SCANNED_MAX_CHARS
        render = None
        if args.render == "all" or (args.render == "auto" and (scanned or chars < SCANNED_MAX_CHARS)):
            img = page.render(scale=args.scale).to_pil()
            render = os.path.join(rdir, f"p{p:04d}.png")
            img.convert("RGB").save(render)
        figures = []
        for obj, box, area, data in plan[p]:
            if data is None:
                continue
            pil, digest = data
            if seen_count.get(digest, 0) >= 2:
                continue  # the same picture on several pages is a logo or decoration
            if digest in saved:
                path = saved[digest]
            else:
                path = os.path.join(figdir, f"pdf-p{p:04d}-{len(saved) + 1:03d}.png")
                if pil.mode not in ("RGB", "RGBA", "L"):
                    pil = pil.convert("RGB")
                pil.save(path)
                saved[digest] = path
            figures.append({"path": path, "width": pil.width, "height": pil.height, "bbox": [round(v, 1) for v in box]})
        send({"type": "page", "page": p, "index": i, "total": len(pages), "chars": chars, "coverage": round(coverage, 3), "scanned": scanned, "render": render, "figures": figures})


def cmd_ocr(args):
    import numpy as np
    from PIL import Image
    from rapidocr import RapidOCR

    engine = RapidOCR(params={"Global.log_level": "error"})
    for path in args.images:
        try:
            img = Image.open(path).convert("RGB")
            r = engine(np.array(img))
            lines = []
            for box, text, score in zip(r.boxes if r.boxes is not None else [], r.txts or [], r.scores or []):
                xs = [float(pt[0]) for pt in box]
                ys = [float(pt[1]) for pt in box]
                lines.append({"text": text, "box": [min(xs), min(ys), max(xs), max(ys)], "score": round(float(score), 3)})
            send({"type": "ocr", "image": path, "width": img.width, "height": img.height, "lines": lines})
        except Exception as e:  # noqa: BLE001
            send({"type": "ocr", "image": path, "error": f"{type(e).__name__}: {e}"})


def cmd_crop(args):
    from PIL import Image

    with open(args.jobs, encoding="utf-8") as f:
        jobs = json.load(f)
    cache = {}
    for job in jobs:
        try:
            src = job["image"]
            if src not in cache:
                cache[src] = Image.open(src).convert("RGB")
            img = cache[src]
            x0, y0, x1, y1 = [max(0.0, min(1000.0, float(v))) for v in job["box"]]
            box = (int(x0 / 1000 * img.width), int(y0 / 1000 * img.height), int(x1 / 1000 * img.width), int(y1 / 1000 * img.height))
            if box[2] - box[0] < 16 or box[3] - box[1] < 16:
                raise ValueError("Box too small")
            out = job["out"]
            if not out.lower().endswith(".png"):
                raise ValueError("Output must be .png")
            crop = img.crop(box)
            crop.save(out)
            send({"type": "crop", "out": out, "width": crop.width, "height": crop.height})
        except Exception as e:  # noqa: BLE001
            send({"type": "crop", "out": job.get("out"), "error": f"{type(e).__name__}: {e}"})


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("info")
    a.add_argument("--file", required=True)
    a = sub.add_parser("pdf")
    a.add_argument("--file", required=True)
    a.add_argument("--pages", default="")
    a.add_argument("--out", required=True)
    a.add_argument("--scale", type=float, default=2.0)
    a.add_argument("--render", choices=["auto", "all", "none"], default="auto")
    a = sub.add_parser("ocr")
    a.add_argument("--images", nargs="+", required=True)
    a = sub.add_parser("crop")
    a.add_argument("--jobs", required=True)
    args = ap.parse_args()
    try:
        {"info": cmd_info, "pdf": cmd_pdf, "ocr": cmd_ocr, "crop": cmd_crop}[args.cmd](args)
    except Exception as e:  # noqa: BLE001
        send({"type": "fatal", "error": f"{type(e).__name__}: {e}"})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
