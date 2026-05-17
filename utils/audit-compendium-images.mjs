import { ClassicLevel } from "classic-level";
import fs from "fs/promises";
import http from "http";
import https from "https";
import path from "path";

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const IMAGE_PATH = /(^https?:\/\/|^systems\/|^modules\/|^worlds\/|^icons\/|\/Images\/)/i;
const IMAGE_KEYS = new Set(["img", "icon", "src", "thumb", "thumbnail", "background", "foreground"]);
const workspace = process.cwd();
const outRoot = path.join(workspace, ".tmp", "compendium-image-audit");
const checkAvailability = process.argv.includes("--check");

await fs.mkdir(outRoot, { recursive: true });

const system = JSON.parse(await fs.readFile(path.join(workspace, "system.json"), "utf8"));
const findings = [];
const urlCache = new Map();

for (const pack of system.packs) {
  const packPath = await copyPackForRead(pack);
  const db = new ClassicLevel(packPath, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();
  for await (const [key, doc] of db.iterator()) {
    const documentName = doc.name || key;
    collectImageRefs(doc, [], ({ keyPath, value }) => {
      findings.push({
        pack: pack.name,
        packLabel: pack.label,
        documentId: doc._id,
        documentKey: key,
        documentName,
        documentType: doc.type || pack.type,
        field: keyPath.join("."),
        value,
      });
    });
  }
  await db.close();
}

if (checkAvailability) {
  const uniqueRefs = [...new Set(findings.map((finding) => finding.value))];
  const checks = new Map();

  await asyncPool(32, uniqueRefs, async (ref) => {
    checks.set(ref, await checkRef(ref));
  });

  for (const finding of findings) {
    Object.assign(finding, checks.get(finding.value));
  }
}

const reportPath = path.join(outRoot, checkAvailability ? "image-report.checked.json" : "image-report.json");
await fs.writeFile(reportPath, `${JSON.stringify(findings, null, 2)}\n`, "utf8");

const missing = findings.filter((f) => f.available === false);
const summary = {
  reportPath,
  totalRefs: findings.length,
  uniqueRefs: new Set(findings.map((f) => f.value)).size,
  checked: checkAvailability,
  missingRefs: missing.length,
  uniqueMissingRefs: new Set(missing.map((f) => f.value)).size,
};

console.log(JSON.stringify(summary, null, 2));

function collectImageRefs(value, keyPath, onRef) {
  if (typeof value === "string") {
    const key = keyPath.at(-1);
    if (looksLikeImageRef(key, value)) onRef({ keyPath, value });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectImageRefs(entry, [...keyPath, index], onRef));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    collectImageRefs(child, [...keyPath, key], onRef);
  }
}

function looksLikeImageRef(key, value) {
  if (!value || value === "icons/svg/mystery-man.svg") return false;
  const normalizedKey = String(key || "").toLowerCase();
  return (IMAGE_KEYS.has(normalizedKey) || IMAGE_EXT.test(value) || IMAGE_PATH.test(value)) && IMAGE_EXT.test(value);
}

async function copyPackForRead(pack) {
  const source = path.resolve(workspace, pack.path);
  const dest = path.join(outRoot, "leveldb", pack.name);
  const relative = path.relative(outRoot, dest);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to prepare pack outside audit directory: ${dest}`);
  }

  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(source, dest, { recursive: true });

  const currentPath = path.join(dest, "CURRENT");
  const current = await fs.readFile(currentPath, "utf8");
  await fs.writeFile(currentPath, current.replace(/\r\n/g, "\n"), "utf8");
  return dest;
}

async function checkRef(ref) {
  if (urlCache.has(ref)) return urlCache.get(ref);

  let result;
  if (/^https?:\/\//i.test(ref)) {
    result = await checkUrl(ref);
  } else {
    result = await checkLocal(ref);
  }

  urlCache.set(ref, result);
  return result;
}

async function checkUrl(url) {
  try {
    let response = await requestUrl(url, "HEAD");
    if (response.status === 405 || response.status === 403) {
      response = await requestUrl(url, "GET");
    }

    return {
      available: response.status >= 200 && response.status < 400,
      status: response.status,
      statusText: response.statusText,
      checkedAs: "url",
    };
  } catch (error) {
    return {
      available: false,
      status: "FETCH_ERROR",
      statusText: error.message,
      checkedAs: "url",
    };
  }
}

function requestUrl(url, method, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.request(url, { method, timeout: 6000 }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      response.resume();

      if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
        const redirectUrl = new URL(location, url).toString();
        resolve(requestUrl(redirectUrl, method, redirects + 1));
        return;
      }

      resolve({ status, statusText: response.statusMessage || "" });
    });

    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function asyncPool(limit, items, worker) {
  const executing = new Set();

  for (const item of items) {
    const promise = Promise.resolve().then(() => worker(item));
    executing.add(promise);
    promise.finally(() => executing.delete(promise));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

async function checkLocal(ref) {
  const cleanRef = ref.split("?")[0];

  if (cleanRef.startsWith("icons/")) {
    return {
      available: true,
      status: "FOUNDRY_CORE_ASSET",
      checkedAs: "foundry-core",
    };
  }

  const systemPrefix = "systems/thewitchertrpg/";
  const repoRef = cleanRef.startsWith(systemPrefix) ? cleanRef.slice(systemPrefix.length) : cleanRef;
  const localPath = path.resolve(workspace, repoRef);
  const relative = path.relative(workspace, localPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      available: false,
      status: "OUTSIDE_WORKSPACE",
      checkedAs: "local",
    };
  }

  try {
    const stat = await fs.stat(localPath);
    return {
      available: stat.isFile(),
      status: stat.isFile() ? 200 : "NOT_FILE",
      checkedAs: "local",
    };
  } catch (error) {
    return {
      available: false,
      status: error.code || "MISSING",
      checkedAs: "local",
    };
  }
}
