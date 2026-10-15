"""Meeting-ready navigation model demonstration. Python 3.10+, no dependencies."""
import argparse
import json
import time
from pathlib import Path
from model import Model, default_map, astar, ACTION_NAMES

ROOT=Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--train",action="store_true",help="Train a fresh model before the demo")
    parser.add_argument("--episodes",type=int,default=3000)
    parser.add_argument("--seed",type=int,default=42)
    args=parser.parse_args()
    layout=default_map();model=Model(layout)
    print("RoboWare: goal-conditioned tabular Q-learning")
    print("16 x 10 warehouse | 32 rack cells | 13 destination policies")
    if args.train:
        started=time.perf_counter()
        model.train(args.episodes,seed=args.seed,
                    progress=lambda done,total:print(f"Training destination {done}/{total}"))
        (ROOT/"policy.json").write_text(json.dumps(model.export(),allow_nan=False))
        print(f"Training finished in {time.perf_counter()-started:.2f} seconds.")
    else:
        model.load(json.loads((ROOT/"policy.json").read_text()))
        print("Loaded the supplied trained policy. Use --train to reproduce training.")
    metrics=model.evaluate()
    print("\nEXHAUSTIVE FIXED-MAP NAVIGATION EVALUATION")
    print(f"Reached goal: {metrics['successes']}/{metrics['tested_pairs']} pairs")
    print(f"Success rate: {100*metrics['success_rate']:.2f}%")
    print(f"Mean extra steps vs shortest A* route: {metrics['mean_extra_steps']:.4f}")
    print("These are single-robot results on the trained map, not unseen-map results.")
    print("\nORDER ROUTE DEMONSTRATION")
    position=(0,0)
    for stage,goal in [("PICK",(1,1)),("PACK",(6,4)),("DELIVER",(14,8))]:
        route=model.route(position,goal)
        baseline=astar(layout,position,goal)
        if route is None:
            print(f"{stage}: learned policy did not find a valid route")
            return 1
        print(f"{stage}: {position} -> {goal} | Q-learning {len(route)} steps | A* {len(baseline)} steps")
        print("Learned route: "+str([position]+route))
        position=goal
    print("\nThe demo routes come ONLY from Q-table action scores; A* is used for comparison.")
    print("State: cell position + destination-specific table. Actions: up/down/left/right.")
    print("Rewards: move -1, invalid move -5, goal +100.")
    print("alpha 0.15 | gamma 0.95 | epsilon 1.0 -> 0.05 during training.")
    print("Next team milestone: add traffic/battery observations and evaluate multi-robot coordination.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
