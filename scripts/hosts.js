// Writing the name of the local site into the hosts file. Needs administrator rights.
//   node scripts/hosts.js show             which name is written
//   node scripts/hosts.js set <name>       writes (or changes) the name, for example biblioteka.test
//   node scripts/hosts.js remove           removes the entry of the library
// Changes only the block between "# llm-wiki begin" and "# llm-wiki end"; a backup hosts.llm-wiki.bak stays.
// Built-in modules only: the launcher runs it with raised rights (see elevatedHosts in scripts/app.js).
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
