/**
 * تبدیل تاریخ هجری شمسی ↔ میلادی.
 *
 * پیاده‌سازی الگوریتم مرجع Khayyam/jalaali (بدون وابستگی خارجی).
 * صحت تبدیل با آزمون‌های مرزی سال‌های کبیسه در tests/jalali.test.mjs سنجیده می‌شود.
 */

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.floor(a / b) * b;

export const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** محاسبه مشخصات سال شمسی: کبیسه بودن و روز شروع آن در تقویم میلادی */
function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;

  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`سال شمسی نامعتبر: ${jy}`);

  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** شمسی → میلادی */
export function jalaliToGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

/** میلادی → شمسی */
export function gregorianToJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

/** آیا سال شمسی کبیسه است */
export function isLeapJalali(jy) {
  return jalCal(jy).leap === 0;
}

/** امروز به شمسی (بر مبنای تقویم ایران، UTC+3:30) */
export function todayJalali(now = new Date()) {
  const shifted = new Date(now.getTime() + 3.5 * 3_600_000);
  return gregorianToJalali(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** قالب‌بندی خوانا: «۱۵ شهریور ۱۴۰۵» */
export function formatJalali(jy, jm, jd) {
  return `${jd} ${PERSIAN_MONTHS[jm - 1] ?? ''} ${jy}`;
}

/**
 * یافتن و تبدیل تاریخ شمسی داخل متن به ISO میلادی.
 * الگوها: «15 شهریور 1405» ، «1405/06/15» ، «1405-06-15» ، «2026-09-15»
 * @param {string} text
 * @returns {string|null}
 */
export function parseJalaliDate(text) {
  if (!text) return null;
  const t = String(text);

  const named = t.match(
    /(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(\d{4})/,
  );
  if (named) {
    const jd = Number(named[1]);
    const jm = PERSIAN_MONTHS.indexOf(named[2]) + 1;
    const jy = Number(named[3]);
    if (jm > 0 && jd >= 1 && jd <= 31 && jy > 1200 && jy < 1600) {
      try {
        return toISO(jalaliToGregorian(jy, jm, jd));
      } catch {
        /* ادامه می‌دهیم */
      }
    }
  }

  const numeric = t.match(/(1[3-5]\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (numeric) {
    const jy = Number(numeric[1]);
    const jm = Number(numeric[2]);
    const jd = Number(numeric[3]);
    if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      try {
        return toISO(jalaliToGregorian(jy, jm, jd));
      } catch {
        /* ادامه می‌دهیم */
      }
    }
  }

  const iso = t.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function toISO({ gy, gm, gd }) {
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}
