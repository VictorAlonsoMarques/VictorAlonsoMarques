import dns from 'node:dns';
import net from 'node:net';

// Impide que los clientes monitoricen direcciones internas del servidor
// (Proxmox, red privada de OVH, localhost...). Se aplica en cada conexión,
// así que también cubre redirecciones y DNS que cambia entre comprobaciones.
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(addr, prefix, 'ipv6');

export function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 6 && ip.toLowerCase().startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  return blocked.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

export const allowPrivate = process.env.ALLOW_PRIVATE_TARGETS === 'true';

// Node no llama a lookup cuando el host ya es una IP, así que las IP literales se comprueban aparte.
export function checkIpLiteral(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(h) && isPrivateIp(h)) return new Error('Dirección no permitida (red privada)');
  return null;
}

export function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const ok = allowPrivate ? addrs : addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length) return callback(new Error('Dirección no permitida (red privada)'));
    if (options.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}
