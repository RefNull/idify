#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// src/engine/detector.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/engine/models.ts
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
var YUNET_FILE = "face_detection_yunet_2023mar.onnx";
function packageDir() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}
function yunetModelPath() {
  const pkg = packageDir();
  const candidates = [
    path.join(pkg, "dist/models", YUNET_FILE),
    path.join(pkg, "../common/src/assets/models", YUNET_FILE)
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Face model not found (looked in ${candidates.join(", ")})`);
  return found;
}
var SEGMENT_MODEL_CHUNKS = [
  "de5e30866b768519d918.onnx",
  "70a406e9df771cc6bc67.onnx",
  "c63207475d21d6991f15.onnx",
  "bb9ee4f182db91d43876.onnx",
  "dec0c66a4dbb37487da1.onnx",
  "6aeccb4c06aad7f8e4de.onnx",
  "0a733bd9ce54fc470425.onnx",
  "acce14f7ccd4d32b66d3.onnx",
  "79810ed8b56c5a0082a2.onnx"
];
var SEGMENT_MODEL_SIZE = 88188479;
var SEGMENT_INPUT_SIZE = 1024;
function segmentModelChunks() {
  const require2 = createRequire(import.meta.url);
  const pkg = require2.resolve("@zhbhun/background-removal/package.json");
  return SEGMENT_MODEL_CHUNKS.map((file) => path.join(path.dirname(pkg), "dist", file));
}
var ortPromise = null;
function loadOrt() {
  ortPromise ??= import("onnxruntime-node").catch((err) => {
    ortPromise = null;
    throw new Error(
      `onnxruntime-node failed to load on ${process.platform}/${process.arch}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  return ortPromise;
}
var sessions = /* @__PURE__ */ new Map();
function loadSession(key, load) {
  let session = sessions.get(key);
  if (!session) {
    session = (async () => {
      const ort = await loadOrt();
      const model = await load();
      return typeof model === "string" ? ort.InferenceSession.create(model) : ort.InferenceSession.create(model);
    })();
    session.catch(() => sessions.delete(key));
    sessions.set(key, session);
  }
  return session;
}
function faceSession() {
  return loadSession("yunet", async () => yunetModelPath());
}
function segmentSession() {
  return loadSession("segment", async () => {
    const chunks = segmentModelChunks();
    const missing = chunks.find((p) => !fs.existsSync(p));
    if (missing) throw new Error(`Background-removal model chunk missing: ${missing}`);
    const model = Buffer.concat(chunks.map((p) => fs.readFileSync(p)));
    if (model.length !== SEGMENT_MODEL_SIZE) {
      throw new Error("Background-removal model has an unexpected size");
    }
    return new Uint8Array(model.buffer, model.byteOffset, model.length);
  });
}

// src/engine/detector.ts
var VISION_TOOLS = [
  "validate_photo_compliance",
  "auto_crop_and_retouch",
  "create_print_sheet"
];
var DEFAULT_BINARY_PATH = path2.join(packageDir(), "native/idify-vision");
function isExecutableFile(p) {
  try {
    fs2.accessSync(p, fs2.constants.X_OK);
    return fs2.statSync(p).isFile();
  } catch {
    return false;
  }
}
function detectPlatformCapabilities(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const binaryPath = options.binaryPath ?? DEFAULT_BINARY_PATH;
  const exists = options.binaryExists ?? isExecutableFile;
  const preference = (options.preference ?? process.env.IDIFY_MCP_ENGINE ?? "").trim().toLowerCase();
  const isAppleSilicon = platform === "darwin" && arch === "arm64";
  const hasNativeBinary = isAppleSilicon && exists(binaryPath);
  let engine = hasNativeBinary && preference !== "onnx" ? "apple-vision" : "onnx";
  let unavailableReason = null;
  if (preference === "apple-vision" && !hasNativeBinary) {
    engine = "none";
    unavailableReason = `IDIFY_MCP_ENGINE=apple-vision, but the native binary is not available on ${platform}/${arch}; it needs macOS on Apple Silicon and "pnpm --filter @idify/mcp build:native"`;
  }
  return {
    platform,
    arch,
    isAppleSilicon,
    engine,
    hasNativeBinary,
    nativeBinaryPath: hasNativeBinary ? binaryPath : null,
    visionTools: engine === "none" ? [] : [...VISION_TOOLS],
    unavailableReason
  };
}

// src/engine/runProcess.ts
import { spawn } from "node:child_process";
var DEFAULT_TIMEOUT_MS = 6e4;
var DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
var DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
function errorDetail(stdout, stderr) {
  try {
    const parsed = JSON.parse(stdout.trim());
    const msg = parsed?.message ?? parsed?.error;
    if (typeof msg === "string" && msg) return msg;
  } catch {
  }
  const tail = stderr.trim().slice(-500);
  return tail || "no diagnostic output";
}
function runJsonProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  const name = command.split(/[\\/]/).pop() || command;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = "";
    let failure = null;
    let settled = false;
    const fail = (err) => {
      if (!failure) failure = err;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      fail(new Error(`${name} timed out after ${Math.round(timeoutMs / 1e3)} s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdout) {
        fail(new Error(`${name} produced more than ${maxStdout} bytes of output`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < maxStderr) {
        stderr += chunk.toString("utf8").slice(0, maxStderr - stderr.length);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to start ${name}: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (failure) {
        reject(failure);
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      if (code !== 0) {
        const how = signal ? `was killed by ${signal}` : `exited with code ${code}`;
        reject(new Error(`${name} ${how}: ${errorDetail(stdout, stderr)}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error(`${name} produced no output`));
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        reject(new Error(`${name} produced output that is not valid JSON`));
      }
    });
  });
}

// src/engine/apple-vision.ts
function asObject(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`idify-vision ${what} returned an unexpected result`);
  }
  return value;
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
var AppleVisionEngine = class {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
  }
  async inspect(imagePath) {
    const raw = asObject(await runJsonProcess(this.binaryPath, ["inspect", imagePath]), "inspect");
    const quality = raw.qualityScore;
    return {
      ...raw,
      // Swift omits the key when Vision could not score capture quality.
      qualityScore: typeof quality === "number" ? quality : null,
      violations: stringList(raw.violations),
      advisories: stringList(raw.advisories),
      engineUsed: "apple-vision"
    };
  }
  async process(options) {
    const args = [
      "process",
      options.inputPath,
      "--output",
      options.outputPath,
      "--width",
      String(options.targetWidth),
      "--height",
      String(options.targetHeight),
      "--dpi",
      String(options.dpi),
      "--bg",
      options.bgColorHex,
      "--head-ratio",
      String(options.targetHeadRatio),
      "--top-margin",
      String(options.targetTopMargin)
    ];
    if (options.autoFrame) args.push("--auto-frame");
    const raw = asObject(await runJsonProcess(this.binaryPath, args), "process");
    if (raw.success !== true) {
      throw new Error(`idify-vision process failed: ${String(raw.message ?? "unknown error")}`);
    }
    return {
      ...raw,
      backgroundReplaced: raw.backgroundReplaced === true,
      engineUsed: "apple-vision"
    };
  }
  async renderSheet(options) {
    const cells = options.cells.map((c) => [c.x, c.y, c.width, c.height].map((n) => String(Math.round(n))).join(",")).join(";");
    const args = [
      "sheet",
      options.photoPath,
      "--output",
      options.outputPath,
      "--sheet-width",
      String(options.sheetWidthPx),
      "--sheet-height",
      String(options.sheetHeightPx),
      "--dpi",
      String(options.dpi),
      "--cells",
      cells
    ];
    if (options.cutGuides) args.push("--cut-guides");
    const raw = asObject(await runJsonProcess(this.binaryPath, args), "sheet");
    if (raw.success !== true) {
      throw new Error(`idify-vision sheet failed: ${String(raw.message ?? "unknown error")}`);
    }
    return { ...raw, engineUsed: "apple-vision" };
  }
};

