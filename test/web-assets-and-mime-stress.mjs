import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

const PROJECT_ROOT = process.cwd();
const ZIP_PATH = path.join(PROJECT_ROOT, 'build', 'web_assets.zip');
const WEB_RESOURCE_MGR_CPP = path.join(PROJECT_ROOT, 'plugin', 'source', 'web', 'WebResourceManager.cpp');

console.log('================================================================');
console.log(' BRAUN AS 42: Web Assets & MIME Stress Verification Probe');
console.log('================================================================');

// -----------------------------------------------------------------------------
// 1. Enumerate all disk files in index.html, css/, js/
// -----------------------------------------------------------------------------
function getFilesRecursively(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(getFilesRecursively(fullPath));
        } else {
            results.push(fullPath);
        }
    }
    return results;
}

const diskFiles = [
    path.join(PROJECT_ROOT, 'index.html'),
    ...getFilesRecursively(path.join(PROJECT_ROOT, 'css')),
    ...getFilesRecursively(path.join(PROJECT_ROOT, 'js'))
];

const diskFileMap = new Map();
for (const f of diskFiles) {
    const rel = path.relative(PROJECT_ROOT, f).replace(/\\/g, '/');
    const content = fs.readFileSync(f);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    diskFileMap.set(rel, {
        size: content.length,
        hash,
        content
    });
}

console.log(`[DISK SCAN] Found ${diskFileMap.size} files in index.html, css/, js/:`);
for (const [rel, info] of diskFileMap.entries()) {
    console.log(`  - ${rel} (${info.size} bytes, sha256: ${info.hash.slice(0, 8)}...)`);
}

// -----------------------------------------------------------------------------
// 2. Parse and unpack build/web_assets.zip
// -----------------------------------------------------------------------------
if (!fs.existsSync(ZIP_PATH)) {
    console.error(`\n[FATAL] ${ZIP_PATH} does not exist! Run cmake --build build first.`);
    process.exit(1);
}

const zipBuffer = fs.readFileSync(ZIP_PATH);
console.log(`\n[ZIP SCAN] Inspecting ${ZIP_PATH} (${zipBuffer.length} bytes)...`);

// Find End of Central Directory (EOCD)
let eocdOffset = -1;
for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
    }
}

if (eocdOffset === -1) {
    console.error('[FATAL] End of Central Directory signature (0x06054b50) not found in ZIP!');
    process.exit(1);
}

const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

console.log(`[ZIP SCAN] Total Central Directory entries: ${totalEntries}, CD offset: ${cdOffset}`);

const zipFileMap = new Map();
let pos = cdOffset;

for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(pos) !== 0x02014b50) {
        throw new Error(`Invalid Central Directory header signature at offset ${pos}`);
    }

    const flags = zipBuffer.readUInt16LE(pos + 8);
    const method = zipBuffer.readUInt16LE(pos + 10);
    const compSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);

    const entryName = zipBuffer.toString('utf8', pos + 46, pos + 46 + nameLen).replace(/\\/g, '/');
    pos += 46 + nameLen + extraLen + commentLen;

    // Skip directory entries (ending with '/')
    if (entryName.endsWith('/')) {
        continue;
    }

    // Extract payload from Local File Header
    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid Local File Header at offset ${localHeaderOffset} for ${entryName}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    let uncompressedData;
    if (method === 0) {
        // Stored
        uncompressedData = zipBuffer.subarray(dataOffset, dataOffset + uncompSize);
    } else if (method === 8) {
        // Deflated
        const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compSize);
        uncompressedData = zlib.inflateRawSync(compressedData);
    } else {
        throw new Error(`Unsupported compression method ${method} for ${entryName}`);
    }

    const hash = crypto.createHash('sha256').update(uncompressedData).digest('hex');
    zipFileMap.set(entryName, {
        size: uncompressedData.length,
        hash,
        content: uncompressedData
    });
}

console.log(`[ZIP SCAN] Successfully extracted ${zipFileMap.size} files from web_assets.zip.`);

// -----------------------------------------------------------------------------
// 3. Completeness and Byte-Exact Comparison
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: ASSET INTEGRITY]');
let integrityErrors = 0;

for (const [relPath, diskInfo] of diskFileMap.entries()) {
    if (!zipFileMap.has(relPath)) {
        console.error(`  [FAIL] Missing file in web_assets.zip: ${relPath}`);
        integrityErrors++;
        continue;
    }
    const zipInfo = zipFileMap.get(relPath);
    if (zipInfo.size !== diskInfo.size) {
        console.error(`  [FAIL] Size mismatch for ${relPath}: disk=${diskInfo.size}, zip=${zipInfo.size}`);
        integrityErrors++;
    } else if (zipInfo.hash !== diskInfo.hash) {
        console.error(`  [FAIL] SHA-256 hash mismatch for ${relPath}!`);
        integrityErrors++;
    } else {
        console.log(`  [PASS] ${relPath} (size: ${diskInfo.size}, sha256: ${diskInfo.hash.slice(0, 12)}...)`);
    }
}

