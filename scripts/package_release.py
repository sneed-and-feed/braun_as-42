import hashlib
import json
import os
import sys
import zipfile

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
release_dir = os.path.join(root_dir, "releases")
build_dir = os.path.join(root_dir, "build", "BRAUN_AS42_artefacts", "Release")

os.makedirs(release_dir, exist_ok=True)

# Extract version from command line or package.json
if len(sys.argv) > 1 and sys.argv[1].strip():
    version = sys.argv[1].strip()
else:
    with open(os.path.join(root_dir, "package.json"), "r", encoding="utf-8") as f:
        pkg = json.load(f)
    version = pkg.get("version", "1.5.0")

expected_zips = {
    f"BRAUN_AS42-v{version}-Windows-x64.zip",
    f"BRAUN_AS42-v{version}-VST3-Windows-x64.zip",
}

# Remove stale old-version .zip archives from releases/ before packaging
for existing_name in os.listdir(release_dir):
    if existing_name.endswith(".zip") and existing_name not in expected_zips:
        stale_path = os.path.join(release_dir, existing_name)
        os.remove(stale_path)
        print(f"Removed stale archive: {stale_path}")

# 1. Package Windows-x64 full zip (VST3 + Standalone + docs)
zip_path = os.path.join(release_dir, f"BRAUN_AS42-v{version}-Windows-x64.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    vst3_dir = os.path.join(build_dir, "VST3", "BRAUN_AS42.vst3")
    for root, dirs, files in os.walk(vst3_dir):
        for fname in sorted(files):
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, os.path.join(build_dir, "VST3"))
            zf.write(full, rel)
    standalone_file = os.path.join(build_dir, "Standalone", "BRAUN_AS42.exe")
    zf.write(standalone_file, "BRAUN_AS42.exe")
    for doc_name in ("README.txt", "README.md", "LICENSE"):
        doc_path = os.path.join(root_dir, doc_name)
        if os.path.exists(doc_path):
            zf.write(doc_path, doc_name)

print(f"Created {zip_path}: {os.path.getsize(zip_path):,} bytes")

# 2. Package VST3-only zip (VST3 + docs)
vst3_zip_path = os.path.join(release_dir, f"BRAUN_AS42-v{version}-VST3-Windows-x64.zip")
with zipfile.ZipFile(vst3_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    vst3_dir = os.path.join(build_dir, "VST3", "BRAUN_AS42.vst3")
    for root, dirs, files in os.walk(vst3_dir):
        for fname in sorted(files):
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, os.path.join(build_dir, "VST3"))
            zf.write(full, rel)
    for doc_name in ("README.txt", "README.md", "LICENSE"):
        doc_path = os.path.join(root_dir, doc_name)
        if os.path.exists(doc_path):
            zf.write(doc_path, doc_name)

print(f"Created {vst3_zip_path}: {os.path.getsize(vst3_zip_path):,} bytes")


# 3. Compute SHA-256 digests ONLY for active release archives (no stale accumulation)
def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


sha256_path = os.path.join(release_dir, "SHA256SUMS.txt")
active_zip_files = sorted(f for f in os.listdir(release_dir) if f in expected_zips)
checksum_lines = []
for zfname in active_zip_files:
    zpath = os.path.join(release_dir, zfname)
    digest = compute_sha256(zpath)
    checksum_lines.append(f"{digest}  {zfname}\n")
    print(f"SHA-256 ({zfname}) = {digest}")

with open(sha256_path, "w", encoding="utf-8", newline="\n") as f:
    f.writelines(checksum_lines)

print(f"Created {sha256_path} with {len(checksum_lines)} active checksums.")
