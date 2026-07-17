# Rank ML — fine-tune a real cross-encoder on a free Colab T4 GPU
#
# Run this as cells in Google Colab (Runtime > Change runtime type > T4 GPU).
# Paste each "# %%"-delimited block into its own cell, in order.
#
# What this does, honestly:
#   - Starts from `cross-encoder/ms-marco-MiniLM-L6-v2`, a real cross-encoder
#     already trained on MS MARCO (a public, human-labeled query/passage
#     relevance dataset) — so it's a genuinely trained model from the start,
#     not something invented for this project.
#   - Optionally fine-tunes it further on WEAK labels derived from your own
#     repo's commit history: a commit's own title is treated as a "relevant"
#     passage for itself, and other commits' titles as "irrelevant" negatives.
#     This is a real, if simple, weak-supervision signal — not the same as
#     genuine human relevance judgments (clicks, thumbs-up) on real search
#     queries, which is what a v2 would need once mindset-ctx has real usage.
#   - Exports the result to the transformers.js-compatible ONNX layout so
#     src/rank-ml.ts (Node-only — see that file for why) can load it with
#     zero network calls at request time.
#
# This script was written against the documented HF/sentence-transformers/
# transformers.js APIs but could NOT be executed end-to-end where it was
# written: that sandbox blocks network access to huggingface.co entirely
# (confirmed via curl — same restriction category as several other blocked
# hosts there). Run it here in Colab, which has full internet access.
#
# Correction history:
# - An earlier version of cell [5] cloned github.com/xenova/transformers.js
#   and ran its scripts/convert.py — that tool no longer exists. The project
#   moved to the huggingface GitHub org and dropped its bespoke conversion
#   script in favor of the standard `optimum-onnx` exporter; the npm package
#   moved from @xenova/transformers to @huggingface/transformers too.
# - An earlier version of cell [4] used CrossEncoder.fit(output_path=...),
#   the pre-5.x sentence-transformers API. sentence-transformers 5.x replaced
#   it with a CrossEncoderTrainer (HF Trainer-based) that does NOT save to
#   output_path automatically — model.save_pretrained(...) must be called
#   explicitly after training. Running the old code produced a fine-tuning
#   progress bar (so it looked like it worked) but never actually wrote
#   fine_tuned_model/, which only surfaced as a failure two cells later, in
#   export. Both found by actually running this notebook and hitting real
#   errors, then re-verified against each project's current docs before
#   rewriting the cells below — not caught in advance, since neither
#   huggingface.co nor a GPU were reachable from where this was first written.

# %% [1] Install dependencies (Colab has torch preinstalled; this adds the rest)
# !pip install -q sentence-transformers

# %% [2] Upload your repo's memory export
# Locally, in your mindset-ctx checkout, run:
#     npm run ctx -- index path/to/your/repo
# then upload the resulting .context/memory.jsonl here (Colab's file upload
# icon in the left sidebar, or `from google.colab import files; files.upload()`).

import json

records = []
with open("memory.jsonl") as f:
    for line in f:
        line = line.strip()
        if line:
            records.append(json.loads(line))

print(f"Loaded {len(records)} records")
assert len(records) >= 20, "Need at least ~20 records for even a toy fine-tune — index a bigger repo"

# %% [3] Build weak-labeled (query, passage, label) training pairs
import random

from datasets import Dataset

random.seed(0)


def passage_for(record: dict) -> str:
    return f"{record['title']} {record['body']}".strip()[:512]


queries: list[str] = []
passages: list[str] = []
labels: list[float] = []
for r in records:
    query = r["title"]
    queries.append(query)
    passages.append(passage_for(r))
    labels.append(1.0)  # positive: a record's own title names itself
    negative = random.choice([o for o in records if o["id"] != r["id"]])
    queries.append(query)
    passages.append(passage_for(negative))
    labels.append(0.0)  # negative: an unrelated record

# Column order matters more than names for sentence-transformers' loss
# matching, but "label" specifically must be named that (or "labels"/"score"/
# "scores") to be recognized as the target rather than a third input.
train_dataset = Dataset.from_dict({"query": queries, "passage": passages, "label": labels}).shuffle(seed=0)
print(train_dataset)

# %% [4] Fine-tune the pretrained cross-encoder on those pairs
# CrossEncoderTrainer (sentence-transformers 5.x) — replaces the old
# CrossEncoder.fit(train_dataloader=..., output_path=...) API, which no
# longer reliably saves a model (see the correction note up top).
from sentence_transformers import CrossEncoder
from sentence_transformers.cross_encoder import CrossEncoderTrainer, CrossEncoderTrainingArguments
from sentence_transformers.cross_encoder.losses import BinaryCrossEntropyLoss

model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L6-v2", num_labels=1, model_kwargs={"torch_dtype": "float32"})
loss = BinaryCrossEntropyLoss(model)

args = CrossEncoderTrainingArguments(
    output_dir="checkpoints",  # trainer's own checkpoints — not the final model, see below
    num_train_epochs=1,  # weak labels + a small repo-sized dataset — more epochs risks overfitting the noise
    per_device_train_batch_size=16,
    learning_rate=2e-5,
    warmup_ratio=0.1,
    logging_steps=10,
)

trainer = CrossEncoderTrainer(model=model, args=args, train_dataset=train_dataset, loss=loss)
trainer.train()

# Explicit save is required — the trainer's output_dir above only holds
# intermediate checkpoints, not a directly loadable final model.
model.save_pretrained("fine_tuned_model")
print("Modèle sauvegardé dans ./fine_tuned_model")

# %% [5] Export to the ONNX layout src/rank-ml.ts expects
# `optimum-onnx` is HuggingFace's current, actively maintained ONNX exporter
# (verified against https://github.com/huggingface/optimum-onnx's README —
# the old xenova/transformers.js scripts/convert.py tool referenced in an
# earlier version of this cell no longer exists upstream). Its plain output
# directory doesn't nest the .onnx file under an onnx/ subfolder the way
# @huggingface/transformers' default `subfolder: "onnx"` option expects when
# loading a local model, so the mkdir/mv below puts it where rank-ml.ts's
# getMlReranker() will actually look.
#
#   !pip install -q "optimum-onnx[onnxruntime]"
#   !optimum-cli export onnx --model fine_tuned_model --task text-classification rank_ml_model
#   !mkdir -p rank_ml_model/onnx
#   !mv rank_ml_model/model.onnx rank_ml_model/onnx/model.onnx
#
# Result: a ./rank_ml_model directory containing config.json, tokenizer
# files, and onnx/model.onnx. Download it (zip it first — Colab's file
# browser only downloads single files):
#
#   !zip -r rank_ml_model.zip rank_ml_model
#   from google.colab import files; files.download("rank_ml_model.zip")
#
# Then, back on your own machine:
#   unzip rank_ml_model.zip
#   CTX_RANK_ML_MODEL_DIR=$(pwd)/rank_ml_model npm run ctx -- serve path/to/repo
#
# `ctx serve` will log a rank-ml load failure to stderr and silently fall back
# to Rank v0 if anything about this path is wrong — check that log first if
# mode=hybrid search results don't seem to change.