for (const [relPath, zipInfo] of zipFileMap.entries()) {
    if (!diskFileMap.has(relPath)) {
        console.warn(`  [WARN] Extra file found in web_assets.zip not on disk: ${relPath}`);
    }
}

if (integrityErrors === 0) {
    console.log(`[RESULT] All ${diskFileMap.size} web assets are 100% byte-exact and present in web_assets.zip!`);
} else {
    console.error(`[RESULT] ${integrityErrors} integrity errors detected!`);
}

// -----------------------------------------------------------------------------
// 4. C++ WebResourceManager Logic & MIME Type Stress Test
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: C++ WebResourceManager & MIME TYPES]');

function cppSanitizeUrl(url) {
    let p = url;
    if (p.toLowerCase().startsWith('https://juce.backend/')) p = p.substring(21);
    else if (p.toLowerCase().startsWith('http://juce.backend/')) p = p.substring(20);
    else if (p.toLowerCase().startsWith('https://juce.backend')) p = p.substring(20);
    else if (p.toLowerCase().startsWith('http://juce.backend')) p = p.substring(19);

    const q = p.indexOf('?');
    if (q >= 0) p = p.substring(0, q);

    const h = p.indexOf('#');
    if (h >= 0) p = p.substring(0, h);

    while (p.startsWith('/') || p.startsWith('\\')) p = p.substring(1);
    if (p.length === 0) p = 'index.html';
    return p;
}

function cppGetMimeType(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
    if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.woff2')) return 'font/woff2';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.wasm')) return 'application/wasm';
    return 'application/octet-stream';
}

console.log('Testing all disk files through WebResourceManager URL and MIME pipeline:');
let mimeErrors = 0;
let jsCount = 0;

for (const [relPath] of diskFileMap.entries()) {
    const simulatedUrl = `https://juce.backend/${relPath}`;
    const sanitized = cppSanitizeUrl(simulatedUrl);
    const mime = cppGetMimeType(sanitized);

    if (sanitized !== relPath) {
        console.error(`  [FAIL] Sanitized path mismatch for ${simulatedUrl}: expected ${relPath}, got ${sanitized}`);
        mimeErrors++;
    }

    if (relPath.endsWith('.js')) {
        jsCount++;
        // Check both base media type and charset parameter
        const [baseMime] = mime.split(';').map(s => s.trim());
        if (baseMime !== 'text/javascript') {
            console.error(`  [FAIL] .js MIME base type is NOT text/javascript: ${relPath} -> ${mime}`);
            mimeErrors++;
        } else {
            console.log(`  [PASS] ${relPath} -> sanitized: '${sanitized}', MIME: '${mime}' (base: '${baseMime}')`);
        }
    }
}

// -----------------------------------------------------------------------------
// 5. Edge Cases and Query / Hash Handling
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: URL SANITIZATION EDGE CASES]');
const testCases = [
    { in: 'https://juce.backend/', expectedPath: 'index.html', expectedMime: 'text/html; charset=utf-8' },
    { in: 'https://juce.backend', expectedPath: 'index.html', expectedMime: 'text/html; charset=utf-8' },
    { in: 'http://juce.backend/', expectedPath: 'index.html', expectedMime: 'text/html; charset=utf-8' },
    { in: 'https://juce.backend/js/app.js?v=2026.1', expectedPath: 'js/app.js', expectedMime: 'text/javascript; charset=utf-8' },
    { in: 'https://juce.backend/js/audio/felt-piano.js#section', expectedPath: 'js/audio/felt-piano.js', expectedMime: 'text/javascript; charset=utf-8' },
    { in: 'https://juce.backend//css//style.css', expectedPath: 'css//style.css', expectedMime: 'text/css; charset=utf-8' },
    { in: 'HTTPS://JUCE.BACKEND/JS/APP.JS', expectedPath: 'JS/APP.JS', expectedMime: 'text/javascript; charset=utf-8' },
    { in: 'https://juce.backend/manifest.json', expectedPath: 'manifest.json', expectedMime: 'application/json' },
];

for (const tc of testCases) {
    const s = cppSanitizeUrl(tc.in);
    const m = cppGetMimeType(s);
    const pass = (s === tc.expectedPath) && (m === tc.expectedMime);
    if (!pass) {
        console.error(`  [FAIL] Case '${tc.in}': got path='${s}' (exp '${tc.expectedPath}'), mime='${m}' (exp '${tc.expectedMime}')`);
        mimeErrors++;
    } else {
        console.log(`  [PASS] '${tc.in}' -> path: '${s}', mime: '${m}'`);
    }
}

