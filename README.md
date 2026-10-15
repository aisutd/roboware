# RoboWare navigation model — meeting demo

This is a standalone, working goal-conditioned tabular Q-learning model.
It needs Python 3.10+; no installation of Python packages, frontend, or backend.

## Run in VS Code

1. Extract this folder and open the roboware-model folder in VS Code.
2. Choose Terminal → New Terminal.
3. Run:

```bash
python3 demo.py
```

This loads the supplied trained policy, evaluates every reachable start/destination
pair on the fixed warehouse, and demonstrates pick → pack → delivery.

If a terminal is already running server.py, open a second terminal with the +
button. Commands entered into a running server terminal will not execute as shell commands.

Reproduce training:

```bash
python3 demo.py --train
```

Test five independent training seeds:

```bash
python3 benchmark.py
```

## What to explain

"We have a working tabular Q-learning navigation baseline for a 16-by-10 warehouse.
It learns four directional action values at each cell, with a separate policy
for each destination. Training uses simulated episodes, negative movement costs,
and a positive destination reward. We compare greedy learned routes against A*
and report success rate and excess path length. The command-line model demo does
not need a frontend or backend."

Read benchmark-results.json or run the demo for measured numbers. Do not call this
a completed multi-agent learning system.

## Code map

- model.py / default_map(): environment layout.
- model.py / astar(): shortest-path comparison baseline.
- model.py / Model.train(): learning, random starts, exploration, Q updates.
- model.py / Model.route(): greedy execution with invalid actions masked.
- model.py / Model.evaluate(): exhaustive reachable-pair evaluation.
- model.py / Model.export() and load(): model serialization and validation.
- demo.py: loads/trains the model and runs the meeting demonstration.
- policy.json: numerical learned action scores, not handwritten routes.
- benchmark.py and benchmark-results.json: reproducible seed checks.

## What it learns

For each goal g, Q_g(x,y,a) estimates the discounted return from action a at
position (x,y). The state representation is goal-conditioned through separate
tables, so reaching different destinations does not mix contradictory rewards.

The model updates:

Q(s,a) ← Q(s,a) + alpha * [reward + gamma * max Q(s',a') - Q(s,a)]

The future term is zero when s' is the goal. Training starts at random reachable
cells and uses random tie-breaking. Epsilon decreases from 1.0 to 0.05.
Evaluation stops exploration and uses valid-action masking.

The default map has 128 walkable cells and 13 station destinations. Every table
stores all 160 cells × 4 actions, including unused rack rows. Total storage is
13 × 160 × 4 = 8,320 scores.

## Boundaries and next work

This is genuine tabular reinforcement learning, not a neural network. It learns
single-robot navigation on a known fixed map. Battery, task priority, and the
positions of other robots are not in this model's observation.

Evaluation includes cells used during training. Multiple seeds test reproducibility,
not generalization to unseen layouts. It must be retrained when the map changes.
Do not claim learned collision avoidance, learned charging, or learned task assignment.

A* will usually be the simpler choice for static known-map shortest paths. The RL
experiment is useful as a learning baseline; the next research question is whether
adding dynamic observations/rewards improves task performance over a rule-based
coordinator. Adding more episodes alone does not provide those capabilities.

For team integration, expose Model.route(start,goal) through FastAPI and render its
returned coordinates in React. Agree on [x,y] coordinates and map identity first.

## Likely mentor questions

**Why Q-learning?** The initial discrete state/action space is small enough for a
transparent baseline that we can inspect and compare with A*.

**Why separate goals?** A position alone does not specify the destination. Separate
goal tables prevent mixing values for incompatible tasks.

**What is your evidence?** Reproducible greedy evaluations over every reachable
non-goal start for 13 destinations, compared with A*; five training seeds.

**Does it avoid other robots?** Not by learning. Dynamic multi-robot coordination is
the next integration experiment. This standalone demo has one robot.

**Is 100% enough to call it finished?** No. That measures goal arrival on the trained
map. It does not prove unseen-map performance or multi-robot throughput.

**What should teammates do next?** Agree on model observations and metrics, build
the shared environment, and compare A*, Q-learning, and explicit collision handling
using the same scenarios. React and FastAPI can be built in parallel.
