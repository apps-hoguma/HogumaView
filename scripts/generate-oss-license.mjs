import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tauriDir = join(repoRoot, "src-tauri");
const reportPath = join(tauriDir, "about-report.json");
const outputPath = join(tauriDir, "resources", "LICENSE", "Open Source LICENSE.html");
const runtimeDir = join(tauriDir, "runtime");

function runCargoAboutJson() {
  const result = spawnSync(
    "cargo",
    ["about", "generate", "--format", "json", "-o", reportPath],
    {
      cwd: tauriDir,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLicenseText(text) {
  return text
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadRuntimeLicenses() {
  const runtimeDefs = [
    {
      id: "runtime-vips",
      name: "libvips (vips-dev-8.18)",
      licenseName: "LGPL-2.1-or-later",
      sourcePath: "runtime/vips-dev-8.18/LICENSE",
      noticePath: join(runtimeDir, "vips-dev-8.18", "LICENSE"),
      homepage: "https://github.com/libvips/libvips",
    },
    {
      id: "runtime-exiftool",
      name: "ExifTool",
      licenseName: "GPL-3.0",
      sourcePath: "runtime/exiftool/exiftool_files/LICENSE",
      noticePath: join(runtimeDir, "exiftool", "exiftool_files", "LICENSE"),
      homepage: "https://exiftool.org/",
    },
    {
      id: "runtime-ghostscript",
      name: "Ghostscript",
      licenseName: "AGPL-3.0",
      sourcePath: "runtime/ghostscript/doc/COPYING",
      noticePath: join(runtimeDir, "ghostscript", "doc", "COPYING"),
      homepage: "https://www.ghostscript.com/",
    },
    {
      id: "runtime-imagemagick",
      name: "ImageMagick",
      licenseName: "ImageMagick License",
      sourcePath: "runtime/imagemagick-7.1.2-15/NOTICE.txt",
      noticePath: join(runtimeDir, "imagemagick-7.1.2-15", "NOTICE.txt"),
      homepage: "https://imagemagick.org/",
    },
  ];

  return runtimeDefs.map((item) => {
    const exists = existsSync(item.noticePath);
    const text = exists
      ? normalizeLicenseText(readFileSync(item.noticePath, "utf8"))
      : `라이선스 파일을 찾을 수 없습니다: ${item.sourcePath}`;
    return {
      ...item,
      text,
      exists,
    };
  });
}

function dedupeLicenses(licenses) {
  const map = new Map();

  for (const license of licenses) {
    const normalizedText = normalizeLicenseText(license.text ?? "");
    const key = `${license.name ?? ""}\u0000${normalizedText}`;
    const existing = map.get(key);
    if (existing) {
      existing.used_by.push(...(license.used_by ?? []));
      continue;
    }
    map.set(key, {
      name: license.name ?? "Unknown License",
      text: normalizedText,
      used_by: [...(license.used_by ?? [])],
    });
  }

  const deduped = [];
  for (const value of map.values()) {
    const crateMap = new Map();
    for (const entry of value.used_by) {
      const crate = entry?.crate;
      if (!crate?.name || !crate?.version) {
        continue;
      }
      const crateKey = `${crate.name}@${crate.version}`;
      if (!crateMap.has(crateKey)) {
        crateMap.set(crateKey, {
          name: crate.name,
          version: crate.version,
          repository: crate.repository ?? "",
        });
      }
    }

    const crates = [...crateMap.values()].sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, "en");
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.version.localeCompare(b.version, "en");
    });

    deduped.push({
      name: value.name,
      text: value.text,
      crates,
    });
  }

  deduped.sort((a, b) => {
    const countDiff = b.crates.length - a.crates.length;
    if (countDiff !== 0) {
      return countDiff;
    }
    return a.name.localeCompare(b.name, "en");
  });

  return deduped;
}

function groupByLicenseName(dedupedLicenses) {
  const groups = new Map();

  for (const item of dedupedLicenses) {
    const key = item.name;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        name: item.name,
        variants: [item],
      });
      continue;
    }
    current.variants.push(item);
  }

  const grouped = [...groups.values()].map((group) => {
    const crateMap = new Map();
    for (const variant of group.variants) {
      for (const crate of variant.crates) {
        const crateKey = `${crate.name}@${crate.version}`;
        if (!crateMap.has(crateKey)) {
          crateMap.set(crateKey, crate);
        }
      }
    }

    const crates = [...crateMap.values()].sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, "en");
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.version.localeCompare(b.version, "en");
    });

    group.variants.sort((a, b) => b.crates.length - a.crates.length);
    return {
      name: group.name,
      variants: group.variants,
      crates,
    };
  });

  grouped.sort((a, b) => {
    const countDiff = b.crates.length - a.crates.length;
    if (countDiff !== 0) {
      return countDiff;
    }
    return a.name.localeCompare(b.name, "en");
  });

  return grouped;
}

