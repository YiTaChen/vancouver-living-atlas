"""Archive actual renderer captures as small review images (requires Pillow)."""
import json
from pathlib import Path
import sys
from PIL import Image

label = sys.argv[1]
if not label or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in label):
    raise SystemExit('Use a simple result label')
source = Path('work/visual-qa') / label
target = Path('docs/visual-quality') / label
target.mkdir(parents=True, exist_ok=True)
rows = [json.loads(p.read_text()) for p in sorted(source.glob('*.json'))]
samples = [r for r in rows if 'fps' in r]
if not samples or any(not r['valid'] for r in samples):
    raise SystemExit('Missing or invalid visible-browser samples')
(target / 'measurements.json').write_text(json.dumps(rows, indent=2) + '\n')
for sample in samples:
    name = f"{sample['quality']}-{sample['id']}"
    with Image.open(source / (name + '.png')) as im:
        im.convert('RGB').resize((960, 540), Image.Resampling.LANCZOS).save(
            target / (name + '.jpg'), quality=83, optimize=True
        )
table = ['| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |',
         '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |']
for r in samples:
    name = f"{r['quality']}-{r['id']}"
    table.append(f"| {r['id']} | {r['quality']} | {r['fps']:.1f} | {r['p95Ms']:.1f} | {r['p99Ms']:.1f} | {r['maxMs']:.1f} | {r['over100Ms']} | [Image]({name}.jpg) |")
(target / 'README.md').write_text(
    f'# {label} measurements\n\n'
    'Actual local application renders, 1920 × 1080 viewport, DPR 1. '
    'JPEG review images are resized copies of the saved canvas PNGs. '
    'See measurements.json for device, source revision, physical render size, camera poses and movement. '
    'Each sample is 8 seconds after 2.5 seconds of warm-up. '
    'These are short diagnostic samples, not a guarantee of long-session performance.\n\n'
    + '\n'.join(table) + '\n'
)
print(f'Archived {len(samples)} samples to {target}')
