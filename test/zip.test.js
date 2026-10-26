import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeZip, readZip } from '../public/media.js';

test('zip: written by makeZip, read back by readZip and by an independent unzipper', async () => {
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('Zażółć gęślą jaźń') }, { name: 'dir/b.bin', data: Uint8Array.from({ length: 5000 }, (_, i) => i % 251) }, { name: 'empty', data: new Uint8Array(0) }];
  const blob = makeZip(files);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const back = await readZip(buf);
  assert.deepEqual(back.map((f) => f.name), ['a.txt', 'dir/b.bin', 'empty']);
  assert.deepEqual([...back[1].data], [...files[1].data]);
  assert.equal(new TextDecoder().decode(back[0].data), 'Zażółć gęślą jaźń');
  const dir = mkdtempSync(join(tmpdir(), 'zt-')); writeFileSync(join(dir, 'x.zip'), buf);
  const py = `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist())); print(z.read('dir/b.bin')[:5].hex())`;
  const out = execFileSync('python', ['-c', py, join(dir, 'x.zip')]).toString();
  assert.match(out, /'a.txt', 'dir\/b.bin', 'empty'/); assert.match(out, /0001020304/);
});
