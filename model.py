"""Authoritative warehouse state, heap-based A*, and goal-conditioned Q-learning."""
from __future__ import annotations
import heapq
import hashlib
import json
import math
import random
from copy import deepcopy

ACTIONS = [(0, -1), (0, 1), (-1, 0), (1, 0)]
ACTION_NAMES = ["up", "down", "left", "right"]

def default_map():
    tiles = {}
    for x0, size in [(2, 3), (7, 3), (12, 2)]:
        for y0 in [1, 5]:
            for x in range(x0, x0 + size):
                for y in range(y0, y0 + 2):
                    tiles[f"{x},{y}"] = "rack"
    for kind, cells in {
        "pick": [(1,1),(5,2),(10,1),(1,6),(10,6)],
        "pack": [(6,4),(11,4)],
        "delivery": [(14,8),(15,3)],
        "charge": [(0,9),(2,9),(4,9),(6,9)],
    }.items():
        for x,y in cells:
            tiles[f"{x},{y}"] = kind
    return {"width":16,"height":10,"tiles":tiles}

def validate_map(layout):
    if not isinstance(layout, dict):
        raise ValueError("Map must be an object")
    w,h = layout.get("width"),layout.get("height")
    if type(w) is not int or type(h) is not int or not 4 <= w <= 32 or not 4 <= h <= 32:
        raise ValueError("Map dimensions must be integers from 4 to 32")
    tiles = layout.get("tiles")
    if not isinstance(tiles,dict):
        raise ValueError("tiles must be an object")
    for key,kind in tiles.items():
        try:
            x,y = map(int,key.split(","))
        except (ValueError, AttributeError):
            raise ValueError("Tile keys must be x,y")
        if key != f"{x},{y}" or not 0 <= x < w or not 0 <= y < h:
            raise ValueError("Tile coordinate outside map")
        if kind not in {"rack","pick","pack","delivery","charge"}:
            raise ValueError("Unknown tile type")
    for kind in ["pick","pack","delivery","charge"]:
        if kind not in tiles.values():
            raise ValueError(f"Map needs at least one {kind} station")
    if w*h - list(tiles.values()).count("rack") < 4:
        raise ValueError("Map needs four free cells")
    return deepcopy(layout)

def fingerprint(layout):
    return hashlib.sha256(json.dumps(layout,sort_keys=True).encode()).hexdigest()

def walkable(layout,p):
    x,y=p
    return 0<=x<layout["width"] and 0<=y<layout["height"] and layout["tiles"].get(f"{x},{y}")!="rack"

def point(layout,value):
    if not isinstance(value,(list,tuple)) or len(value)!=2 or any(type(v) is not int for v in value):
        raise ValueError("Coordinates must be [integer x, integer y]")
    p=tuple(value)
    if not walkable(layout,p):
        raise ValueError("Coordinate is outside map or inside a rack")
    return p

def astar(layout,start,goal,blocked=()):
    if start==goal:
        return []
    blocked=set(blocked)
    if goal in blocked or not walkable(layout,goal):
        return None
    frontier=[(0,0,start)]
    costs={start:0}
    parents={}
    while frontier:
        _,cost,current=heapq.heappop(frontier)
        if cost!=costs.get(current):
            continue
        if current==goal:
            path=[]
            while current!=start:
                path.append(current)
                current=parents[current]
            return path[::-1]
        for dx,dy in ACTIONS:
            nxt=(current[0]+dx,current[1]+dy)
            if not walkable(layout,nxt) or nxt in blocked:
                continue
            g=cost+1
            if g<costs.get(nxt,math.inf):
                costs[nxt]=g
                parents[nxt]=current
                heuristic=abs(nxt[0]-goal[0])+abs(nxt[1]-goal[1])
                heapq.heappush(frontier,(g+heuristic,g,nxt))
    return None

def cells(layout,kind=None):
    return [(x,y) for y in range(layout["height"]) for x in range(layout["width"])
            if walkable(layout,(x,y)) and (kind is None or layout["tiles"].get(f"{x},{y}")==kind)]

