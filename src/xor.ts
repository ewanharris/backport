export function xorHextrings(str1: string, str2: string): string {
  let a = hexToArray(str1);
  let b = hexToArray(str2);
  let res: Array<number> = [];
  if (a.length > b.length) {
    for (let i = 0; i < b.length; i++) {
      res.push(a[i] ^ b[i]);
    }
  } else {
    for (let i = 0; i < a.length; i++) {
      res.push(a[i] ^ b[i]);
    }
  }
  return arrayToHex(res);
}

function hexToArray(str: string): Array<number> {
  let res: Array<number> = [];
  for (let i = 0; i < str.length; ++i) {
    res.push(parseInt(str[i], 16));
  }
  return res;
}

function arrayToHex(a: Array<number>): string {
  let res: string = '';
  for (let i = 0; i < a.length; ++i) {
    res += a[i].toString(16);
  }
  return res;
}
