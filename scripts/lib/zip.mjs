// Minimal ZIP reader (stored + deflate entries, zip64 aware) so the Strava
// export archive can be read without external tools or dependencies.
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('Not a ZIP file (end of central directory not found)');
}

/**
 * List the entries of a ZIP archive held in memory.
 * @param {Buffer} buf
 * @returns {Array<{name:string, size:number, compressedSize:number, method:number, read:() => Buffer}>}
 */
export function readZipEntries(buf) {
  const eocd = findEocd(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    // zip64: locator sits right before the EOCD record
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === SIG_EOCD64_LOC) {
      const rec = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(rec) !== SIG_EOCD64) throw new Error('Corrupt zip64 end of central directory');
      count = Number(buf.readBigUInt64LE(rec + 32));
      cdOffset = Number(buf.readBigUInt64LE(rec + 48));
    }
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== SIG_CEN) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // zip64 extra field
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    const entry = {
      name,
      size,
      compressedSize,
      method,
      isDirectory: name.endsWith('/'),
      read() {
        if (buf.readUInt32LE(localOffset) !== SIG_LOC) throw new Error(`Corrupt local header for ${name}`);
        const n = buf.readUInt16LE(localOffset + 26);
        const m = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + n + m;
        const data = buf.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
      },
    };
    entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
