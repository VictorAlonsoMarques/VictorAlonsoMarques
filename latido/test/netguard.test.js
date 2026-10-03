import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp } from '../src/netguard.js';
import { httpCheck } from '../src/checker.js';

test('bloquea direcciones internas', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp('8.8.8.8'), false);
  const r = await httpCheck('http://127.0.0.1:8006/');
  assert.equal(r.ok, false);
  assert.match(r.error, /no permitida/);
});

test('bloquea IP privadas en IPv6 y nombres que resuelven a localhost', async () => {
  assert.match((await httpCheck('http://[::1]:8006/')).error, /no permitida/);
  assert.match((await httpCheck('http://localhost:8006/')).error, /no permitida/);
});
