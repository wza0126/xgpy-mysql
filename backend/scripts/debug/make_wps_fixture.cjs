/**
 * 用「人口密度数据分析表.xlsx」（未做的原始模板）派生出 4 份测试卷：
 *   correct.xlsx      全部做对（含公式、数字格式、簇状柱形图）
 *   nochart.xlsx      只差第 4 步的图表
 *   hardcode.xlsx     D 列手填数字（没用公式），求和也用常量
 *   rawdecimal.xlsx   D 列用 =C3*10000/B3 但没设 0 位小数（值带小数）
 *
 * 目的：让 wps-grader 的每条评分点都有"真文件"能区分对错，避免只靠肉眼看代码。
 * 产物在 backend/scripts/debug/fixtures/ 下（gitignore 之外，随仓库留作回归资产）。
 *
 * 用法：node backend/scripts/debug/make_wps_fixture.cjs [源xlsx路径]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yauzl = require('../../node_modules/yauzl');
const archiver = require('../../node_modules/archiver');

// ⚠️ 源模板优先用 fixtures 里固化的副本（随仓库走，不依赖仓库外/根目录的文件）；
//    找不到才回落到仓库根目录的原始文件。
const SRC_CANDIDATES = [
  path.join(__dirname, 'fixtures', 'source_popshen_template.xlsx'),
  path.join(__dirname, '../../..', '人口密度数据分析表.xlsx'),
];
const SRC = process.argv[2] || SRC_CANDIDATES.find((p) => fs.existsSync(p)) || SRC_CANDIDATES[0];
const OUT_DIR = path.join(__dirname, 'fixtures');

function unzipAll(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const files = {};
      let pending = 0;
      let ended = false;
      const done = () => { if (ended && pending === 0) resolve(files); };
      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        pending++;
        zip.openReadStream(entry, (e, rs) => {
          if (e) { pending--; done(); return zip.readEntry(); }
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks);
            pending--; done(); zip.readEntry();
          });
          rs.on('error', () => { pending--; done(); zip.readEntry(); });
        });
      });
      zip.on('end', () => { ended = true; done(); });
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

function zipUp(files, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve(dest));
    archive.on('error', reject);
    archive.pipe(out);
    // [Content_Types].xml 放最前，模拟真实 xlsx
    const names = Object.keys(files).sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a.localeCompare(b)));
    for (const n of names) archive.append(files[n], { name: n });
    archive.finalize();
  });
}

const COL = (i) => {
  let s = '';
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

const TITLE = 'w市人口密度数据分析表';
const CHART_TITLE = 'w市各地区人口密度';

const CONTENT_TYPES_EXTRA = [
  '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
  '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
].join('');

function sheetRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
    '</Relationships>';
}

function drawingRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>' +
    '</Relationships>';
}

function drawingXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<xdr:twoCellAnchor>' +
    '<xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
    '<xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
    '<xdr:graphicFrame macro="">' +
    '<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="图表 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
    '</a:graphicData></a:graphic>' +
    '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
}

// 簇状柱形图：A 列作分类轴、D 列作数值轴（只有一条数据系列）
function chartXmlReal() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<c:chart>' +
    '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>' + CHART_TITLE + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    '<c:tx><c:strRef><c:f>Sheet1!$D$2</c:f></c:strRef></c:tx>' +
    '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$13</c:f></c:strRef></c:cat>' +
    '<c:val><c:numRef><c:f>Sheet1!$D$2:$D$13</c:f></c:numRef></c:val>' +
    '</c:ser>' +
    '<c:axId val="111"/><c:axId val="222"/></c:barChart>' +
    '</c:plotArea>' +
    '</c:chart></c:chartSpace>';
}

function readData(sharedStrings, sheet1) {
  // 从原始模板读出 B3:C13 的土地面积与常住人口
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)<\/c>/g;
  const raw = {};
  let m;
  while ((m = cellRe.exec(sheet1))) raw[m[1] + m[2]] = m[4];
  const val = (ref) => {
    const inner = raw[ref];
    if (!inner) return null;
    const v = /<v>([^<]*)<\/v>/.exec(inner);
    return v ? Number(v[1]) : null;
  };
  const rows = [];
  for (let r = 3; r <= 13; r++) rows.push({ r, area: val('B' + r), pop: val('C' + r) });
  return rows;
}

async function build(name, opts) {
  const buf = fs.readFileSync(SRC);
  const files = await unzipAll(buf);
  const sheet1 = files['xl/worksheets/sheet1.xml'].toString('utf8');
  const styles = files['xl/styles.xml'].toString('utf8');
  const sharedStrings = files['xl/sharedStrings.xml'].toString('utf8');

  const rows = readData([], sheet1);

  // --- 1) sharedStrings 追加标题 ---
  let ssCount = (() => { const m = /uniqueCount="(\d+)"/.exec(sharedStrings); return m ? Number(m[1]) : 16; })();
  const titleIdx = ssCount;
  let ss2 = sharedStrings.replace(/(<sst[^>]*uniqueCount=")(\d+)(")/, (_, a, n, c) => a + (Number(n) + 1) + c);
  ss2 = ss2.replace(/(<sst[^>]*count=")(\d+)(")/, (_, a, n, c) => a + (Number(n) + 1) + c);
  ss2 = ss2.replace(/<\/sst>\s*$/, '<si><t>' + TITLE + '</t></si></sst>');

  // --- 2) styles 追加字体与 xf ---
  // 字体 23 = 隶书 17 加粗；xf 11 = 标题样式（隶书17加粗 + 居中 + 合并居中）；xf 12 = 数值 0 位小数 + 居中
  let styl2 = styles;
  const fontCount = Number((/fonts count="(\d+)"/.exec(styles) || [])[1] || 23);
  styl2 = styl2.replace(/(<fonts count=")(\d+)(")/, (_, a, n, c) => a + (Number(n) + 1) + c);
  styl2 = styl2.replace('</fonts>', '<font><b/><sz val="17"/><name val="隶书"/><charset val="134"/></font></fonts>');
  const xfCount = Number((/cellXfs count="(\d+)"/.exec(styles) || [])[1] || 11);
  styl2 = styl2.replace(/(<cellXfs count=")(\d+)(")/, (_, a, n, c) => a + (Number(n) + 2) + c);
  const titleFontId = fontCount; // 新字体在最后
  styl2 = styl2.replace('</cellXfs>',
    '<xf numFmtId="0" fontId="' + titleFontId + '" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>');
  const TITLE_XF = xfCount;         // 11
  const NUM_XF = xfCount + 1;       // 12

  // --- 3) 重建 sheetData ---
  let newSheet = sheet1;

  // 3a) A1 标题（原来 <c r="A1" s="1"/>）
  if (opts.mergeTitle) {
    newSheet = newSheet.replace(/<c r="A1" s="\d+"\/>/, '<c r="A1" s="' + TITLE_XF + '" t="s"><v>' + titleIdx + '</v></c>');
    newSheet = newSheet.replace(/<c r="B1" s="\d+"\/>/, '<c r="B1" s="' + TITLE_XF + '"/>');
    newSheet = newSheet.replace(/<c r="C1" s="\d+"\/>/, '<c r="C1" s="' + TITLE_XF + '"/>');
    newSheet = newSheet.replace(/<c r="D1" s="\d+"\/>/, '<c r="D1" s="' + TITLE_XF + '"/>');
  }

  // 3b) D3:D13 / B14 / C14
  const useFormula = opts.useFormula !== false;
  const forceFormat0 = opts.forceFormat0 === true;
  const dense = rows.map((row) => (row.pop * 10000) / row.area);
  const densInt = dense.map((d) => Math.round(d));
  const sumArea = rows.reduce((a, r) => a + r.area, 0);
  const sumPop = rows.reduce((a, r) => a + r.pop, 0);

  // 样式索引：数字型 0 位小数（NUM_XF，numFmtId=1）或 General（s=7，模板原样式）
  const dStyle = opts.generalFormat ? 7 : NUM_XF;
  for (let i = 0; i < rows.length; i++) {
    const ref = 'D' + rows[i].r;
    const src = rows[i];
    let cellXml;
    if (useFormula) {
      const f = 'C' + src.r + '*10000/B' + src.r;
      // noRound：保留全精度（模拟"只写公式、没设 0 位小数"）；否则取整
      const v = opts.noRound ? Number(dense[i].toFixed(6)) : densInt[i];
      cellXml = '<c r="' + ref + '" s="' + dStyle + '"><f>' + f + '</f><v>' + v + '</v></c>';
    } else {
      cellXml = '<c r="' + ref + '" s="' + dStyle + '"><v>' + densInt[i] + '</v></c>';
    }
    newSheet = newSheet.replace(new RegExp('<c r="' + ref + '" s="\\d+"/>'), cellXml);
  }

  const sumXml = (ref, rng, value) => useFormula
    ? '<c r="' + ref + '" s="' + NUM_XF + '"><f>SUM(' + rng + ')</f><v>' + value + '</v></c>'
    : '<c r="' + ref + '" s="' + NUM_XF + '"><v>' + value + '</v></c>';

  newSheet = newSheet.replace(/<c r="B14" s="\d+"\/>/, useFormula
    ? sumXml('B14', 'B3:B13', sumArea)
    : '<c r="B14" s="' + NUM_XF + '"><v>' + sumArea + '</v></c>');
  newSheet = newSheet.replace(/<c r="C14" s="\d+"\/>/, useFormula
    ? sumXml('C14', 'C3:C13', sumPop)
    : '<c r="C14" s="' + NUM_XF + '"><v>' + sumPop + '</v></c>');

  // 3c) 合并单元格
  if (opts.mergeTitle) {
    newSheet = newSheet.replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>');
  }
  // 3d) 图表
  if (opts.chart) {
    newSheet = newSheet.replace('<pageMargins', '<drawing r:id="rId1"/><pageMargins');
    files['xl/worksheets/_rels/sheet1.xml.rels'] = Buffer.from(sheetRels(), 'utf8');
    files['xl/drawings/drawing1.xml'] = Buffer.from(drawingXml(), 'utf8');
    files['xl/drawings/_rels/drawing1.xml.rels'] = Buffer.from(drawingRels(), 'utf8');
    files['xl/charts/chart1.xml'] = Buffer.from(chartXmlReal(), 'utf8');
    files['[Content_Types].xml'] = Buffer.from(
      files['[Content_Types].xml'].toString('utf8').replace('</Types>', CONTENT_TYPES_EXTRA + '</Types>'), 'utf8');
  }

  files['xl/worksheets/sheet1.xml'] = Buffer.from(newSheet, 'utf8');
  files['xl/styles.xml'] = Buffer.from(styl2, 'utf8');
  files['xl/sharedStrings.xml'] = Buffer.from(ss2, 'utf8');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, name);
  await zipUp(files, dest);
  return { dest, densInt, sumArea, sumPop };
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('找不到源模板：' + SRC);
    process.exit(1);
  }
  const out = {};
  out.correct = await build('wps_popshen_correct.xlsx', { mergeTitle: true, useFormula: true, chart: true });
  out.nochart = await build('wps_popshen_nochart.xlsx', { mergeTitle: true, useFormula: true, chart: false });
  out.hardcode = await build('wps_popshen_hardcode.xlsx', { mergeTitle: true, useFormula: false, chart: true });
  out.rawdecimal = await build('wps_popshen_rawdecimal.xlsx', { mergeTitle: true, useFormula: true, noRound: true, generalFormat: true, chart: true });

  console.log('=== 参考值 ===');
  console.log('D 列应得：', out.correct.densInt.join(', '));
  console.log('B14 =', out.correct.sumArea, ' C14 =', out.correct.sumPop);
  console.log();
  for (const k of Object.keys(out)) console.log(k.padEnd(12), out[k].dest);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