// src/engine/onnx.ts
import path3 from "node:path";

// ../common/src/utils/faceDetect.ts
var YUNET_SIZE = 640;
var STRIDES = [8, 16, 32];
var clamp01 = (value) => Math.min(Math.max(value, 0), 1);
function decodeYuNet(outputs, size = YUNET_SIZE, threshold = 0.6) {
  const faces = [];
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) continue;
    const cols = Math.floor(size / stride);
    const rows = Math.floor(size / stride);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < threshold) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks = [];
        for (let n = 0; n < 5; n++) {
          landmarks.push([
            (kps[i * 10 + n * 2] + c) * stride,
            (kps[i * 10 + n * 2 + 1] + r) * stride
          ]);
        }
        faces.push({
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          score,
          landmarks
        });
      }
    }
  }
  return pickFaces(faces);
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
function pickFaces(faces) {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const face of sorted) {
    if (kept.every((other) => iou(face, other) < 0.3)) kept.push(face);
  }
  return kept.sort((a, b) => b.width * b.height - a.width * a.height);
}
function letterbox(width, height, size = YUNET_SIZE) {
  const scale = size / Math.max(width, height);
  return {
    scale,
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
}
function toImageFraction(face, box) {
  return {
    x: face.x / box.width,
    y: face.y / box.height,
    width: face.width / box.width,
    height: face.height / box.height,
    score: face.score,
    landmarks: face.landmarks.map(([x, y]) => [x / box.width, y / box.height])
  };
}

// ../common/src/utils/autoFrame.ts
var SOLID = 128;
function findCrownInMask(mask, face, cover = 0.15) {
  const { data, width, height } = mask;
  const x0 = Math.max(0, Math.floor((face.x + face.width * 0.2) * width));
  const x1 = Math.min(width - 1, Math.ceil((face.x + face.width * 0.8) * width));
  const yEnd = Math.min(height, Math.ceil((face.y + face.height / 2) * height));
  const need = Math.max(1, (x1 - x0 + 1) * cover);
  for (let y = 0; y < yEnd; y++) {
    let solid = 0;
    for (let x = x0; x <= x1; x++) {
      if (data[(y * width + x) * 4 + 3] >= SOLID) solid++;
    }
    if (solid >= need) return y / height;
  }
  return null;
}
function getHeadBox(face, mask) {
  const [rightEye, leftEye] = face.landmarks;
  const eyeY = (rightEye[1] + leftEye[1]) / 2;
  const chin = face.y + face.height;
  const eyeToChin = Math.max(chin - eyeY, 1e-6);
  let crown = eyeY - eyeToChin * 1.05;
  const fromMask = mask ? findCrownInMask(mask, face) : null;
  if (fromMask !== null) {
    crown = Math.max(fromMask, eyeY - eyeToChin * 1.8);
  }
  return {
    top: Math.max(0, crown),
    bottom: chin,
    centerX: (rightEye[0] + leftEye[0]) / 2,
    eyes: eyeY
  };
}

// ../common/src/utils/matte.ts
var OPAQUE = 250;
function tightenAlpha(alpha, low, high) {
  if (alpha <= low) return 0;
  if (alpha >= high) return 255;
  return Math.round((alpha - low) / (high - low) * 255);
}
function refineMatte(data, width, height, { low = 48, high = 208 } = {}) {
  const count = width * height;
  if (data.length < count * 4) {
    throw new Error("Pixel data is smaller than width x height");
  }
  const state = new Uint8Array(count);
  let edges = 0;
  for (let i = 0; i < count; i++) {
    const a = tightenAlpha(data[i * 4 + 3], low, high);
    data[i * 4 + 3] = a;
    if (a >= OPAQUE) {
      state[i] = 1;
    } else if (a > 0) {
      state[i] = 2;
      edges++;
    }
  }
  if (!edges) return;
  const fill = new Float32Array(count * 3);
  const queued = new Uint8Array(count);
  let frontier = [];
  const neighbours = (i, visit) => {
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        visit(ny * width + nx);
      }
    }
  };
  for (let i = 0; i < count; i++) {
    if (state[i] !== 2) continue;
    neighbours(i, (n) => {
      if (state[n] === 1 && !queued[i]) {
        queued[i] = 1;
        frontier.push(i);
      }
    });
  }
  const colour = (n, c) => state[n] === 1 ? data[n * 4 + c] : fill[n * 3 + c];
  const filled = new Uint8Array(count);
  while (frontier.length) {
    for (const i of frontier) {
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      neighbours(i, (n) => {
        if (state[n] === 1 || filled[n]) {
          r += colour(n, 0);
          g += colour(n, 1);
          b += colour(n, 2);
          k++;
        }
      });
      fill[i * 3] = r / k;
      fill[i * 3 + 1] = g / k;
      fill[i * 3 + 2] = b / k;
    }
    for (const i of frontier) filled[i] = 1;
    const next = [];
    for (const i of frontier) {
      neighbours(i, (n) => {
        if (state[n] === 2 && !queued[n]) {
          queued[n] = 1;
          next.push(n);
        }
      });
    }
    frontier = next;
  }
  for (let i = 0; i < count; i++) {
    if (!filled[i]) continue;
    const t = Math.pow(data[i * 4 + 3] / 255, 3);
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round(
        data[i * 4 + c] * t + fill[i * 3 + c] * (1 - t)
      );
    }
  }
}

