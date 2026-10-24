// Small binary helpers for the codes in the page URL: base64url, and a byte
// writer / reader with unsigned varints (LEB128) and length-prefixed text.

export function bytesToBase64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class ByteWriter {
  constructor() {
    this.out = [];
  }

  byte(b) {
    this.out.push(b & 0xff);
    return this;
  }

  // Any whole number from 0 to 2^53 (seeds go past 32 bits' signed range).
  uint(n) {
    while (n >= 0x80) {
      this.out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.out.push(n);
    return this;
  }

  bytes(b) {
    this.uint(b.length);
    for (const x of b) this.out.push(x);
    return this;
  }

  text(s) {
    return this.bytes(new TextEncoder().encode(s));
  }

  toBytes() {
    return Uint8Array.from(this.out);
  }
}

// Reads what a ByteWriter wrote; throws a RangeError on a cut-off code.
export class ByteReader {
  constructor(bytes) {
    this.b = bytes;
    this.i = 0;
  }

  get done() {
    return this.i >= this.b.length;
  }

  byte() {
    if (this.done) throw new RangeError("The code is cut off.");
    return this.b[this.i++];
  }

  uint() {
    let n = 0;
    for (let mul = 1; ; mul *= 0x80) {
      if (mul > 2 ** 49) throw new RangeError("The code has a number too big.");
      const b = this.byte();
      n += (b & 0x7f) * mul;
      if (!(b & 0x80)) return n;
    }
  }

  bytes() {
    const n = this.uint();
    if (this.i + n > this.b.length) throw new RangeError("The code is cut off.");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }

  text() {
    return new TextDecoder().decode(this.bytes());
  }
}
