"""Reproduce training robustness across five random seeds on the same map."""
import json
import time
from pathlib import Path
from model import Model,default_map

results=[]
for seed in [7,19,42,73,101]:
    model=Model(default_map())
    started=time.perf_counter()
    metrics=model.train(3000,seed=seed)
    row={"seed":seed,"episodes_per_goal":3000,"seconds":round(time.perf_counter()-started,3),
         **metrics}
    results.append(row)
    print(f"seed {seed}: {metrics['successes']}/{metrics['tested_pairs']} successes; extra steps {metrics['mean_extra_steps']:.4f}",flush=True)
out=Path(__file__).resolve().parent/"benchmark-results.json"
out.write_text(json.dumps({"scope":"Single robot; fixed trained map; all reachable non-goal start/destination pairs",
    "results":results},indent=2))
print("Saved benchmark-results.json")