// src/engine/onnx.ts
var sharpPromise = null;
function loadSharp() {
  sharpPromise ??= import("sharp").then((m) => m.default).catch((err) => {
    sharpPromise = null;
    throw new Error(
      `sharp failed to load on ${process.platform}/${process.arch}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  return sharpPromise;
}
async function readImage(file) {
  const sharp = await loadSharp();
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
function rawInput(image) {
  return { raw: { width: image.width, height: image.height, channels: 4 } };
}
var isJpeg = (file) => /\.jpe?g$/i.test(path3.extname(file));
async function writeImage(pipeline, file, dpi) {
  const out = pipeline.withMetadata({ density: dpi });
  if (isJpeg(file)) {
    await out.flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toFile(file);
  } else {
    await out.png().toFile(file);
  }
}
async function runYuNet(image, region) {
  const sharp = await loadSharp();
  const box = letterbox(region.width, region.height);
  const { data } = await sharp(image.data, rawInput(image)).extract(region).removeAlpha().resize(box.width, box.height, { fit: "fill" }).extend({
    right: YUNET_SIZE - box.width,
    bottom: YUNET_SIZE - box.height,
    background: "#000000"
  }).raw().toBuffer({ resolveWithObject: true });
  const plane = YUNET_SIZE * YUNET_SIZE;
  const input = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 3 + 2];
    input[plane + i] = data[i * 3 + 1];
    input[plane * 2 + i] = data[i * 3];
  }
  const [ort, session] = await Promise.all([loadOrt(), faceSession()]);
  const results = await session.run({
    input: new ort.Tensor("float32", input, [1, 3, YUNET_SIZE, YUNET_SIZE])
  });
  const outputs = {};
  for (const [name, tensor] of Object.entries(results)) {
    outputs[name] = tensor.data;
  }
  const toImage = (x, y) => [
    (region.left + x * region.width) / image.width,
    (region.top + y * region.height) / image.height
  ];
  return decodeYuNet(outputs).map((face) => {
    const f = toImageFraction(face, box);
    const [x, y] = toImage(f.x, f.y);
    return {
      ...f,
      x,
      y,
      width: f.width * region.width / image.width,
      height: f.height * region.height / image.height,
      landmarks: f.landmarks.map(([lx, ly]) => toImage(lx, ly))
    };
  });
}
var SMALL_FACE = 160;
async function detectFaces(image) {
  const { width, height } = image;
  const faces = await runYuNet(image, { left: 0, top: 0, width, height });
  const face = faces[0];
  const scale = YUNET_SIZE / Math.max(width, height);
  if (!face || face.width * width * scale >= SMALL_FACE) return faces;
  const side = Math.min(
    Math.max(face.width * width, face.height * height) * 3,
    width,
    height
  );
  const cx = (face.x + face.width / 2) * width;
  const cy = (face.y + face.height / 2) * height;
  const region = {
    left: Math.round(Math.min(Math.max(cx - side / 2, 0), width - side)),
    top: Math.round(Math.min(Math.max(cy - side / 2, 0), height - side)),
    width: Math.round(side),
    height: Math.round(side)
  };
  const [closer] = await runYuNet(image, region);
  return closer ? [closer, ...faces.slice(1)] : faces;
}
async function segmentPerson(image) {
  const sharp = await loadSharp();
  const size = SEGMENT_INPUT_SIZE;
  const { data } = await sharp(image.data, rawInput(image)).removeAlpha().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const plane = size * size;
  const input = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 3] - 128) / 256;
    input[plane + i] = (data[i * 3 + 1] - 128) / 256;
    input[plane * 2 + i] = (data[i * 3 + 2] - 128) / 256;
  }
  const [ort, session] = await Promise.all([loadOrt(), segmentSession()]);
  const results = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size])
  });
  const output = results[session.outputNames[0]].data;
  const small = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) {
    small[i] = Math.round(Math.min(Math.max(output[i], 0), 1) * 255);
  }
  const { data: mask } = await sharp(small, { raw: { width: size, height: size, channels: 1 } }).resize(image.width, image.height, { fit: "fill" }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return mask;
}
async function maskData(mask, image, maxSide = 480) {
  const sharp = await loadSharp();
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { data: small } = await sharp(Buffer.from(mask.buffer, mask.byteOffset, mask.length), {
    raw: { width: image.width, height: image.height, channels: 1 }
  }).resize(width, height, { fit: "fill" }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = small[i];
  return { data, width, height };
}
function estimatePose(face, width, height) {
  const [rightEye, leftEye, nose] = face.landmarks.map(([x, y]) => [x * width, y * height]);
  const dx = leftEye[0] - rightEye[0];
  const dy = leftEye[1] - rightEye[1];
  const roll = Math.atan2(dy, dx) * 180 / Math.PI;
  const midX = (rightEye[0] + leftEye[0]) / 2;
  const midY = (rightEye[1] + leftEye[1]) / 2;
  const angle = Math.atan2(dy, dx);
  const offset = (nose[0] - midX) * Math.cos(angle) + (nose[1] - midY) * Math.sin(angle);
  const half = Math.hypot(dx, dy) / 2;
  const yaw = half > 0 ? Math.atan(offset / half / 0.8) * 180 / Math.PI : 0;
  return { roll, yaw };
}
var round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
var MAX_YAW = 8;
function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
function replaceBackground(image, mask, [br, bg, bb, ba]) {
  const { data, width, height } = image;
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = mask[i];
    if (mask[i] === 0) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
    }
  }
  refineMatte(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width,
    height
  );
  const back = [br, bg, bb];
  const backA = ba / 255;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    const outA = a + backA * (1 - a);
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = outA > 0 ? Math.round((data[i * 4 + c] * a + back[c] * backA * (1 - a)) / outA) : 0;
    }
    data[i * 4 + 3] = Math.round(outA * 255);
  }
}
var OnnxEngine = class {
  async inspect(imagePath) {
    const image = await readImage(imagePath);
    const faces = await detectFaces(image);
    const face = faces[0];
    if (!face) {
      return {
        faceDetected: false,
        faceCount: 0,
        rollDegrees: 0,
        yawDegrees: null,
        pitchDegrees: null,
        qualityScore: null,
        chinYNormalized: 0,
        crownYNormalized: 0,
        eyeLevelNormalized: 0,
        headHeightRatio: 0,
        isCentered: false,
        compliant: false,
        violations: ["No face detected in photo"],
        advisories: [],
        engineUsed: "onnx"
      };
    }
    const advisories = [];
    let mask = null;
    try {
      mask = await maskData(await segmentPerson(image), image);
    } catch (err) {
      advisories.push(
        `Background removal was unavailable, so the top of the head was estimated from the face (${err instanceof Error ? err.message : String(err)})`
      );
    }
    const head = getHeadBox(face, mask);
    const { roll, yaw } = estimatePose(face, image.width, image.height);
    const isCentered = Math.abs(head.centerX - 0.5) <= 0.08;
    const violations = [];
    if (faces.length > 1) {
      violations.push(`Multiple faces detected (${faces.length}); measured the largest`);
    }
    if (Math.abs(roll) > 3) {
      violations.push(`Head tilt / roll exceeds \xB13\xB0 (${roll.toFixed(1)}\xB0)`);
    }
    if (Math.abs(yaw) > MAX_YAW) {
      violations.push(`Head appears turned (yaw about ${yaw.toFixed(0)}\xB0)`);
    }
    if (!isCentered) {
      violations.push(
        `Face is not centered horizontally (center at ${(head.centerX * 100).toFixed(1)}%)`
      );
    }
    advisories.push(
      "Yaw is estimated from facial landmarks; head pitch and capture quality are not measured by this engine."
    );
    return {
      faceDetected: true,
      faceCount: faces.length,
      rollDegrees: round(roll, 1),
      yawDegrees: round(yaw, 1),
      pitchDegrees: null,
      qualityScore: null,
      chinYNormalized: round(head.bottom, 3),
      crownYNormalized: round(head.top, 3),
      eyeLevelNormalized: round(head.eyes ?? 0, 3),
      headHeightRatio: round(head.bottom - head.top, 3),
      isCentered,
      compliant: violations.length === 0,
      violations,
      advisories,
      engineUsed: "onnx"
    };
  }
  async process(options) {
    const sharp = await loadSharp();
    const image = await readImage(options.inputPath);
    const { width: imgW, height: imgH } = image;
    if (imgW <= 10 || imgH <= 10) throw new Error("Invalid image dimensions");
    let background = null;
    if (options.bgColorHex !== "none") {
      background = parseHex(options.bgColorHex);
      if (!background) {
        throw new Error("Invalid background colour; expected #RRGGBB, #RRGGBBAA or none");
      }
    }
    const notes = [];
    let mask = null;
    if (background || options.autoFrame) {
      try {
        mask = await segmentPerson(image);
      } catch (err) {
        if (background) {
          notes.push(
            `Person segmentation failed; the original background was kept (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }
    }
    let head = null;
    if (options.autoFrame) {
      const [face] = await detectFaces(image);
      if (face) {
        head = getHeadBox(face, mask ? await maskData(mask, image) : null);
      } else {
        notes.push("No face detected; auto-frame was skipped and the photo was centre-cropped");
      }
    }
    const bgReplaced = Boolean(background && mask);
    if (background && mask) replaceBackground(image, mask, background);
    const aspect = options.targetWidth / options.targetHeight;
    let rect;
    if (head) {
      const ratio = Math.min(Math.max(options.targetHeadRatio, 0.2), 0.95);
      const headPx = Math.max(50, (head.bottom - head.top) * imgH);
      let height2 = headPx / ratio;
      const eyeHeight = options.targetEyeHeight;
      const top2 = (h) => eyeHeight && head.eyes !== void 0 ? head.eyes * imgH - (1 - eyeHeight) * h : head.top * imgH - options.targetTopMargin * h;
      if (!bgReplaced) {
        height2 = Math.min(height2, imgH, imgW / aspect);
      }
      const width2 = height2 * aspect;
      let x = head.centerX * imgW - width2 / 2;
      let y = top2(height2);
      if (!bgReplaced) {
        x = Math.max(0, Math.min(imgW - width2, x));
        y = Math.max(0, Math.min(imgH - height2, y));
      }
      rect = { x, y, width: width2, height: height2 };
    } else {
      const height2 = Math.min(imgH, imgW / aspect);
      const width2 = height2 * aspect;
      rect = { x: (imgW - width2) / 2, y: (imgH - height2) / 2, width: width2, height: height2 };
    }
    const left = Math.round(rect.x);
    const top = Math.round(rect.y);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pad = {
      left: Math.max(0, -left),
      top: Math.max(0, -top),
      right: Math.max(0, left + width - imgW),
      bottom: Math.max(0, top + height - imgH)
    };
    let source = sharp(image.data, rawInput(image));
    if (pad.left || pad.top || pad.right || pad.bottom) {
      const [r, g, b, a] = background ?? [255, 255, 255, 255];
      const padded = await source.extend({ ...pad, background: { r, g, b, alpha: a / 255 } }).raw().toBuffer({ resolveWithObject: true });
      source = sharp(padded.data, {
        raw: { width: padded.info.width, height: padded.info.height, channels: 4 }
      });
    }
    const output = source.extract({ left: left + pad.left, top: top + pad.top, width, height }).resize(options.targetWidth, options.targetHeight, { fit: "fill" });
    await writeImage(output, options.outputPath, options.dpi);
    return {
      success: true,
      outputPath: options.outputPath,
      width: options.targetWidth,
      height: options.targetHeight,
      dpi: options.dpi,
      backgroundReplaced: bgReplaced,
      engineUsed: "onnx",
      message: notes.length ? notes.join("; ") : null
    };
  }
  async renderSheet(options) {
    const sharp = await loadSharp();
    const { sheetWidthPx: width, sheetHeightPx: height } = options;
    if (!(width > 0 && height > 0 && width <= 2e4 && height <= 2e4)) {
      throw new Error("Invalid sheet dimensions");
    }
    const cells = options.cells.map((c) => ({
      x: Math.round(c.x),
      y: Math.round(c.y),
      width: Math.round(c.width),
      height: Math.round(c.height)
    }));
    if (cells.length === 0) throw new Error("No cells to draw");
    for (const c of cells) {
      if (c.width <= 0 || c.height <= 0 || c.x < 0 || c.y < 0 || c.x + c.width > width || c.y + c.height > height) {
        throw new Error("Cell lies outside the sheet");
      }
    }
    const sheet = Buffer.alloc(width * height * 3, 255);
    if (options.cutGuides) {
      const dot = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        sheet.fill(153, (y * width + x) * 3, (y * width + x) * 3 + 3);
      };
      for (const c of cells) {
        for (let x = c.x - 1; x <= c.x + c.width; x++) {
          dot(x, c.y - 1);
          dot(x, c.y + c.height);
        }
        for (let y = c.y - 1; y <= c.y + c.height; y++) {
          dot(c.x - 1, y);
          dot(c.x + c.width, y);
        }
      }
    }
    const tiles = /* @__PURE__ */ new Map();
    for (const c of cells) {
      const key = `${c.width}x${c.height}`;
      if (!tiles.has(key)) {
        tiles.set(
          key,
          await sharp(options.photoPath).rotate().removeAlpha().resize(c.width, c.height, { fit: "cover", position: "centre" }).png().toBuffer()
        );
      }
    }
    const output = sharp(sheet, { raw: { width, height, channels: 3 } }).composite(
      cells.map((c) => ({ input: tiles.get(`${c.width}x${c.height}`), left: c.x, top: c.y }))
    );
    await writeImage(output, options.outputPath, options.dpi);
    return {
      success: true,
      outputPath: options.outputPath,
      width,
      height,
      dpi: options.dpi,
      cellCount: cells.length,
      engineUsed: "onnx",
      message: null
    };
  }
};

