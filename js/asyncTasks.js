// Keep writes and period transitions in submission order, including after failures.
export function createSerialTaskQueue() {
  let pending = Promise.resolve();
  return (task) => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
}
