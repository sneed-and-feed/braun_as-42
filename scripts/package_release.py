import os
import zipfile
import json

root_dir = r"c:\Users\x\Documents\antigravity\braun_as-42"
release_dir = os.path.join(root_dir, "releases")
build_dir = os.path.join(root_dir, "build", "BRAUN_AS42_artefacts", "Release")

os.makedirs(release_dir, exist_ok=True)

# Extract version from package.json
with open(os.path.join(root_dir, "package.json"), "r", encoding="utf-8") as f:
    pkg = json.load(f)
version = pkg.get("version", "1.3.9")

# 1. Package Windows-x64 full zip
zip_path = os.path.join(release_dir, f"BRAUN_AS42-v{version}-Windows-x64.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    vst3_dir = os.path.join(build_dir, "VST3", "BRAUN_AS42.vst3")
    for root, dirs, files in os.walk(vst3_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, os.path.join(build_dir, "VST3"))
            zf.write(full, rel)
    standalone_file = os.path.join(build_dir, "Standalone", "BRAUN_AS42.exe")
    zf.write(standalone_file, "BRAUN_AS42.exe")
    if os.path.exists(os.path.join(root_dir, "README.txt")):
        zf.write(os.path.join(root_dir, "README.txt"), "README.txt")
    if os.path.exists(os.path.join(root_dir, "README.md")):
        zf.write(os.path.join(root_dir, "README.md"), "README.md")
    if os.path.exists(os.path.join(root_dir, "LICENSE")):
        zf.write(os.path.join(root_dir, "LICENSE"), "LICENSE")

print(f"Created {zip_path}: {os.path.getsize(zip_path):,} bytes")

# 2. Package VST3-only zip
vst3_zip_path = os.path.join(release_dir, f"BRAUN_AS42-v{version}-VST3-Windows-x64.zip")
with zipfile.ZipFile(vst3_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    vst3_dir = os.path.join(build_dir, "VST3", "BRAUN_AS42.vst3")
    for root, dirs, files in os.walk(vst3_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, os.path.join(build_dir, "VST3"))
            zf.write(full, rel)
    if os.path.exists(os.path.join(root_dir, "README.txt")):
        zf.write(os.path.join(root_dir, "README.txt"), "README.txt")
    if os.path.exists(os.path.join(root_dir, "README.md")):
        zf.write(os.path.join(root_dir, "README.md"), "README.md")
    if os.path.exists(os.path.join(root_dir, "LICENSE")):
        zf.write(os.path.join(root_dir, "LICENSE"), "LICENSE")

print(f"Created {vst3_zip_path}: {os.path.getsize(vst3_zip_path):,} bytes")
