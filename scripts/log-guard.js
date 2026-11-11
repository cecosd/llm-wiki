// Дневникът wiki/log.md е само за добавяне: записите, които са били в него преди задача, не бива да изчезват.
// Агентът сравнява дневника преди и след всяка задача. Ако някой стар запис липсва, връща всичко от „преди“
// и добавя новите записи от „след“. Редактирането на текста на стар запис (заглавието му е същото) не се връща.
import fs from 'node:fs';

/** Брой на всяко заглавие („## ...“). Едно заглавие може да се повтаря, затова се брои. */
export function entryCounts(text) {
  const counts = new Map();
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) counts.set(line, (counts.get(line) || 0) + 1);
  }
  return counts;
}

/** Блоковете на дневника: всеки започва с „## “. Първият блок е заглавната част (без запис). */
export function splitEntries(text) {
  return String(text).replace(/\r\n/g, '\n').split(/^(?=## )/m);
}

/**
 * Какво трябва да остане в дневника след задача. before: текстът преди задачата (null, ако е нямало файл),
 * after: текстът след нея. Връща { text, lost, added }; lost е броят изчезнали стари записи.
 */
export function repairLog(before, after) {
  if (before == null) return { text: after, lost: 0, added: 0 };
  const current = after == null ? '' : after;
  const need = entryCounts(before);
  const have = entryCounts(current);
  let lost = 0;
  for (const [title, n] of need) lost += Math.max(0, n - (have.get(title) || 0));
  if (!lost) return { text: current, lost: 0, added: 0 };
  // Новите записи са тези, които в „след“ надхвърлят броя си в „преди“ (по ред на поява)
  const seen = new Map();
  const added = [];
  for (const block of splitEntries(current)) {
    if (!block.startsWith('## ')) continue;
    const title = block.split('\n')[0];
    const used = seen.get(title) || 0;
    seen.set(title, used + 1);
    if (used >= (need.get(title) || 0)) added.push(block.trimEnd());
  }
  const text = [before.replace(/\s+$/, ''), ...added].join('\n\n') + '\n';
  return { text, lost, added: added.length };
}

/** Чете дневника (или null, ако го няма). Използва се в агента преди и след всяка задача. */
export function readLog(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