function buildHtml(groupedLicenses, uniqueTextCount, runtimeLicenses) {
  const generatedAt = new Date().toLocaleString("ko-KR", { hour12: false });
  const totalCrates = groupedLicenses.reduce((sum, item) => sum + item.crates.length, 0);

  const crateOverviewItems = groupedLicenses
    .map(
      (item, index) =>
        `<li><a href="#lic-${index}">${escapeHtml(item.name)}</a> (${item.crates.length}개 크레이트)</li>`,
    )
    .join("\n");

  const runtimeOverviewItems = runtimeLicenses
    .map(
      (item) =>
        `<li><a href="#${item.id}">${escapeHtml(item.licenseName)}</a> (1개 크레이트)</li>`,
    )
    .join("\n");

  const runtimeSections = runtimeLicenses
    .map((item) => {
      const runtimeCrateLabel = item.name;
      const runtimeCrateHref = item.homepage && item.homepage.trim().length > 0
        ? item.homepage
        : "#";
      return `
<li class="license" id="${item.id}">
  <h3>${escapeHtml(item.licenseName)}</h3>
  <p class="muted">사용 크레이트: 1개</p>
  <h4>사용 크레이트</h4>
  <ul class="license-used-by"><li><a href="${escapeHtml(runtimeCrateHref)}">${escapeHtml(runtimeCrateLabel)}</a></li></ul>
  <h4>라이선스 원문</h4>
  <pre class="license-text">${escapeHtml(item.text)}</pre>
</li>`;
    })
    .join("\n");

  const sections = groupedLicenses
    .map((item, index) => {
      const cratesHtml = item.crates
        .map((crate) => {
          const label = `${crate.name} ${crate.version}`;
          const href = crate.name === "hogumaview"
            ? "https://github.com/apps-hoguma/HogumaView"
            : crate.repository && crate.repository.trim().length > 0
            ? crate.repository
            : `https://crates.io/crates/${crate.name}`;
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
        })
        .join("\n");

      const primaryVariant = item.variants[0];

      return `
<li class="license" id="lic-${index}">
  <h3>${escapeHtml(item.name)}</h3>
  <p class="muted">사용 크레이트: ${item.crates.length}개</p>
  <h4>사용 크레이트</h4>
  <ul class="license-used-by">${cratesHtml}</ul>
  <h4>라이선스 원문</h4>
  <pre class="license-text">${escapeHtml(primaryVariant.text)}</pre>
</li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>오픈소스 라이선스 고지</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1b2430;
      --muted: #4a586b;
      --border: #d8dee9;
      --panel: #ffffff;
      --panel-soft: #f7f9fc;
      --link: #ff8a00;
      --link-hover: #e67800;
      --shadow: 0 10px 30px rgba(17, 24, 39, 0.08);
      --shadow-soft: 0 4px 14px rgba(17, 24, 39, 0.05);
    }
    body {
      margin: 0;
      padding: 36px 20px 52px;
      color: var(--text);
      line-height: 1.65;
      font-family: "Pretendard", "Noto Sans KR", "Segoe UI Variable", "Segoe UI", sans-serif;
      background: var(--bg);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --text: #e5e7eb;
        --muted: #b7c1cf;
        --border: #334155;
        --panel: #111827;
        --panel-soft: #0b1220;
        --link: #ffb14a;
        --link-hover: #ffd79d;
        --shadow: 0 12px 28px rgba(2, 6, 23, 0.45);
        --shadow-soft: 0 4px 14px rgba(2, 6, 23, 0.35);
      }
      body {
        background:
          radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.24), transparent 36%),
          radial-gradient(circle at 0% 100%, rgba(249, 115, 22, 0.18), transparent 42%),
          var(--bg);
      }
    }
    .container { max-width: 1100px; margin: 0 auto; }
    .intro {
      text-align: center;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 28px 18px 24px;
      box-shadow: var(--shadow-soft);
      margin-bottom: 24px;
    }
    h1, h2, h3, h4 { line-height: 1.35; margin-top: 28px; margin-bottom: 10px; }
    h1 { font-size: clamp(28px, 4vw, 36px); margin: 0 0 6px; }
    h2 { font-size: clamp(22px, 2.2vw, 28px); margin-top: 30px; margin-bottom: 12px; }
    h3 { font-size: 22px; margin-top: 0; margin-bottom: 8px; }
    h4 { font-size: 16px; margin: 10px 0 8px; }
    p, li { color: var(--muted); }
    p { margin-top: 0; }
    a { color: var(--link); text-underline-offset: 2px; word-break: break-all; transition: color 120ms ease; }
    a:hover { color: var(--link-hover); }
    .licenses-overview {
      list-style-type: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 10px;
    }
    .licenses-overview li {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      box-shadow: var(--shadow-soft);
    }
    .licenses-overview li a { font-weight: 700; }
    .licenses-list { list-style-type: none; margin: 0; padding: 0; }
    .runtime-licenses-list { margin-top: 12px; }
    .license {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
      padding: 18px 18px 16px;
      margin-bottom: 16px;
    }
    .license-used-by { margin-top: 2px; margin-bottom: 12px; padding-left: 20px; }
    .license-used-by li { margin-bottom: 4px; }
    .license-text {
      max-height: 260px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      font-size: 13.5px;
      line-height: 1.55;
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
    details { margin-bottom: 8px; }
    summary { cursor: pointer; color: var(--muted); font-weight: 600; }
    .meta { margin-top: 8px; }
  </style>
</head>
<body>
  <main class="container">
    <div class="intro">
      <h1>오픈소스 라이선스 고지</h1>
      <p>이 페이지는 cargo-about으로 수집한 프로젝트의 라이선스를 보여줍니다.</p>
      <p class="meta">생성 시각: ${escapeHtml(generatedAt)} | 라이선스 종류: ${groupedLicenses.length} | 크레이트: ${totalCrates}</p>
    </div>

    <h2>라이선스 개요</h2>
    <ul class="licenses-overview">
${crateOverviewItems}
    </ul>

    <h2>런타임 라이선스 개요</h2>
    <ul class="licenses-overview">
${runtimeOverviewItems}
    </ul>

    <h2>라이선스 원문</h2>
    <ul class="licenses-list">
${sections}
    </ul>

    <h2>런타임 라이선스 원문</h2>
    <ul class="licenses-list runtime-licenses-list">
${runtimeSections}
    </ul>
  </main>
</body>
</html>`;
}

runCargoAboutJson();
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const runtimeLicenses = loadRuntimeLicenses();
const dedupedLicenses = dedupeLicenses(report.licenses ?? []);
const groupedLicenses = groupByLicenseName(dedupedLicenses);
const html = buildHtml(groupedLicenses, dedupedLicenses.length, runtimeLicenses);
writeFileSync(outputPath, html, "utf8");

console.log(`[license] generated: ${outputPath}`);
console.log(`[license] unique names: ${groupedLicenses.length}`);
console.log(`[license] unique texts: ${dedupedLicenses.length}`);