class Model:
    def __init__(self,layout):
        self.layout=deepcopy(layout)
        self.tables={}
        self.metrics={}
        self.config={"episodes":3000,"alpha":0.15,"gamma":0.95,"seed":42}

    def index(self,p):
        return p[1]*self.layout["width"]+p[0]

    def route(self,start,goal):
        q=self.tables.get(f"{goal[0]},{goal[1]}")
        if q is None:
            return None
        path=[]
        seen={start}
        p=start
        while p!=goal:
            choices=[]
            for a,(dx,dy) in enumerate(ACTIONS):
                n=(p[0]+dx,p[1]+dy)
                if walkable(self.layout,n):
                    choices.append((q[self.index(p)][a],-a,n))
            if not choices:
                return None
            p=max(choices)[2]
            if p in seen:
                return None
            seen.add(p)
            path.append(p)
        return path

    def train(self,episodes=3000,alpha=0.15,gamma=0.95,seed=42,progress=None):
        if type(episodes) is not int or not 100<=episodes<=10000:
            raise ValueError("Episodes must be from 100 to 10000")
        if not 0<alpha<=1 or not 0<gamma<1:
            raise ValueError("alpha must be (0,1], gamma must be (0,1)")
        self.config=dict(episodes=episodes,alpha=alpha,gamma=gamma,seed=seed)
        rng=random.Random(seed)
        goals=[p for p in cells(self.layout) if self.layout["tiles"].get(f"{p[0]},{p[1]}") in {"pick","pack","delivery","charge"}]
        for gi,goal in enumerate(goals):
            # Connected component: train only on states that can reach this goal.
            reachable={goal}
            todo=[goal]
            for p in todo:
                for dx,dy in ACTIONS:
                    n=(p[0]+dx,p[1]+dy)
                    if walkable(self.layout,n) and n not in reachable:
                        reachable.add(n);todo.append(n)
            starts=sorted(reachable-{goal})
            q=[[0.0]*4 for _ in range(self.layout["width"]*self.layout["height"])]
            for episode in range(episodes):
                if not starts:
                    break
                p=rng.choice(starts)
                epsilon=max(0.05,1-episode/(episodes*0.8))
                for _ in range(self.layout["width"]*self.layout["height"]*2):
                    row=q[self.index(p)]
                    if rng.random()<epsilon:
                        a=rng.randrange(4)
                    else:
                        best=max(row)
                        a=rng.choice([i for i,v in enumerate(row) if v==best])
                    dx,dy=ACTIONS[a]
                    nxt=(p[0]+dx,p[1]+dy)
                    valid=walkable(self.layout,nxt)
                    if not valid:nxt=p
                    terminal=nxt==goal
                    reward=100 if terminal else (-1 if valid else -5)
                    target=reward+(0 if terminal else gamma*max(q[self.index(nxt)]))
                    row[a]+=alpha*(target-row[a])
                    p=nxt
                    if terminal:break
            self.tables[f"{goal[0]},{goal[1]}"]=q
            if progress:progress(gi+1,len(goals))
        self.metrics=self.evaluate()
        return self.metrics

    def evaluate(self):
        total=success=0;extra=[];per_goal={}
        for key in self.tables:
            goal=tuple(map(int,key.split(","))); count=passed=0
            for start in cells(self.layout):
                baseline=astar(self.layout,start,goal)
                if baseline is None or start==goal:continue
                total+=1;count+=1
                route=self.route(start,goal)
                if route is not None:
                    success+=1;passed+=1;extra.append(len(route)-len(baseline))
            per_goal[key]={"tested":count,"successes":passed}
        return {"tested_pairs":total,"successes":success,"success_rate":success/total if total else 0,
                "mean_extra_steps":sum(extra)/len(extra) if extra else None,"per_goal":per_goal}

    def export(self):
        return {"schema_version":1,"map_hash":fingerprint(self.layout),"width":self.layout["width"],
                "height":self.layout["height"],"actions":ACTION_NAMES,"state_encoding":"y*width+x",
                "reward":{"step":-1,"invalid":-5,"goal":100},"config":self.config,
                "tables":self.tables,"metrics":self.metrics}

    def load(self,data):
        if not isinstance(data,dict) or data.get("schema_version")!=1 or data.get("map_hash")!=fingerprint(self.layout):
            raise ValueError("Policy schema or map fingerprint does not match")
        if data.get("actions")!=ACTION_NAMES or data.get("state_encoding")!="y*width+x":
            raise ValueError("Policy actions or state encoding does not match")
        if data.get("width")!=self.layout["width"] or data.get("height")!=self.layout["height"]:
            raise ValueError("Policy dimensions do not match")
        tables=data.get("tables")
        if not isinstance(tables,dict) or not tables:
            raise ValueError("Policy tables are missing")
        for key,table in tables.items():
            try:goal=tuple(map(int,key.split(",")))
            except (ValueError,AttributeError):raise ValueError("Invalid goal key")
            point(self.layout,list(goal))
            if key!=f"{goal[0]},{goal[1]}":raise ValueError("Invalid goal key")
            if not isinstance(table,list) or len(table)!=self.layout["width"]*self.layout["height"]:
                raise ValueError("Wrong Q-table length")
            for row in table:
                if not isinstance(row,list) or len(row)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) for v in row):
                    raise ValueError("Q-table rows must have four finite numbers")
        self.tables=deepcopy(tables)
        self.config=data.get("config",{})
        self.metrics=self.evaluate()

