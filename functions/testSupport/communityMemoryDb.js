// Transactional test double; real Firestore race checks remain separate.
function memoryDb() {
  const docs = new Map(); let tail = Promise.resolve();
  const doc = (path) => ({ path, id: path.split('/').pop(), collection: (name) => ({ doc: (id) => doc(`${path}/${name}/${id}`) }) });
  const query = (path, match = null, cursor = '', limit = 100) => ({ path, match, cursor, limitCount: limit,
    where: (key, op, value) => query(path, [key, value], cursor, limit),
    orderBy: () => query(path, match, cursor, limit), limit: (count) => query(path, match, cursor, count),
    startAfter: (id) => query(path, match, id, limit),
  });
  const get = async (ref) => {
    if (Object.hasOwn(ref, 'limitCount')) return { docs: [...docs].filter(([path, value]) => path.startsWith(`${ref.path}/`) && path.split('/').length === 2 && (!ref.match || value[ref.match[0]] === ref.match[1]) && path.split('/')[1] > ref.cursor).sort(([a], [b]) => a.localeCompare(b)).slice(0, ref.limitCount).map(([path, value]) => ({ id: path.split('/')[1], data: () => value })) };
    return { exists: docs.has(ref.path), data: () => docs.get(ref.path) };
  };
  const db = { doc, collection: (path) => query(path), getAll: (...refs) => Promise.all(refs.map(get)), runTransaction: (fn) => {
    const result = tail.then(async () => {
      const writes = []; const output = await fn({ get, getAll: (...refs) => Promise.all(refs.map(get)), set: (ref, value) => writes.push([ref.path, value]), create: (ref, value) => { if (docs.has(ref.path)) throw new Error('exists'); writes.push([ref.path, value]); } });
      writes.forEach(([path, value]) => docs.set(path, JSON.parse(JSON.stringify(value)))); return output;
    }); tail = result.catch(() => undefined); return result;
  } };
  return { db, docs };
}
module.exports = { memoryDb };
