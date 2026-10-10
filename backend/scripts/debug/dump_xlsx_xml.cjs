/**
 * Dump xlsx 内部 XML 的关键结构（用于校准评分点检查器）。
 * 用法：node backend/scripts/debug/dump_xlsx_xml.cjs <a.xlsx> [b.xlsx ...] [--full]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yauzl = require('../../node_modules/yauzl');

const KEY = /autoFilter|filterColumn|customFilter|sortCondition|sortState|conditionalFormatting|cfRule|outlinePr|sheetPr|dxf|SUBTOTAL|hidden=|outlineLevel|dimension|<f>|<formula>/;
function unzip(file) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(fs.readFileSync(file), { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out = {};
      let pending = 0, ended = false;
      const done = () => { if (ended && pending === 0) resolve(out); };
      zip.on('entry', (e) => {
        if (/\/$/.test(e.fileName)) return zip.readEntry();
        pending++;
        zip.openReadStream(e, (er, rs) => {
          if (er) { pending--; done(); return zip.readEntry(); }
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => { out[e.fileName] = Buffer.concat(chunks); pending--; done(); zip.readEntry(); });
          rs.on('error', () => { pending--; done(); zip.readEntry(); });
        });
      });
      zip.on('end', () => { ended = true; done(); });
      zip.readEntry();
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const files = args.filter((a) => !a.startsWith('--'));

  for (const f of files) {
    const z = await unzip(f);
    console.log('\n' + '#'.repeat(70));
    console.log('# ' + path.basename(f));
    console.log('#'.repeat(70));
    console.log('[entries] ' + Object.keys(z).join('  '));

    for (const part of ['xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
      const buf = z[part];
      if (!buf) continue;
      const xml = buf.toString('utf8');
      console.log('\n--- ' + part + ' (' + xml.length + ' chars) ---');
      if (part.endsWith('styles.xml')) {
        const m = xml.match(/<dxfs[\s\S]*?<\/dxfs>/);
        const m2 = xml.match(/<numFmts[\s\S]*?<\/numFmts>/);
        if (m2) console.log(m2[0].replace(/></g, '>\n<'));
        console.log(m ? m[0].replace(/></g, '>\n<') : '(no dxfs)');
        continue;
      }
      const lines = xml.replace(/></g, '>\n<').split('\n');
      if (full) { console.log(lines.join('\n')); continue; }
      let shown = 0;
      for (const ln of lines) {
        if (KEY.test(ln)) { console.log(ln); shown++; }
        if (shown > 60) { console.log('... (截断)'); break; }
      }
      if (!shown) console.log('(无可识别结构)');
    }
  }
})();