// src/engine/index.ts
var NoVisionEngineError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "NoVisionEngineError";
  }
};
var onnxEngine = null;
function requireVisionEngine(capabilities = detectPlatformCapabilities()) {
  if (capabilities.engine === "apple-vision" && capabilities.nativeBinaryPath) {
    return new AppleVisionEngine(capabilities.nativeBinaryPath);
  }
  if (capabilities.engine === "onnx") {
    onnxEngine ??= new OnnxEngine();
    return onnxEngine;
  }
  throw new NoVisionEngineError(
    capabilities.unavailableReason ?? `no vision engine available on ${capabilities.platform}/${capabilities.arch}`
  );
}

// src/pathGuard.ts
import fs3 from "node:fs";
import path4 from "node:path";
var IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];
var PNG_EXTENSIONS = [".png"];
var MANIFEST_EXTENSIONS = [".json"];
var MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;
var PathGuardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PathGuardError";
  }
};
function getAllowedRoot(env = process.env) {
  const configured = env.IDIFY_MCP_ROOT?.trim();
  const candidate = path4.resolve(configured || process.cwd());
  let real;
  try {
    real = fs3.realpathSync(candidate);
  } catch {
    throw new PathGuardError(
      `Allowed root ${candidate} does not exist (set IDIFY_MCP_ROOT to an existing directory)`
    );
  }
  if (!fs3.statSync(real).isDirectory()) {
    throw new PathGuardError(`Allowed root ${real} is not a directory`);
  }
  return real;
}
function isInside(root, target) {
  const rel = path4.relative(root, target);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${path4.sep}`) && !path4.isAbsolute(rel);
}
function lstatOrNull(p) {
  try {
    return fs3.lstatSync(p);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
function resolveSafePath(input, options) {
  const { label, mode, extensions } = options;
  const root = options.root ?? getAllowedRoot();
  if (typeof input !== "string" || input.trim() === "") {
    throw new PathGuardError(`${label} must be a non-empty path`);
  }
  if (input.includes("\0")) {
    throw new PathGuardError(`${label} contains a NUL byte`);
  }
  const resolved = path4.resolve(root, input);
  const ext = path4.extname(resolved).toLowerCase();
  if (!extensions.includes(ext)) {
    throw new PathGuardError(
      `${label} must have one of these extensions: ${extensions.join(", ")} (got "${ext || "none"}")`
    );
  }
  if (!isInside(root, resolved) || resolved === root) {
    throw new PathGuardError(
      `${label} resolves outside the allowed root ${root} (set IDIFY_MCP_ROOT to widen it)`
    );
  }
  const missing = [];
  let ancestor = path4.dirname(resolved);
  while (!lstatOrNull(ancestor)) {
    missing.unshift(path4.basename(ancestor));
    const parent = path4.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  let realAncestor;
  try {
    realAncestor = fs3.realpathSync(ancestor);
  } catch {
    throw new PathGuardError(`${label}: cannot resolve parent directory`);
  }
  if (!isInside(root, realAncestor)) {
    throw new PathGuardError(
      `${label} resolves outside the allowed root ${root} through a symbolic link`
    );
  }
  if (!fs3.statSync(realAncestor).isDirectory()) {
    throw new PathGuardError(`${label}: parent path is not a directory`);
  }
  const safePath = path4.join(realAncestor, ...missing, path4.basename(resolved));
  const stat = lstatOrNull(safePath);
  if (stat?.isSymbolicLink()) {
    throw new PathGuardError(`${label} is a symbolic link, which is not allowed`);
  }
  if (mode === "read") {
    if (!stat) {
      throw new PathGuardError(`${label} does not exist: ${input}`);
    }
    if (!stat.isFile()) {
      throw new PathGuardError(`${label} is not a regular file: ${input}`);
    }
    return safePath;
  }
  if (stat) {
    if (!stat.isFile()) {
      throw new PathGuardError(`${label} exists and is not a regular file: ${input}`);
    }
    if (!options.overwrite) {
      throw new PathGuardError(
        `${label} already exists: ${input} (pass overwrite: true to replace it)`
      );
    }
  }
  return safePath;
}
function ensureParentDir(safePath) {
  fs3.mkdirSync(path4.dirname(safePath), { recursive: true });
}
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var JPEG_SIGNATURE = [255, 216, 255];
function assertImageFile(safePath, label, maxBytes = MAX_INPUT_IMAGE_BYTES) {
  const { size } = fs3.statSync(safePath);
  if (size === 0) {
    throw new PathGuardError(`${label} is empty`);
  }
  if (size > maxBytes) {
    throw new PathGuardError(
      `${label} is too large (${size} bytes; limit ${maxBytes} bytes)`
    );
  }
  const header = Buffer.alloc(8);
  const fd = fs3.openSync(safePath, "r");
  try {
    fs3.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs3.closeSync(fd);
  }
  if (PNG_SIGNATURE.every((byte, i) => header[i] === byte)) return "png";
  if (JPEG_SIGNATURE.every((byte, i) => header[i] === byte)) return "jpeg";
  throw new PathGuardError(`${label} is not a PNG or JPEG image`);
}

// src/tools/shared.ts
var HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i;
function normalizeHex(value) {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error(`Invalid colour "${value}"; expected #RRGGBB, #RRGGBBAA or "none"`);
  }
  return `#${trimmed.replace(/^#/, "").toLowerCase()}`;
}
var MIN_DPI = 72;
var MAX_DPI = 1200;

