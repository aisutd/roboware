// Tools in the layout builder's Build kit, grouped by job, with their keys and the foreman's tips.
export const DOCK_KINDS = [
  { id: 'dock', label: 'Dock station', hint: 'One square, anywhere on the floor.' },
  { id: 'shipping', label: 'Drop-off zone', hint: 'A zone on the outside edge; parcels leave through the wall.' },
];

export const KIT_GROUPS = [
  {
    label: 'Shape', tools: [
      { id: 'aisle', label: 'Floor', key: '1', tip: 'Walkable floor. Paint the dashed squares around the edge to make the building bigger.' },
      { id: 'void', label: 'Cut away', key: '2', tip: 'Removes floor. Carve corners and notches to give the warehouse its own shape.' },
    ],
  },
  {
    label: 'Storage', tools: [
      { id: 'rack', label: 'Shelf rack', key: '3', tip: 'Holds products. Robots pick from the floor right next to it, so leave aisles around racks.' },
    ],
  },
  {
    label: 'Stations', tools: [
      { id: 'packing', label: 'Packing desk', key: '4', tip: 'Robots box up picked orders here. One desk per two or three robots keeps the line moving.' },
      { id: 'charger', label: 'Charger', key: '5', tip: 'Robots start here and come back to recharge. Spread them out so they don’t queue.' },
      { id: 'dock', label: 'Dock', key: '6', tip: 'Where packed orders are dropped off. Pick a dock station or an edge drop-off zone below.' },
    ],
  },
  {
    label: 'Trucks', tools: [
      { id: 'unload', label: 'Unload bay', key: '7', tip: 'Delivery trucks back in here and leave pallets of stock. It has to touch the outside edge.' },
    ],
  },
];
export const KIT_KEYS = Object.fromEntries(KIT_GROUPS.flatMap((g) => g.tools).map((t) => [t.key, t.id]));