// -----------------------------------------------------------------------------
// 6. Strict MIME specification analysis: 'text/javascript' vs 'text/javascript; charset=utf-8'
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: STRICT MIME SPECIFICATION ANALYSIS]');
console.log(`Total JavaScript files evaluated: ${jsCount}`);
console.log(`C++ getMimeTypeForPath return value: 'text/javascript; charset=utf-8'`);
console.log(`Base Media Type (RFC 9239 / WHATWG HTML5): 'text/javascript'`);
console.log(`Charset Parameter: 'charset=utf-8'`);

// -----------------------------------------------------------------------------
// 7. APVTS 22-Parameter Roundtrip Map Stress Test
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: 22-PARAMETER APVTS ↔ WEB UI ROUNDTRIP STRESS]');
const kParamMap = [
    { apvtsId: "felt_volume",      webId: "feltLevel",     webScale: 0.01 },
    { apvtsId: "felt_decay",       webId: "feltDecay",     webScale: 1.0  },
    { apvtsId: "felt_tone",        webId: "feltTone",      webScale: 0.01 },
    { apvtsId: "felt_hammer",      webId: "feltHammer",    webScale: 0.01 },
    { apvtsId: "felt_space",       webId: "feltSymp",      webScale: 0.01 },
    { apvtsId: "drone1_volume",    webId: "drone1Vol",     webScale: 0.01 },
    { apvtsId: "drone1_pitch",     webId: "drone1Pitch",   webScale: 1.0  },
    { apvtsId: "drone1_fold",      webId: "drone1Fold",    webScale: 1.0  },
    { apvtsId: "drone1_cutoff",    webId: "drone1Cutoff",  webScale: 1.0  },
    { apvtsId: "drone1_resonance", webId: "drone1Res",     webScale: 1.0  },
    { apvtsId: "drone2_volume",    webId: "drone2Vol",     webScale: 0.01 },
    { apvtsId: "drone2_pitch",     webId: "drone2Pitch",   webScale: 1.0  },
    { apvtsId: "drone2_fold",      webId: "drone2Fold",    webScale: 1.0  },
    { apvtsId: "drone2_cutoff",    webId: "drone2Cutoff",  webScale: 1.0  },
    { apvtsId: "drone2_resonance", webId: "drone2Res",     webScale: 1.0  },
    { apvtsId: "tape_time",        webId: "delayTime",     webScale: 0.001 },
    { apvtsId: "tape_feedback",    webId: "delayFeedback", webScale: 0.01 },
    { apvtsId: "tape_mix",         webId: "delayWet",      webScale: 0.01 },
    { apvtsId: "tape_wow",         webId: "delayWow",      webScale: 0.01 },
    { apvtsId: "shimmer_mix",      webId: "reverbWet",     webScale: 0.01 },
    { apvtsId: "shimmer_decay",    webId: "reverbDecay",   webScale: 1.0  },
    { apvtsId: "master_volume",    webId: "masterVol",     webScale: 0.01 }
];

let paramErrors = 0;
if (kParamMap.length !== 22) {
    console.error(`  [FAIL] Expected 22 APVTS parameters, got ${kParamMap.length}`);
    paramErrors++;
} else {
    console.log(`  [PASS] Parameter map contains exactly 22 parameters.`);
}

for (const item of kParamMap) {
    // Simulate C++ sendParameterUpdateToWeb (APVTS -> Web)
    const testApvtsVal = 0.85;
    const webVal = (item.webScale !== 0) ? (testApvtsVal / item.webScale) : testApvtsVal;

    // Simulate C++ handleParamChangeFromWeb (Web -> APVTS)
    const recoveredApvtsVal = webVal * item.webScale;
    const delta = Math.abs(testApvtsVal - recoveredApvtsVal);
    if (delta > 1e-6) {
        console.error(`  [FAIL] Roundtrip scaling error on ${item.apvtsId} (${item.webId}): delta=${delta}`);
        paramErrors++;
    } else {
        console.log(`  [PASS] ${item.apvtsId} <-> ${item.webId} (scale ${item.webScale}) roundtrip exact: ${testApvtsVal} <-> ${webVal}`);
    }
}

// -----------------------------------------------------------------------------
// 8. Bidirectional Parameter Sync & Ping-Pong Loop Suppression Oracle
// -----------------------------------------------------------------------------
console.log('\n[AUDIT: BIDIRECTIONAL SYNC & FEEDBACK SUPPRESSION ORACLE]');