// src/specs.ts
import fs4 from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/sheet.ts
var MM_PER_INCH = 25.4;
var DEFAULT_SHEET_SIZE_INCH = { width: 4, height: 6 };
var DEFAULT_SHEET_DPI = 300;
function fitGrid(sheetW, sheetH, photoW, photoH, margin, gutter) {
  const usableW = sheetW - margin * 2;
  const usableH = sheetH - margin * 2;
  if (photoW <= 0 || photoH <= 0 || usableW < photoW || usableH < photoH) {
    return { columns: 0, rows: 0, count: 0 };
  }
  const columns = Math.floor((usableW + gutter) / (photoW + gutter));
  const rows = Math.floor((usableH + gutter) / (photoH + gutter));
  return { columns, rows, count: columns * rows };
}
function planPrintSheet({
  dimension,
  sheetSizeInch = DEFAULT_SHEET_SIZE_INCH,
  dpi = DEFAULT_SHEET_DPI,
  marginMm = 3,
  gutterMm = 2
}) {
  const photoWidthInch = dimension.width / dimension.dpi;
  const photoHeightInch = dimension.height / dimension.dpi;
  if (!(photoWidthInch > 0) || !(photoHeightInch > 0)) {
    return null;
  }
  const photoW = Math.round(photoWidthInch * dpi);
  const photoH = Math.round(photoHeightInch * dpi);
  const margin = Math.round(marginMm / MM_PER_INCH * dpi);
  const gutter = Math.round(gutterMm / MM_PER_INCH * dpi);
  const shortEdge = Math.round(sheetSizeInch.width * dpi);
  const longEdge = Math.round(sheetSizeInch.height * dpi);
  const candidates = [
    ["portrait", shortEdge, longEdge],
    ["landscape", longEdge, shortEdge]
  ].map(([orientation, sheetW, sheetH]) => ({
    orientation,
    sheetW,
    sheetH,
    ...fitGrid(sheetW, sheetH, photoW, photoH, margin, gutter)
  }));
  const best = candidates.reduce(
    (acc, candidate) => candidate.count > acc.count ? candidate : acc
  );
  if (best.count < 1) {
    return null;
  }
  return {
    columns: best.columns,
    rows: best.rows,
    count: best.count,
    orientation: best.orientation,
    sheetWidthPx: best.sheetW,
    sheetHeightPx: best.sheetH,
    dpi,
    photoW,
    photoH,
    margin,
    gutter
  };
}
function printSheetCells(plan) {
  const { columns, rows, photoW, photoH, gutter } = plan;
  const gridW = columns * photoW + (columns - 1) * gutter;
  const gridH = rows * photoH + (rows - 1) * gutter;
  const originX = Math.round((plan.sheetWidthPx - gridW) / 2);
  const originY = Math.round((plan.sheetHeightPx - gridH) / 2);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: originX + column * (photoW + gutter),
        y: originY + row * (photoH + gutter),
        width: photoW,
        height: photoH
      });
    }
  }
  return cells;
}

