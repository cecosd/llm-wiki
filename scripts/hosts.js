// Запис на името на локалния сайт в hosts файла. Иска права на администратор.
//   node scripts/hosts.js show             кое име е записано
//   node scripts/hosts.js set <име>        записва (или сменя) името, напр. biblioteka.test
//   node scripts/hosts.js remove           маха записа на библиотеката
// Променя само блока между "# llm-wiki begin" и "# llm-wiki end"; остава резервно копие hosts.llm-wiki.bak.
// Само вградени модули: стартерът го пуска с повишени права (виж elevatedHosts в scripts/app.js).
import { checkHostName, hostsFilePath, readHostsName, writeHosts } from './modes.js';

const [cmd, arg] = process.argv.slice(2);
const file = hostsFilePath();
try {
  if (cmd === 'show') {
    console.log(readHostsName(file) || '');
  } else if (cmd === 'set') {
    const c = checkHostName(arg);
    if (!c.ok) { console.error('Invalid name: ' + c.error); process.exit(2); }
    console.log(writeHosts(c.name, file).changed ? `Written: 127.0.0.1 ${c.name}` : 'Already set.');
  } else if (cmd === 'remove') {
    console.log(writeHosts(null, file).changed ? 'Removed.' : 'Nothing to remove.');
  } else {
    console.error('Usage: node scripts/hosts.js show | set <name> | remove');
    process.exit(2);
  }
} catch (e) {
  console.error(e.code === 'EACCES' || e.code === 'EPERM' ? `No permission to write ${file}. Run as administrator (sudo on Linux and macOS).` : e.message);
  process.exit(1);
}
