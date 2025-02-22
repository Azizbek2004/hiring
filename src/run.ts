import ITask from "./Task";
import { IExecutor } from "./Executor";

async function run(
  executor: IExecutor,
  queue: AsyncIterable<ITask>,
  maxThreads: number = 0
): Promise<void> {
  const targetQueues = new Map<
    number,
    Array<{ task: ITask; resolve: () => void; reject: (err: any) => void }>
  >();
  const executing = new Set<number>();
  let runningCount = 0;
  const activePromises: Promise<void>[] = [];

  async function executeTask(task: ITask): Promise<void> {
    try {
      await executor.executeTask(task);
    } catch (error) {
      throw error;
    }
  }

  function processNext(targetId: number): void {
    const queue = targetQueues.get(targetId);
    if (!queue || queue.length === 0 || executing.has(targetId)) return;
    if (maxThreads > 0 && runningCount >= maxThreads) return;

    const { task, resolve, reject } = queue.shift()!;
    executing.add(targetId);
    runningCount++;

    const promise = executeTask(task)
      .then(() => {
        executing.delete(targetId);
        runningCount--;
        resolve();
        processNext(targetId);
        processPending();
      })
      .catch((err) => {
        executing.delete(targetId);
        runningCount--;
        reject(err);
        processNext(targetId);
        processPending();
      });

    activePromises.push(promise);
  }

  function processPending(): void {
    if (maxThreads === 0 || runningCount < maxThreads) {
      for (const targetId of targetQueues.keys()) {
        if (!executing.has(targetId) && targetQueues.get(targetId)!.length > 0) {
          processNext(targetId);
          if (maxThreads > 0 && runningCount >= maxThreads) break;
        }
      }
    }
  }

  for await (const task of queue) {
    const { targetId } = task;

    if (!targetQueues.has(targetId)) {
      targetQueues.set(targetId, []);
    }

    const queue = targetQueues.get(targetId)!;

    if (executing.has(targetId) || queue.length > 0) {
      const promise = new Promise<void>((resolve, reject) => {
        queue.push({ task, resolve, reject });
      });
      activePromises.push(promise);
    } else if (maxThreads === 0 || runningCount < maxThreads) {
      executing.add(targetId);
      runningCount++;
      const promise = executeTask(task)
        .then(() => {
          executing.delete(targetId);
          runningCount--;
          processNext(targetId);
          processPending();
        })
        .catch((err) => {
          executing.delete(targetId);
          runningCount--;
          processNext(targetId);
          processPending();
          throw err;
        });
      activePromises.push(promise);
    } else {
      const promise = new Promise<void>((resolve, reject) => {
        queue.push({ task, resolve, reject });
      });
      activePromises.push(promise);
      processPending();
    }

    if (activePromises.length > 100) {
      await Promise.race(activePromises);
      const settled = await Promise.allSettled(activePromises);
      const newPromises = settled
        .map((result, i) => (result.status === "pending" ? activePromises[i] : null))
        .filter((p): p is Promise<void> => p !== null);
      activePromises.length = 0;
      activePromises.push(...newPromises);
    }
  }

  await Promise.all(activePromises);
  processPending();
  await Promise.all(activePromises);
}