// src/specs.ts
var SPEC_CANDIDATES = [
  new URL("./data/spec.json", import.meta.url),
  new URL("../../common/src/config/spec.json", import.meta.url)
];
var cache = null;
function loadAllSpecs() {
  if (cache) return cache;
  const found = SPEC_CANDIDATES.map((url) => fileURLToPath2(url)).find(
    (p) => fs4.existsSync(p)
  );
  if (!found) {
    throw new Error(
      `Spec database not found (looked in ${SPEC_CANDIDATES.map((u) => fileURLToPath2(u)).join(", ")}). Rebuild with "pnpm --filter @idify/mcp build".`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs4.readFileSync(found, "utf8"));
  } catch (err) {
    throw new Error(
      `Spec database at ${found} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Spec database at ${found} is not an array`);
  }
  cache = parsed;
  return cache;
}
function findSpec(name) {
  const wanted = name.trim().toLowerCase();
  const spec = loadAllSpecs().find((s) => s.name?.toLowerCase() === wanted);
  if (!spec) {
    throw new Error(`Spec "${name}" not found. Use list_specs to find a valid spec name.`);
  }
  return spec;
}
function specSizeMm(spec) {
  const dpi = spec.dimension.dpi;
  return {
    widthMm: spec.dimension.width / dpi * MM_PER_INCH,
    heightMm: spec.dimension.height / dpi * MM_PER_INCH
  };
}
function getHeadBounds(spec) {
  const rules = spec.rules;
  if (!rules) return null;
  const { minHeadHeight = 0, maxHeadHeight = 0, minHeadOffset = 0 } = rules;
  if (minHeadHeight <= 0 && maxHeadHeight <= 0) return null;
  return {
    minHead: minHeadHeight,
    maxHead: maxHeadHeight > 0 ? maxHeadHeight : null,
    crownOffset: minHeadOffset > 0 ? minHeadOffset : null
  };
}

// src/tools/listSpecs.ts
var round1 = (n) => Math.round(n * 10) / 10;
function filterSpecs(params = {}) {
  const countryQuery = (params.country || "").trim().toLowerCase();
  const typeQuery = (params.type || "").trim().toLowerCase();
  const textQuery = (params.query || "").trim().toLowerCase();
  return loadAllSpecs().filter((spec) => {
    if (countryQuery) {
      const matchRegion = spec.region?.toLowerCase().includes(countryQuery);
      const matchZone = spec.zone?.toLowerCase() === countryQuery;
      const matchName = spec.name?.toLowerCase().includes(countryQuery);
      if (!matchRegion && !matchZone && !matchName) return false;
    }
    if (typeQuery && spec.type?.toLowerCase() !== typeQuery) return false;
    if (textQuery) {
      const inTitle = spec.title?.toLowerCase().includes(textQuery);
      const inRegion = spec.region?.toLowerCase().includes(textQuery);
      const inName = spec.name?.toLowerCase().includes(textQuery);
      if (!inTitle && !inRegion && !inName) return false;
    }
    return true;
  }).map((spec) => {
    const { widthMm, heightMm } = specSizeMm(spec);
    const bounds = getHeadBounds(spec);
    return {
      name: spec.name,
      title: spec.title,
      type: spec.type,
      region: spec.region,
      zone: spec.zone,
      flag: spec.flag,
      dimension: spec.dimension,
      widthMm: round1(widthMm),
      heightMm: round1(heightMm),
      minHeadHeightMm: bounds ? round1(bounds.minHead * heightMm) : void 0,
      maxHeadHeightMm: bounds && bounds.maxHead !== null ? round1(bounds.maxHead * heightMm) : void 0,
      background: spec.background,
      prohibitBackgroundRemoval: Boolean(spec.prohibitBackgroundRemoval),
      comment: spec.comment
    };
  });
}
function listSpecs(params = {}, capabilities = detectPlatformCapabilities()) {
  const specs = filterSpecs(params);
  return {
    engine: {
      name: capabilities.engine,
      platform: capabilities.platform,
      arch: capabilities.arch,
      visionToolsAvailable: capabilities.engine !== "none",
      unavailableReason: capabilities.unavailableReason
    },
    count: specs.length,
    specs
  };
}

// src/tools/validateCompliance.ts
var HEAD_RATIO_TOLERANCE = 0.03;
function headSizeViolation(headHeightRatio, bounds, title) {
  if (!bounds) return null;
  const pct = (n) => `${Math.round(n * 100)}%`;
  if (headHeightRatio < bounds.minHead - HEAD_RATIO_TOLERANCE) {
    return `Head is too small for ${title} (${pct(headHeightRatio)} < ${pct(bounds.minHead)} of photo height)`;
  }
  if (bounds.maxHead !== null && headHeightRatio > bounds.maxHead + HEAD_RATIO_TOLERANCE) {
    return `Head is too large for ${title} (${pct(headHeightRatio)} > ${pct(bounds.maxHead)} of photo height)`;
  }
  return null;
}
function applySpecRules(report, spec) {
  const bounds = getHeadBounds(spec);
  const prohibitBg = Boolean(spec.prohibitBackgroundRemoval);
  const violations = [...report.violations];
  const advisories = [...report.advisories];
  report.specMatched = {
    name: spec.name,
    title: spec.title,
    prohibitBackgroundRemoval: prohibitBg,
    minHeadHeight: bounds?.minHead ?? null,
    maxHeadHeight: bounds?.maxHead ?? null
  };
  if (report.faceDetected) {
    const violation = headSizeViolation(report.headHeightRatio, bounds, spec.title);
    if (violation) violations.push(violation);
    advisories.push(
      "headHeightRatio is measured against the input image height; the head-size check is only meaningful for a photo already cropped to this spec (e.g. the output of auto_crop_and_retouch)."
    );
  }
  if (!bounds) {
    advisories.push(`${spec.title} defines no head-size rules; head size was not checked.`);
  }
  if (prohibitBg) {
    advisories.push(
      `Official rules for ${spec.title} prohibit digital background removal or replacement; submit a photo taken against the required background.`
    );
  }
  return { ...report, violations, advisories, compliant: violations.length === 0 };
}
async function validatePhotoCompliance(params, deps = {}) {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities);
  const spec = params.spec_name ? findSpec(params.spec_name) : null;
  const imagePath = resolveSafePath(params.image_path, {
    label: "image_path",
    mode: "read",
    extensions: IMAGE_EXTENSIONS
  });
  assertImageFile(imagePath, "image_path");
  const report = await engine.inspect(imagePath);
  return spec ? applySpecRules(report, spec) : report;
}

