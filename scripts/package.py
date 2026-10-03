from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "manifest.json").read_text())["version"]
destination = root / "dist" / f"how-many-token-{version}.zip"
destination.parent.mkdir(exist_ok=True)
files = [root / "manifest.json", root / "popup.html", root / "README.md"]
files += sorted((root / "src").glob("*")) + sorted((root / "icons").glob("*.png"))
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root))
print(destination)
