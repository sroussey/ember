//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput } from "../task/base/Task";
import { makeFingerprint } from "../util/Misc";
import { Job, JobStatus } from "./Job";
import { JobQueue } from "./JobQueue";
import { ILimiter } from "./ILimiter";

export class LocalJobQueue extends JobQueue {
  constructor(queue: string, limiter: ILimiter, waitDurationInMilliseconds = 100) {
    super(queue, limiter, waitDurationInMilliseconds);
    this.jobQueue = [];
  }

  private jobQueue: Job[];

  private reorderedQueue() {
    return this.jobQueue
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => job.runAfter.getTime() <= Date.now())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async add(job: Job) {
    job.queue = this.queue;
    job.fingerprint = await makeFingerprint(job.input);
    this.jobQueue.push(job);
  }

  public async get(id: string) {
    return this.jobQueue.find((j) => j.id === id);
  }

  public async peek(num: number) {
    num = Number(num) || 100;
    return this.jobQueue.slice(0, num);
  }

  public async next() {
    const top = this.reorderedQueue();

    const job = top[0];
    if (job) {
      job.status = JobStatus.PROCESSING;
      return job;
    }
  }

  public async size(): Promise<number> {
    return this.jobQueue.length;
  }

  public async complete(id: unknown, output: any, error?: string) {
    const job = this.jobQueue.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    job.completedAt = new Date();
    if (error) {
      job.error = error;
      job.retries += 1;
      if (job.retries >= job.maxRetries) {
        job.status = JobStatus.FAILED;
      } else {
        job.status = JobStatus.PENDING;
      }
    } else {
      job.status = JobStatus.COMPLETED;
      job.output = output;
    }
  }

  public async clear() {
    this.jobQueue = [];
  }

  public async outputForInput(taskType: string, input: TaskInput) {
    const fingerprint = await makeFingerprint(input);
    return (
      this.jobQueue.find(
        (j) =>
          j.taskType === taskType &&
          j.fingerprint === fingerprint &&
          j.status === JobStatus.COMPLETED
      )?.output ?? null
    );
  }
}