// src/tools/autoCropRetouch.ts
var FALLBACK_HEAD_RATIO = 0.6;
var FALLBACK_TOP_MARGIN = 0.1;
function framingTargets(spec) {
  const bounds = getHeadBounds(spec);
  if (!bounds) {
    return { headRatio: FALLBACK_HEAD_RATIO, topMargin: FALLBACK_TOP_MARGIN, fromSpec: false };
  }
  const { minEyeHeight = 0, maxEyeHeight = 0 } = spec.rules ?? {};
  const eyeHeight = minEyeHeight > 0 && maxEyeHeight > 0 ? (minEyeHeight + maxEyeHeight) / 2 : Math.max(minEyeHeight, maxEyeHeight);
  const headRatio = bounds.maxHead !== null ? (bounds.minHead + bounds.maxHead) / 2 : Math.min(bounds.minHead + 0.05, 0.95);
  return {
    headRatio,
    topMargin: bounds.crownOffset ?? FALLBACK_TOP_MARGIN,
    ...eyeHeight > 0 ? { eyeHeight } : {},
    fromSpec: true
  };
}
async function autoCropAndRetouch(params, deps = {}) {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities);
  const spec = findSpec(params.spec_name);
  const inputPath = resolveSafePath(params.input_path, {
    label: "input_path",
    mode: "read",
    extensions: IMAGE_EXTENSIONS
  });
  assertImageFile(inputPath, "input_path");
  const outputPath = resolveSafePath(params.output_path, {
    label: "output_path",
    mode: "write",
    extensions: IMAGE_EXTENSIONS,
    overwrite: params.overwrite === true
  });
  if (outputPath === inputPath) {
    throw new Error("output_path must differ from input_path");
  }
  const specDpi = spec.dimension.dpi;
  const dpi = params.dpi ?? specDpi;
  const targetWidth = Math.round(spec.dimension.width / specDpi * dpi);
  const targetHeight = Math.round(spec.dimension.height / specDpi * dpi);
  const advisories = [];
  const { headRatio, topMargin, eyeHeight, fromSpec } = framingTargets(spec);
  if (!fromSpec) {
    advisories.push(`${spec.title} defines no head-size rules; framed to a generic ${FALLBACK_HEAD_RATIO * 100}% head height.`);
  }
  let bgColor;
  let backgroundPolicy;
  if (spec.prohibitBackgroundRemoval) {
    bgColor = "none";
    backgroundPolicy = "original-preserved (digital background replacement is prohibited by the official spec)";
    if (params.background_color && params.background_color.toLowerCase() !== "none") {
      advisories.push(
        `background_color was ignored: ${spec.title} prohibits digital background replacement.`
      );
    }
  } else if (params.background_color) {
    bgColor = params.background_color.toLowerCase() === "none" ? "none" : normalizeHex(params.background_color);
    backgroundPolicy = bgColor === "none" ? "original-preserved (requested)" : `custom (${bgColor})`;
  } else {
    bgColor = normalizeHex(spec.background || "#ffffff");
    backgroundPolicy = `spec-default (${bgColor})`;
  }
  ensureParentDir(outputPath);
  const result = await engine.process({
    inputPath,
    outputPath,
    targetWidth,
    targetHeight,
    bgColorHex: bgColor,
    autoFrame: params.auto_frame ?? true,
    targetHeadRatio: headRatio,
    targetTopMargin: topMargin,
    targetEyeHeight: eyeHeight,
    dpi
  });
  if (bgColor !== "none" && !result.backgroundReplaced) {
    backgroundPolicy = `original-preserved (person segmentation failed; ${bgColor} not applied)`;
  }
  if (result.message) advisories.push(result.message);
  return {
    ...result,
    specName: spec.name,
    specTitle: spec.title,
    backgroundPolicy,
    targetHeadRatio: Math.round(headRatio * 1e3) / 1e3,
    advisories
  };
}

// src/tools/createPrintSheet.ts
import fs5 from "node:fs";
var round12 = (n) => Math.round(n * 10) / 10;
function computeSheetLayout(spec, dpi = DEFAULT_SHEET_DPI, cutGuides = true) {
  const plan = planPrintSheet({ dimension: spec.dimension, dpi });
  if (!plan) {
    throw new Error(
      `${spec.title} photos do not fit on a ${DEFAULT_SHEET_SIZE_INCH.width}x${DEFAULT_SHEET_SIZE_INCH.height} inch sheet with 3 mm margins`
    );
  }
  const { widthMm, heightMm } = specSizeMm(spec);
  const cells = printSheetCells(plan).map((cell, i) => ({
    col: i % plan.columns + 1,
    row: Math.floor(i / plan.columns) + 1,
    ...cell
  }));
  return {
    spec: spec.name,
    specTitle: spec.title,
    photoSizeMm: { width: round12(widthMm), height: round12(heightMm) },
    sheetSizeInch: { ...DEFAULT_SHEET_SIZE_INCH },
    sheetDimensionsMm: {
      width: round12(plan.sheetWidthPx / plan.dpi * MM_PER_INCH),
      height: round12(plan.sheetHeightPx / plan.dpi * MM_PER_INCH)
    },
    orientation: plan.orientation,
    dpi: plan.dpi,
    sheetWidthPx: plan.sheetWidthPx,
    sheetHeightPx: plan.sheetHeightPx,
    columns: plan.columns,
    rows: plan.rows,
    photosPerSheet: plan.count,
    photoWidthPx: plan.photoW,
    photoHeightPx: plan.photoH,
    marginPx: plan.margin,
    gutterPx: plan.gutter,
    cutGuides,
    cells
  };
}
async function createPrintSheet(params, deps = {}) {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities);
  const spec = findSpec(params.spec_name);
  const overwrite = params.overwrite === true;
  const photoPath = resolveSafePath(params.photo_path, {
    label: "photo_path",
    mode: "read",
    extensions: IMAGE_EXTENSIONS
  });
  assertImageFile(photoPath, "photo_path");
  const outputPath = resolveSafePath(params.output_path, {
    label: "output_path",
    mode: "write",
    extensions: PNG_EXTENSIONS,
    overwrite
  });
  const manifestPath = params.manifest_path ? resolveSafePath(params.manifest_path, {
    label: "manifest_path",
    mode: "write",
    extensions: MANIFEST_EXTENSIONS,
    overwrite
  }) : null;
  if (outputPath === photoPath || manifestPath === photoPath || manifestPath === outputPath) {
    throw new Error("photo_path, output_path and manifest_path must all be different files");
  }
  const layout = computeSheetLayout(spec, params.sheet_dpi ?? DEFAULT_SHEET_DPI, params.cut_guides ?? true);
  ensureParentDir(outputPath);
  const rendered = await engine.renderSheet({
    photoPath,
    outputPath,
    sheetWidthPx: layout.sheetWidthPx,
    sheetHeightPx: layout.sheetHeightPx,
    dpi: layout.dpi,
    cells: layout.cells,
    cutGuides: layout.cutGuides
  });
  if (manifestPath) {
    ensureParentDir(manifestPath);
    fs5.writeFileSync(manifestPath, JSON.stringify(layout, null, 2) + "\n", {
      flag: overwrite ? "w" : "wx"
    });
  }
  return {
    success: true,
    outputPath: rendered.outputPath,
    manifestPath,
    engineUsed: rendered.engineUsed,
    layout
  };
}

