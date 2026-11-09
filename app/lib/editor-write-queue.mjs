export function enqueueEditorWrite(queue, path, write) {
  const previous = queue[path];
  const current = (previous ? previous.catch(() => {}) : Promise.resolve()).then(write);
  queue[path] = current;
  return current.finally(() => { if (queue[path] === current) delete queue[path]; });
}
