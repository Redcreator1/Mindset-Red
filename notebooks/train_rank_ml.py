# Rank ML — fine-tune a real cross-encoder on a free Colab T4 GPU
#
# Run this as cells in Google Colab (Runtime > Change runtime type > T4 GPU).
# Paste each "# %%"-delimited block into its own cell, in order.
#
# What this does, honestly:
#   - Starts from `cross-encoder/ms-marco-MiniLM-L-6-v2`, a real cross-encoder
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
# hosts there). Run it here in Colab, which has full internet access, and
# treat the exact `convert.py` invocation in the last cell as something to
# double check against https://github.com/xenova/transformers.js's current
# README, since that tool's CLI flags can drift between versions.

# %% [1] Install dependencies (Colab has torch preinstalled; this adds the rest)
# !pip install -q sentence-transformers optimum[exporters]

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

random.seed(0)


def passage_for(record: dict) -> str:
    return f"{record['title']} {record['body']}".strip()[:512]


pairs: list[tuple[str, str, float]] = []
for r in records:
    query = r["title"]
    pairs.append((query, passage_for(r), 1.0))  # positive: a record's own title names itself
    negative = random.choice([o for o in records if o["id"] != r["id"]])
    pairs.append((query, passage_for(negative), 0.0))  # negative: an unrelated record

random.shuffle(pairs)
print(f"Built {len(pairs)} weak-labeled training pairs")

# %% [4] Fine-tune the pretrained cross-encoder on those pairs
from sentence_transformers import CrossEncoder, InputExample
from torch.utils.data import DataLoader

model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", num_labels=1)

train_examples = [InputExample(texts=[q, p], label=label) for q, p, label in pairs]
train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)

model.fit(
    train_dataloader=train_dataloader,
    epochs=1,  # weak labels + a small repo-sized dataset — more epochs risks overfitting the noise
    warmup_steps=int(0.1 * len(train_dataloader)),
    output_path="fine_tuned_model",
)
print("Saved fine-tuned model to ./fine_tuned_model")

# %% [5] Export to the transformers.js-compatible ONNX layout
# transformers.js ships an official conversion tool for exactly this — it
# writes the onnx/ subfolder layout that `@xenova/transformers`'s
# `pipeline(..., { local_files_only: true })` expects. Verify the exact
# invocation against that repo's current README (this couldn't be checked
# live from the sandbox this script was authored in):
#
#   git clone --depth 1 https://github.com/xenova/transformers.js
#   cd transformers.js && pip install -q -r scripts/requirements.txt
#   python -m scripts.convert --quantize --model_id ../fine_tuned_model \
#       --task text-classification -o ../rank_ml_model
#
# Result: a ./rank_ml_model directory containing config.json, tokenizer files,
# and onnx/model_quantized.onnx. Download it (zip it first — Colab's file
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