// src/server.ts
var SERVER_NAME = "idify-mcp";
var SERVER_VERSION = "0.1.0";
var dpiSchema = z.number().int().min(MIN_DPI).max(MAX_DPI);
var specNameSchema = z.string().trim().min(1);
var pathSchema = z.string().min(1);
var overwriteSchema = z.boolean().optional().describe("Replace output files that already exist (default: false).");
function buildInstructions(capabilities, root) {
  const engineLine = capabilities.engine === "apple-vision" ? `Vision engine: apple-vision (native binary on ${capabilities.platform}/${capabilities.arch}). All four tools are available.` : capabilities.engine === "onnx" ? `Vision engine: onnx (on-device models on ${capabilities.platform}/${capabilities.arch}). All four tools are available; head pitch and capture quality are not measured.` : `Vision engine: none. ${capabilities.unavailableReason}. Only list_specs works; validate_photo_compliance, auto_crop_and_retouch and create_print_sheet return an error.`;
  return [
    "Idify: passport, visa and ID photo specifications and local photo processing. Nothing is sent over the network.",
    engineLine,
    `File access is confined to ${root} (IDIFY_MCP_ROOT). Paths may be relative to it. Inputs must be existing .png/.jpg/.jpeg files; outputs are never overwritten unless overwrite: true is passed.`
  ].join("\n");
}
function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorResult(tool, err) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `${tool} failed: ${message}` }] };
}
async function run(tool, fn) {
  try {
    return textResult(await fn());
  } catch (err) {
    return errorResult(tool, err);
  }
}
function createServer(options = {}) {
  const capabilities = options.capabilities ?? detectPlatformCapabilities();
  let root;
  try {
    root = getAllowedRoot();
  } catch (err) {
    root = `<invalid: ${err instanceof Error ? err.message : String(err)}>`;
  }
  const deps = { engine: options.engine, capabilities: options.capabilities };
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: buildInstructions(capabilities, root)
    }
  );
  server.registerTool(
    "list_specs",
    {
      description: "List official passport, visa and ID photo specifications (500+ regulations) with millimetre dimensions, head-size bounds and background rules. The result also reports which vision engine this server uses.",
      inputSchema: {
        country: z.string().optional().describe('Filter by country name or 2-letter ISO zone (e.g. "Australia", "US").'),
        type: z.string().optional().describe('Filter by photo type: "passport", "visa" or "identification".'),
        query: z.string().optional().describe("Free-text search across titles and country names.")
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) => run("list_specs", () => listSpecs(args, options.capabilities))
  );
  server.registerTool(
    "validate_photo_compliance",
    {
      description: "Check a local portrait photo for ICAO-style compliance: face count, head roll and turn, horizontal centring and, with spec_name, head height against the spec. The optional apple-vision engine also checks pitch and capture quality; the default onnx engine reports those as null. headHeightRatio is measured against the INPUT image, so the head-size check is only meaningful for a photo already cropped to the spec (e.g. the output of auto_crop_and_retouch). Background-removal rules are reported as advisories, not violations. Runs locally.",
      inputSchema: {
        image_path: pathSchema.describe(
          "Path to a .png/.jpg/.jpeg photo inside the allowed root (relative paths resolve against it)."
        ),
        spec_name: specNameSchema.optional().describe('Spec name from list_specs (e.g. "united_states_passport") to check head size against.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) => run("validate_photo_compliance", () => validatePhotoCompliance(args, deps))
  );
  server.registerTool(
    "auto_crop_and_retouch",
    {
      description: "Frame, crop and resize a photo to a spec: positions the head to the spec's head-height range, optionally replaces the background (never when the spec prohibits it, e.g. Australia, Canada, New Zealand), and writes DPI metadata. Output must be a new .png/.jpg/.jpeg inside the allowed root.",
      inputSchema: {
        input_path: pathSchema.describe("Source .png/.jpg/.jpeg photo inside the allowed root."),
        output_path: pathSchema.describe(
          "Where to write the result (.png, .jpg or .jpeg) inside the allowed root."
        ),
        spec_name: specNameSchema.describe('Spec name from list_specs (e.g. "united_states_passport").'),
        background_color: z.string().trim().refine((v) => v.toLowerCase() === "none" || HEX_COLOR_PATTERN.test(v), {
          message: 'must be a hex colour like "#FFFFFF" (or #RRGGBBAA) or "none"'
        }).optional().describe('Hex colour (e.g. "#FFFFFF") or "none" to keep the original background. Default: the spec background. Ignored when the spec prohibits replacement.'),
        auto_frame: z.boolean().optional().describe("Detect the face and frame the head to the spec (default: true)."),
        dpi: dpiSchema.optional().describe(`Output density, ${MIN_DPI}-${MAX_DPI}. Default: the spec DPI. The physical size is kept, so the pixel size scales with it.`),
        overwrite: overwriteSchema
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async (args) => run("auto_crop_and_retouch", () => autoCropAndRetouch(args, deps))
  );
  server.registerTool(
    "create_print_sheet",
    {
      description: "Render a 4x6 inch (10x15 cm) print sheet PNG that tiles a processed photo as many times as fits (3 mm margin, 2 mm gutter, best orientation), with optional hairline cut guides and DPI metadata. Returns the layout (cell coordinates in pixels) and can also save it as JSON via manifest_path.",
      inputSchema: {
        photo_path: pathSchema.describe(
          "The processed single photo (.png/.jpg/.jpeg) inside the allowed root."
        ),
        output_path: pathSchema.describe("Where to write the sheet; must end in .png."),
        spec_name: specNameSchema.describe("Spec name from list_specs; sets the photo size in mm."),
        sheet_dpi: dpiSchema.optional().describe(`Sheet density, ${MIN_DPI}-${MAX_DPI} (default: 300).`),
        cut_guides: z.boolean().optional().describe("Draw hairline cut guides (default: true)."),
        manifest_path: pathSchema.optional().describe("Optional .json path to also save the layout to."),
        overwrite: overwriteSchema
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async (args) => run("create_print_sheet", () => createPrintSheet(args, deps))
  );
  return server;
}

// src/index.ts
console.log = console.error;
console.info = console.error;
console.debug = console.error;
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((err) => {
  console.error("idify-mcp failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
