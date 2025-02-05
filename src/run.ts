import ITask from "./Task";

async function run(
  executor: { executeTask: (task: ITask) => Promise<void> },
  queue: AsyncIterable<ITask>,
  maxThreads: number = 0
): Promise<void> {
  const executing = new Map<number, boolean>();
  let taskQueue: Promise<void>[] = []; // Changed from const to let

  async function processTask(task: ITask) {
    const { targetId } = task;
    while (executing.has(targetId)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    executing.set(targetId, true);
    try {
      await executor.executeTask(task);
    } catch (error) {
      console.error(`Error executing task ${JSON.stringify(task)}:`, error);
    } finally {
      executing.delete(targetId);
    }
  }

  for await (const task of queue) {
    taskQueue.push(processTask(task));
    if (maxThreads > 0 && taskQueue.length >= maxThreads) {
      await Promise.race(taskQueue);
      taskQueue = taskQueue.filter((p) => p !== undefined);
    }
  }

  await Promise.all(taskQueue);
}
