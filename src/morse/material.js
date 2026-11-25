export const MATERIAL_PATH = './docs/spec/materials/CL-WAB-SET-001_Rev0.1.json';

const EXPECTED_GROUPS = Object.freeze({ '清音': 48, '記号': 3, '数字': 10 });
const EXPECTED_SYMBOLS = new Set(['゛', '゜', 'ー']);
const EXPECTED_DIGITS = new Set('0123456789');

export function expectedMaterialHash(manifest) {
  const path = MATERIAL_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...manifest.matchAll(new RegExp(`^([0-9a-f]{64})  ${path}$`, 'gm'))];
  if (matches.length !== 1) throw new Error('教材のSHA-256登録が一意に見つかりません');
  return matches[0][1];
}

export async function verifyMaterialBytes(bytes, manifest) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('教材はUTF-8のバイト列で渡してください');
  const expected = expectedMaterialHash(manifest);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('教材のSHA-256が正本と一致しません');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('教材JSONをUTF-8として読み込めません'); }
  return validateMaterial(parsed, actual);
}

export function validateMaterial(data, sha256) {
  if (data?.setId !== 'CL-WAB-SET-001' || data?.rev !== '0.1' || data?.status !== 'CONFIRMED') {
    throw new Error('教材のID・版・状態が承認済みの値と一致しません');
  }
  if (data.notation?.dot !== '.' || data.notation?.dash !== '-' || !Array.isArray(data.entries) || data.entries.length !== 61) {
    throw new Error('教材の記法または61件の構成が不正です');
  }
  const counts = { '清音': 0, '記号': 0, '数字': 0 };
  const seenChars = new Set();
  const seenNumbers = new Set();
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const entries = data.entries.map((entry) => {
    if (!Number.isInteger(entry?.no) || entry.no < 1 || entry.no > 61 || seenNumbers.has(entry.no)) throw new Error('教材の番号が不正または重複しています');
    if (!Object.hasOwn(counts, entry.group)) throw new Error('教材の区分が不正です');
    if (typeof entry.char !== 'string' || [...segmenter.segment(entry.char)].length !== 1 || seenChars.has(entry.char)) throw new Error('教材の文字が不正または重複しています');
    if (typeof entry.code !== 'string' || !/^[.-]{1,5}$/.test(entry.code)) throw new Error('教材の符号が不正です');
    if (entry.group === '記号' && !EXPECTED_SYMBOLS.has(entry.char)) throw new Error('教材の記号が不正です');
    if (entry.group === '数字' && !EXPECTED_DIGITS.has(entry.char)) throw new Error('教材の数字が不正です');
    if (entry.group === '清音' && (EXPECTED_SYMBOLS.has(entry.char) || EXPECTED_DIGITS.has(entry.char))) throw new Error('清音の区分が不正です');
    seenNumbers.add(entry.no);
    seenChars.add(entry.char);
    counts[entry.group]++;
    return Object.freeze({ ...entry, entryId: `${data.setId}/${data.rev}#${entry.no}` });
  });
  if (Object.entries(EXPECTED_GROUPS).some(([group, count]) => counts[group] !== count)) throw new Error('教材の区分別件数が不正です');
  return Object.freeze({ setId: data.setId, rev: data.rev, sha256, entries: Object.freeze(entries) });
}

export async function loadApprovedMaterial({ fetcher = fetch, materialUrl = '../docs/spec/materials/CL-WAB-SET-001_Rev0.1.json', manifestUrl = '../docs/SHA256SUMS.txt' } = {}) {
  const [materialResponse, manifestResponse] = await Promise.all([fetcher(materialUrl), fetcher(manifestUrl)]);
  if (!materialResponse.ok || !manifestResponse.ok) throw new Error('教材またはSHA-256一覧を取得できません');
  return verifyMaterialBytes(new Uint8Array(await materialResponse.arrayBuffer()), await manifestResponse.text());
}
