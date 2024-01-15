//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { ONNXTransformerJsModel } from "#/Model";
import { Task } from "#/Task";
import {
  pipeline,
  type PipelineType,
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
  type TextGenerationSingle,
  type SummarizationPipeline,
  type SummarizationSingle,
  type QuestionAnsweringPipeline,
  type DocumentQuestionAnsweringSingle,
} from "@sroussey/transformers";

const getPipeline = async (
  task: Task,
  model: ONNXTransformerJsModel,
  { quantized, config }: { quantized: boolean; config: any } = {
    quantized: true,
    config: null,
  }
) => {
  return await pipeline(model.pipeline as PipelineType, model.name, {
    quantized,
    config,
    progress_callback: ({ progress }: { progress: number }) => {
      task.progress = progress;
      task.emit("progress", progress);
    },
  });
};

export class DownloadTask extends Task {
  readonly model: ONNXTransformerJsModel;
  constructor(options: { model: ONNXTransformerJsModel; name?: string }) {
    super({ name: options.name || `Downloading ${options.model.name}` });
    this.model = options.model;
  }

  public async run() {
    this.emit("start");
    await getPipeline(this, this.model);
    this.emit("complete");
  }
}

export class EmbeddingTask extends Task {
  readonly text: string;
  readonly model: ONNXTransformerJsModel;
  constructor(options: {
    text: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        options.name ||
        `Embedding content via ${options.model.name} : ${options.model.pipeline}`,
    });
    this.model = options.model;
    this.text = options.text;
  }

  public async run() {
    this.emit("start");

    const generateEmbedding = (await getPipeline(
      this,
      this.model
    )) as FeatureExtractionPipeline;

    var vector = await generateEmbedding(this.text, {
      pooling: "mean",
      normalize: this.model.normalize,
    });

    if (vector.size !== this.model.dimensions) {
      this.emit(
        "error",
        `Embedding vector length does not match model dimensions v${vector.size} != m${this.model.dimensions}`
      );
    } else {
      this.output = vector;
      this.emit("complete");
    }
  }
}

abstract class TextGenerationTaskBase extends Task {
  protected readonly text: string;
  protected readonly model: ONNXTransformerJsModel;
  constructor(options: {
    text: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        options.name ||
        `Text to text generation content via ${options.model.name} : ${options.model.pipeline}`,
    });
    this.model = options.model;
    this.text = options.text;
  }
}

export class TextGenerationTask extends TextGenerationTaskBase {
  public async run() {
    this.emit("start");

    const generateTextToText = (await getPipeline(
      this,
      this.model
    )) as TextGenerationPipeline;

    let results = await generateTextToText(this.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as TextGenerationSingle)?.generated_text;
    this.emit("complete");
  }
}

export class SummarizationTask extends TextGenerationTaskBase {
  public async run() {
    this.emit("start");

    const generateSummary = (await getPipeline(
      this,
      this.model
    )) as SummarizationPipeline;

    let results = await generateSummary(this.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as SummarizationSingle)?.summary_text;
    this.emit("complete");
  }
}

export class QuestionAnswerTask extends TextGenerationTaskBase {
  protected readonly context: string;
  constructor(options: {
    text: string;
    context: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        options.name ||
        `Question and Answer content via ${options.model.name} : ${options.model.pipeline}`,
      text: options.text,
      model: options.model,
    });
    this.context = options.context;
  }

  public async run() {
    this.emit("start");

    const generateAnswer = (await getPipeline(
      this,
      this.model
    )) as QuestionAnsweringPipeline;

    let results = await generateAnswer(this.text, this.context, { topk: 1 });
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as DocumentQuestionAnsweringSingle)?.answer;
    this.emit("complete");
  }
}