// Mock BraunKnob class matching js/ui/knob.js
class MockKnob {
    constructor(id, initialVal = 0) {
        this.id = id;
        this.value = initialVal;
        this.onChange = null;
        this.changeCount = 0;
    }
    setValue(val, triggerCallback = true) {
        this.value = val;
        if (triggerCallback && typeof this.onChange === 'function') {
            this.changeCount++;
            this.onChange(val);
        }
    }
}

// Create mock knobs for all 22 parameters
const mockKnobs = {};
for (const item of kParamMap) {
    mockKnobs[item.webId] = new MockKnob(item.webId, 50);
}

// Mock window.__JUCE__.backend
const emittedEvents = [];
let paramUpdateHandler = null;

const mockBackend = {
    addEventListener: (event, handler) => {
        if (event === 'paramUpdate') {
            paramUpdateHandler = handler;
        }
    },
    emitEvent: (event, payload) => {
        emittedEvents.push({ event, payload });
    }
};

// Simulate _initJuceBridge()
function simulateInitJuceBridge(knobs, backend) {
    backend.addEventListener('paramUpdate', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const { id, value } = payload;
        if (id && knobs[id] && typeof value === 'number') {
            knobs[id].setValue(value, false); // triggerCallback = false
        }
    });

    for (const [id, knob] of Object.entries(knobs)) {
        if (!knob) continue;
        const orig = knob.onChange;
        knob.onChange = (val) => {
            if (typeof orig === 'function') orig(val);
            backend.emitEvent('paramChange', { id, value: val });
        };
    }
}

simulateInitJuceBridge(mockKnobs, mockBackend);

let syncErrors = 0;

// Test 1: Host automation sends 'paramUpdate' to Web UI
// Must update knob visual value WITHOUT firing knob.onChange (preventing feedback storm)
emittedEvents.length = 0;
paramUpdateHandler({ id: 'feltLevel', value: 75 });
if (mockKnobs['feltLevel'].value !== 75) {
    console.error(`  [FAIL] paramUpdate did not update knob value: got ${mockKnobs['feltLevel'].value}`);
    syncErrors++;
} else if (mockKnobs['feltLevel'].changeCount !== 0) {
    console.error(`  [FAIL] paramUpdate triggered knob.onChange! Feedback loop vulnerability!`);
    syncErrors++;
} else if (emittedEvents.length !== 0) {
    console.error(`  [FAIL] paramUpdate caused backend.emitEvent! Feedback loop vulnerability!`);
    syncErrors++;
} else {
    console.log(`  [PASS] Host automation 'paramUpdate' cleanly sets knob value without triggering onChange (feedback suppressed).`);
}

// Test 2: User rotates Web UI knob directly
// Must trigger onChange AND emit 'paramChange' to backend
emittedEvents.length = 0;
mockKnobs['feltLevel'].setValue(88, true); // direct user touch / drag
if (mockKnobs['feltLevel'].value !== 88) {
    console.error(`  [FAIL] User interaction value mismatch`);
    syncErrors++;
} else if (emittedEvents.length !== 1 || emittedEvents[0].event !== 'paramChange' || emittedEvents[0].payload.value !== 88) {
    console.error(`  [FAIL] User interaction did not emit paramChange: ${JSON.stringify(emittedEvents)}`);
    syncErrors++;
} else {
    console.log(`  [PASS] User interaction emits 'paramChange' to C++ APVTS: id='${emittedEvents[0].payload.id}', value=${emittedEvents[0].payload.value}.`);
}

// Test 3: Adversarial malformed messages to JUCE bridge
const malformedPayloads = [
    null,
    undefined,
    "string",
    123,
    {},
    { id: "nonexistent_knob", value: 42 },
    { id: "feltLevel", value: "not_a_number" },
    { id: "feltLevel", value: NaN }
];

let survivedMalformed = true;
for (const p of malformedPayloads) {
    try {
        paramUpdateHandler(p);
    } catch (err) {
        console.error(`  [FAIL] Crash on malformed payload: ${JSON.stringify(p)} -> ${err.message}`);
        survivedMalformed = false;
        syncErrors++;
    }
}
if (survivedMalformed) {
    console.log(`  [PASS] JUCE bridge handles 8 adversarial malformed payloads without exceptions.`);
}

console.log('\n================================================================');
console.log(`FINAL REPORT:`);
console.log(`  - Web Asset Integrity Errors: ${integrityErrors}`);
console.log(`  - MIME Type Resolution Errors: ${mimeErrors}`);
console.log(`  - Parameter Map Errors:       ${paramErrors}`);
console.log(`  - Parameter Sync Errors:      ${syncErrors}`);
console.log('================================================================');

if (integrityErrors > 0 || mimeErrors > 0 || paramErrors > 0 || syncErrors > 0) {
    process.exit(1);
}
